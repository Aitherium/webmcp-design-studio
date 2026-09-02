/**
 * iris-generate — the IRIS Visual Artisan (:8786), as a WebMCP tool
 * (2026-08-31, the WebMCP demo). The REAL contract (measured live that day
 * against the running service's OpenAPI): IRIS has NO /generate/json — the
 * single-shot route is POST /quick ({prompt, negative_prompt, width, height,
 * enhance}); the multi-asset /pipeline* routes take a design BRIEF object,
 * not a prompt. The first version shipped /generate/json from an assumed
 * contract and 404'd on the real service.
 *
 * enhance: true runs IRIS's AI prompt-optimization step, so the result still
 * carries the "autonomous artisan" story — the agent can tell the person the
 * optimized prompt the pipeline decided on. The image is placed in the
 * design as an element (UNCOMMITTED until approve-batch).
 *
 * The response (live-verified shape): {success, image, prompt_used,
 * original_prompt, plan: {optimized_prompt, style_tags}, duration_ms}.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { argEnum, argString, ToolError, currentBatchSummary, snapshot } from './helpers';
import { withTimeout, withGenerationHeartbeat, IMAGE_DIMENSIONS, fitOnDeviceDims } from './image';
import { IRIS_BASE, normalizeServiceImage } from './serviceBases';
import { makeThumbnail } from './thumbnail';

/** The full /quick path is prompt-enhance (LLM) + a generation against a
 * shared single-process backend measured at ~174s per job — a 5-minute
 * budget with a live heartbeat. */
// Under Cloudflare's 100 s origin cut: the public lane rides the tunnel, so a
// slower turn would surface as a 524 with no message anyway. Measured 2026-09-02
// after the Iris/MicroScheduler repairs: 42 s end to end.
const IRIS_TIMEOUT_MS = 90_000;

export interface IrisQuickResult {
  success: boolean;
  image?: unknown;
  prompt_used?: string;
  original_prompt?: string;
  plan?: { optimized_prompt?: string; style_tags?: string[] };
  duration_ms?: number;
}

export function extractIrisImage(body: IrisQuickResult): string | null {
  if (!body?.success) return null;
  const url = normalizeServiceImage(body.image);
  return url;
}

export const irisGenerateTool: ToolDefinition = {
  name: 'iris-generate',
  title: 'Generate image with Iris (AI-optimized prompt)',
  description:
    'Run IRIS, the platform\'s Visual Artisan: it AI-optimizes the prompt, then generates a single high-quality image, and places it in the design as an element (UNCOMMITTED until approve-batch). size: square, wide, tall. Use this when the person wants a refined, professionally-composed image rather than a raw single shot.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Natural-language image prompt' },
      size: { type: 'string', enum: ['square', 'wide', 'tall'] },
    },
    required: ['prompt'],
  },
  available: () => true,
  async execute(args) {
    const { doc } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    const prompt = argString(args, 'prompt', { required: true, maxLength: 2000 })!;
    const size = (argEnum(args, 'size', ['square', 'wide', 'tall']) ?? 'square') as 'square' | 'wide' | 'tall';
    const dims = fitOnDeviceDims(IMAGE_DIMENSIONS[size]);

    try {
      const body = (await withTimeout(IRIS_TIMEOUT_MS, 'iris generation', () =>
        withGenerationHeartbeat('iris (prompt optimization + generation)', async () => {
          const res = await fetch(`${IRIS_BASE}/quick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              width: dims.width,
              height: dims.height,
              // enhance=false (2026-09-02): Iris's enhance_prompt is a second LLM round
              // trip before plan_generation (which still optimizes the prompt). Measured
              // through the public path: 15 s without it, 42-114 s with it, and two
              // concurrent enhanced turns serialize past Cloudflare's 100 s cut.
              enhance: false,
            }),
          });
          if (!res.ok) {
            throw new ToolError(`iris HTTP ${res.status}${res.status === 404 ? ' — the iris relay is not configured on this origin yet' : ''}`);
          }
          return (await res.json()) as IrisQuickResult;
        }),
      )) as IrisQuickResult;

      const dataUrl = extractIrisImage(body);
      if (!dataUrl) {
        throw new ToolError(
          `iris returned no usable image${body.success ? '' : ' (the pipeline did not succeed)'}`,
        );
      }

      const canvas = doc.size;
      const fit = Math.min((canvas.width * 0.8) / dims.width, (canvas.height * 0.8) / dims.height, 1);
      const w = Math.round(dims.width * fit);
      const h = Math.round(dims.height * fit);
      const store = getStudioStore().getState();
      const elementId = store.addElement({
        type: 'image',
        src: dataUrl,
        thumbnail: (await makeThumbnail(dataUrl, 96).catch(() => null)) ?? undefined,
        x: Math.round((canvas.width - w) / 2),
        y: Math.round((canvas.height - h) / 2),
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
      });
      if (!elementId) return fail('could not place the iris image in the design');
      return ok(
        JSON.stringify({
          elementId,
          device: 'iris',
          optimizedPrompt: body.plan?.optimized_prompt ?? null,
          promptUsed: body.prompt_used ?? null,
          durationMs: body.duration_ms ?? null,
          batchSummary: currentBatchSummary(),
        }),
      );
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const IRIS_TOOLS: ToolDefinition[] = [irisGenerateTool];
