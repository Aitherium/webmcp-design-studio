/**
 * WebMCP Design Studio — extension bundle (the "add by URL" artifact).
 *
 * One IIFE (built to public/webmcp-adapter.js by extension.vite.config.ts)
 * that brings the studio's design tools to ANY page:
 *
 *   - If the page is a REAL WebMCP host (Chrome with the flag, ChatGPT's
 *     browser agent), tools register into `document.modelContext` and the
 *     agent can drive them directly.
 *   - Otherwise the spec-shaped polyfill is installed first (the same shim
 *     the studio app uses), so the page still exposes the tools and a
 *     page-level agent (or the demo page's own controls) can drive them.
 *
 * The tool subset is the studio's co-creation contract in miniature:
 * create-design / add-text / undo / approve-batch / list-designs /
 * get-canvas. Edits land in a PENDING batch (drawn dashed) and only become
 * real when approve-batch runs — the agent must ask, the person approves.
 *
 * Paste-able URL: https://studio-preview.aitherium.com/webmcp-adapter.js
 */
import { installModelContextPolyfill, ModelContextPolyfill } from '../webmcp/polyfill';
import type { ModelContextSurface, ModelContextTool } from '../webmcp/types';
import { DesignDriver } from './driver';

export interface WebMCPAdapterHandle {
  surface: ModelContextSurface;
  driver: DesignDriver;
  tools: ModelContextTool[];
  /** true when no real browser API existed and the polyfill was installed. */
  usingPolyfill: boolean;
}

function argString(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined) {
    if (required) throw new Error(`"${key}" is required`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function argNumber(args: Record<string, unknown>, key: string, min = 0): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`"${key}" must be a number >= ${min}`);
  }
  return n;
}

function canvasId(args: Record<string, unknown>): string | undefined {
  return argString(args, 'canvasId');
}

/**
 * Boot the adapter on the current page. Idempotent — the second call
 * returns the same handle.
 */
export function installWebMCPAdapter(options?: { canvas?: HTMLCanvasElement | null }): WebMCPAdapterHandle {
  const existing = (window as unknown as { __webmcpAdapter?: WebMCPAdapterHandle }).__webmcpAdapter;
  if (existing) return existing;

  const surface = installModelContextPolyfill();
  const driver = new DesignDriver(options?.canvas);

  const tools: ModelContextTool[] = [
    {
      name: 'create-design',
      title: 'Create design',
      description:
        'Create a new blank design canvas and make it current. Subsequent add-text / get-canvas calls apply to it. Returns the design id, title and size.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Design title (defaults to a numbered name)' },
          width: { type: 'number', description: 'Canvas width in px (default 1024)' },
          height: { type: 'number', description: 'Canvas height in px (default 768)' },
        },
      },
      execute: async (args) => {
        const width = argNumber(args, 'width', 100) ?? 1024;
        const height = argNumber(args, 'height', 100) ?? 768;
        const design = driver.createDesign(argString(args, 'title') ?? '', width, height);
        return { designId: design.id, title: design.title, size: design.size };
      },
    },
    {
      name: 'add-text',
      title: 'Add text',
      description:
        'Add a text element to the current design. The element lands in the PENDING batch — it is drawn with a dashed border and is NOT real until approve-batch is called. Returns the element id and the pending count.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to place (max 400 chars)' },
          x: { type: 'number', description: 'Left position in px (default: centered)' },
          y: { type: 'number', description: 'Top position in px (default: centered)' },
          fontSize: { type: 'number', description: 'Font size in px (default 48)' },
        },
        required: ['text'],
      },
      execute: async (args) => {
        const text = argString(args, 'text', true)!;
        if (text.length > 400) throw new Error('text exceeds 400 chars — keep it short');
        const el = driver.addText(text, argNumber(args, 'x'), argNumber(args, 'y'), argNumber(args, 'fontSize', 8) ?? 48);
        return { elementId: el.id, x: el.x, y: el.y, pending: driver.current()?.pending.length ?? 0 };
      },
    },
    {
      name: 'undo',
      title: 'Undo pending',
      description:
        'Remove the most recent element from the PENDING batch. Returns whether anything was undone and the remaining pending count.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const undone = driver.undo();
        return { undone, pending: driver.current()?.pending.length ?? 0 };
      },
    },
    {
      name: 'approve-batch',
      title: 'Approve pending edits',
      description:
        'Commit the entire pending batch — the dashed elements become REAL parts of the design. This is the person-facing approval step: call it when the design looks right. Returns the number of elements committed.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => driver.approveBatch(),
    },
    {
      name: 'list-designs',
      title: 'List designs',
      description:
        'List every design created in this page session with title, size, element count and pending count. readOnly.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ designs: driver.listDesigns() }),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get-canvas',
      title: 'Get canvas',
      description:
        'Render the current design (committed + pending) and return it as a PNG data URL. The canvas shows the design at its full size. readOnly.',
      inputSchema: {
        type: 'object',
        properties: {
          canvasId: { type: 'string', description: 'Optional: canvas element id to render into' },
        },
      },
      execute: async (args) => {
        const id = canvasId(args);
        if (id) {
          const el = document.getElementById(id);
          if (!(el instanceof HTMLCanvasElement)) {
            throw new Error(`canvasId "${id}" does not name a <canvas> element`);
          }
          driver.attachCanvas(el);
        }
        return { dataUrl: driver.getCanvas() };
      },
      annotations: { readOnlyHint: true },
    },
  ];

  const registerAll = async () => {
    for (const tool of tools) {
      try {
        await surface.registerTool(tool);
      } catch (err) {
        // Duplicate registration (adapter loaded twice) is fine — the handle
        // is idempotent anyway; anything else surfaces loudly.
        if (!(err instanceof DOMException && err.name === 'InvalidStateError')) throw err;
      }
    }
  };
  void registerAll();

  const handle: WebMCPAdapterHandle = {
    surface,
    driver,
    tools,
    usingPolyfill: surface instanceof ModelContextPolyfill,
  };
  Object.defineProperty(window, '__webmcpAdapter', { value: handle, configurable: true });
  (window as unknown as { WebMCPAdapter?: WebMCPAdapterHandle }).WebMCPAdapter = handle;
  return handle;
}

// Boot on load; the demo page (webmcp-demo.html) finds the canvas by id.
// Deferred to DOMContentLoaded when the script runs before the canvas exists
// (a <head> include or a URL-injected bundle — the gobbonet pattern).
function boot(): void {
  const canvas =
    typeof document !== 'undefined' ? (document.getElementById('webmcp-canvas') as HTMLCanvasElement | null) : null;
  installWebMCPAdapter({ canvas });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }
}

export default installWebMCPAdapter;
