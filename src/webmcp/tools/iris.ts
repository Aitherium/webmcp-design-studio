/**
 * iris-generate — the IRIS autonomous image pipeline, as a WebMCP tool
 * (2026-08-31, the WebMCP demo). IRIS is the platform's Visual Artisan
 * (:8786): prompt ENHANCEMENT → generation → VISION evaluation → iterative
 * refinement, up to max_rounds. The tool runs the FULL pipeline and places
 * the final image in the design as an element (UNCOMMITTED until
 * approve-batch).
 *
 * The result carries the pipeline story — best_score, refinement_rounds and
 * the steps — so the agent can tell the person what the pipeline decided,
 * which is the "autonomous artisan" demo: the rounds are NOT a spinner, the
 * evaluation scores are visible.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { argEnum, argNumber, argString, ToolError, currentBatchSummary, snapshot } from './helpers';
import { withTimeout, withGenerationHeartbeat, IMAGE_DIMENSIONS, fitOnDeviceDims } from './image';
import { IRIS_BASE, normalizeServiceImage } from './serviceBases';
import { makeThumbnail } from './thumbnail';

/** The autonomous pipeline can run rounds of generation + vision evaluation
 * (default max_rounds=3) — a 5-minute budget with a live heartbeat. */
const IRIS_TIMEOUT_MS = 300_000;

export interface IrisPipelineResult {
  success: boolean;
  image?: unknown;
  images?: unknown[];
  best_score?: number;
  refinement_rounds?: number;
  steps?: Array<{ type?: string; evaluation?: { score?: number; overall?: string } }>;
  plan?: { optimized_prompt?: string };
}

export function extractIrisImage(body: IrisPipelineResult): string | null {
  if (!body?.success) return null;
  for (const candidate of [body.image, ...(body.images ?? [])]) {
    const url = normalizeServiceImage(candidate);
    if (url) return url;
  }
  return null;
}

export const irisGenerateTool: ToolDefinition = {
  name: 'iris-generate',
  title: 'Generate image with Iris (autonomous refinement)',
  description:
    'Run the IRIS autonomous image pipeline — prompt enhancement, generation, VISUAL evaluation and iterative refinement (up to max_rounds) — and place the final image in the design as an element (UNCOMMITTED until approve-batch). Use this when the person wants a refined, self-evaluated image rather than a single shot. size: square, wide, tall. maxRounds: how many evaluate-refine rounds (default 3).',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Natural-language image prompt' },
      size: { type: 'string', enum: ['square', 'wide', 'tall'] },
      maxRounds: { type: 'number', description: 'Evaluation/refinement rounds (1-5, default 3)' },
    },
    required: ['prompt'],
  },
  available: () => true,
  async execute(args) {
    const { doc } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    const prompt = argString(args, 'prompt', { required: true, maxLength: 2000 })!;
    const size = (argEnum(args, 'size', ['square', 'wide', 'tall']) ?? 'square') as 'square' | 'wide' | 'tall';
    const maxRounds = Math.min(Math.max(argNumber(args, 'maxRounds', { integer: true, min: 1 }) ?? 3, 1), 5);
    const dims = fitOnDeviceDims(IMAGE_DIMENSIONS[size]);

    try {
      const body = (await withTimeout(IRIS_TIMEOUT_MS, 'iris pipeline', () =>
        withGenerationHeartbeat(`iris pipeline (up to ${maxRounds} refinement rounds)`, async () => {
          const res = await fetch(`${IRIS_BASE}/generate/json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              width: dims.width,
              height: dims.height,
              max_rounds: maxRounds,
              stream: false,
            }),
          });
          if (!res.ok) {
            throw new ToolError(`iris pipeline HTTP ${res.status}${res.status === 404 ? ' — the iris relay is not configured on this origin yet' : ''}`);
          }
          return (await res.json()) as IrisPipelineResult;
        }),
      )) as IrisPipelineResult;

      const dataUrl = extractIrisImage(body);
      if (!dataUrl) {
        const roundInfo =
          body.refinement_rounds != null ? ` after ${body.refinement_rounds} refinement round(s)` : '';
        throw new ToolError(`iris pipeline returned no usable image${roundInfo}${body.success ? '' : ' (pipeline did not succeed)'}`);
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
      const evaluation = body.steps?.find((s) => s.evaluation)?.evaluation;
      return ok(
        JSON.stringify({
          elementId,
          device: 'iris',
          bestScore: body.best_score ?? null,
          refinementRounds: body.refinement_rounds ?? null,
          evaluation: evaluation
            ? { score: evaluation.score ?? null, overall: evaluation.overall ?? null }
            : null,
          optimizedPrompt: body.plan?.optimized_prompt ?? null,
          batchSummary: currentBatchSummary(),
        }),
      );
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const IRIS_TOOLS: ToolDefinition[] = [irisGenerateTool];
