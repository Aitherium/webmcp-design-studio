/**
 * export-design — render the current design (committed + pending when
 * includePending) to PNG/JPEG, trigger a browser download for the human and
 * return a small preview for the agent. Rendering happens on the live
 * fabric canvas through the exporter hook; the tool never touches fabric.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getCanvasExporter } from '../../canvas/exporter';
import { ToolError, argBool, argEnum, argNumber, snapshot } from './helpers';
import { makeThumbnail } from './thumbnail';

export const exportDesignTool: ToolDefinition = {
  name: 'export-design',
  title: 'Export design',
  description:
    'Export the current design (committed + pending edits when includePending is true) as PNG or JPEG at 1x or 2x scale. Triggers a browser download for the human and returns the filename and a small preview image.',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Export format (default png)' },
      scale: { type: 'number', enum: [1, 2], description: 'Resolution multiplier (default 1)' },
      includePending: { type: 'boolean', description: 'Include uncommitted batch edits (default true)' },
    },
    required: [],
  },
  available: (s) => Boolean(s.currentDocId) && s.docs.length > 0,
  async execute(args) {
    const { doc } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');
    try {
      const format = (argEnum(args, 'format', ['png', 'jpeg']) ?? 'png') as 'png' | 'jpeg';
      const scale = (argNumber(args, 'scale', { integer: true, min: 1, max: 2 }) === 2 ? 2 : 1) as 1 | 2;
      const includePending = argBool(args, 'includePending') ?? true;

      const exporter = getCanvasExporter();
      if (!exporter) {
        return fail('export needs the live canvas, which is not available in this environment');
      }
      const { dataUrl, width, height } = await exporter({ format, scale, includePending });

      const slug = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design';
      const filename = `webmcp-${slug}-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      tryDownload(dataUrl, filename);

      // Small preview for the agent — never the full export.
      const preview = (await makeThumbnail(dataUrl, 512)) ?? dataUrl;
      return ok(
        JSON.stringify({
          filename,
          format,
          width,
          height,
          includePending,
          preview,
        }),
      );
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

function tryDownload(dataUrl: string, filename: string): void {
  // Headless environments (jsdom) cannot download and a click() on an
  // anchor with an href would start a navigation they never finish —
  // skip it there; the tool result stands without the download.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Download is a browser nicety; the tool result stands without it.
  }
}

export const EXPORT_TOOLS: ToolDefinition[] = [exportDesignTool];
