/**
 * iris-produce — the FULL IRIS agent experience as ONE compound WebMCP tool
 * (lane 2, 2026-09-03). IRIS is the fleet's Visual Artisan (:8786, reached
 * through the studio's /api/iris relay); this tool runs its design pipeline
 * end to end with a VISIBLE plan and a step feed, and places the results on
 * the canvas:
 *
 *   plan → enhance → generate → critique → refine (conditional) → place
 *
 * Every IRIS call is a SEPARATE request with its own ≤90 s timeout. Cloudflare
 * cuts any single request at 100 s (524), and /quick alone measured 56 s for
 * 512×512 — so the pipeline is a sequence, never one long call. Each step
 * pushes a `step` event onto the protocol feed (`iris.plan`, `iris.enhance`,
 * `iris.generate`, `iris.critique`, `iris.refine`, `iris.place`) with elapsed
 * ms and a one-line summary, so the judge SEES the agent working.
 *
 * Contracts (fetched from the live OpenAPI + probed 2026-09-03):
 * - POST /enhance-prompt {prompt, stage:'txt2img'} → {enhanced, original,
 *   stage} (30 s measured; it may return the brief unchanged).
 * - POST /quick {prompt, width, height, enhance:false} → {success, image,
 *   prompt_used, plan, duration_ms} (shared with iris-generate).
 * - POST /evaluate {image_url, original_prompt, optimized_prompt} →
 *   {score 0..10, matches_intent, strengths, issues, fix_suggestions,
 *   overall}. When the vision lane is down it answers score 6 with
 *   "Could not evaluate with vision" — that is NOT a critique, so refine
 *   is skipped rather than chasing a blind score.
 *
 * Failure shape: `execute` FAILS (isError) only when NO image landed. A
 * mid-sequence failure keeps what it has on the canvas and reports the
 * failed step (partial result, isError: false).
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { DESIGN_PALETTES } from '../../brand/tokens';
import { argBool, argNumber, argString, ToolError, currentBatchSummary, snapshot } from './helpers';
import { withTimeout, withGenerationHeartbeat } from './image';
import { IRIS_BASE } from './serviceBases';
import { extractIrisImage, type IrisQuickResult } from './iris';
import { makeThumbnail } from './thumbnail';
import { PLACE_GAP, besideGeometry } from './mediaforgePlace';

/** Per-call budget. Under Cloudflare's 100 s origin cut; /quick measured 56 s
 * for 512×512 and /enhance-prompt 30 s (2026-09-03). */
export const IRIS_STEP_TIMEOUT_MS = 90_000;
let stepTimeoutMs = IRIS_STEP_TIMEOUT_MS;
/** Test seam: shorten the per-call budget so a hung call can be exercised
 * without fake timers. `null` restores the default. */
export function setIrisProduceStepTimeoutForTests(ms: number | null): void {
  stepTimeoutMs = ms ?? IRIS_STEP_TIMEOUT_MS;
}

export type IrisStepName =
  | 'iris.plan'
  | 'iris.enhance'
  | 'iris.generate'
  | 'iris.critique'
  | 'iris.refine'
  | 'iris.place';

export interface IrisStepOutcome {
  step: IrisStepName;
  ok: boolean;
  ms: number;
  summary: string;
}

export interface IrisEnhanceResult {
  enhanced?: unknown;
  original?: unknown;
  stage?: unknown;
}

export interface IrisEvaluateResult {
  score?: unknown;
  matches_intent?: unknown;
  strengths?: unknown;
  issues?: unknown;
  fix_suggestions?: unknown;
  overall?: unknown;
}

export interface IrisCritique {
  /** 0..1 (IRIS answers 0..10; normalized). null when unparseable. */
  score: number | null;
  /** false when IRIS said it could not see the image (no vision lane). */
  evaluated: boolean;
  issues: string[];
  fixes: string[];
  overall: string | null;
}

/** IRIS scores 0..10; the tool's `minScore` is 0..1. A value ≤ 1 is taken
 * as already-normalized. */
export function normalizeIrisScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const s = raw > 1 ? raw / 10 : raw;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export function parseCritique(body: IrisEvaluateResult): IrisCritique {
  const issues = stringList(body.issues);
  const fixes = stringList(body.fix_suggestions);
  const overall = typeof body.overall === 'string' ? body.overall : null;
  const blind =
    issues.some((i) => /could not evaluate/i.test(i)) || /could not be evaluated/i.test(overall ?? '');
  return { score: normalizeIrisScore(body.score), evaluated: !blind, issues, fixes, overall };
}

/** The refine prompt: the working prompt plus the critique's issues and fix
 * suggestions folded in as directives. */
export function foldCritiqueIntoPrompt(prompt: string, critique: IrisCritique): string {
  const notes = [...critique.issues.map((i) => `fix: ${i}`), ...critique.fixes].join('; ');
  return `${prompt}. Refinement — ${notes || 'stronger composition, cleaner details, sharper focal point'}`;
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fmtScore(score: number | null): string {
  return score === null ? 'unscored' : `score ${score.toFixed(2)}`;
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusHint(status: number): string {
  if (status === 404) return ' — the iris relay is not configured on this origin yet';
  if (status === 524 || status === 502 || status === 503 || status === 504) {
    return ' — the fleet cut the request (Cloudflare 100 s edge limit or IRIS busy); retry, or lower width/height';
  }
  return '';
}

async function irisPost<T>(path: string, body: unknown, label: string, signal: AbortSignal): Promise<T> {
  const base = IRIS_BASE.replace(/\/$/, '');
  return (await withTimeout(stepTimeoutMs, label, () =>
    withGenerationHeartbeat(label, async () => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new ToolError(`iris ${path} HTTP ${res.status}${statusHint(res.status)}`);
      return (await res.json()) as T;
    }),
  )) as T;
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fit `slots` images of `dims` side by side inside 90% of the canvas width
 * (and 70% of its height), centred, leaving room for a label row. */
export function layoutSlots(
  canvas: { width: number; height: number },
  dims: { width: number; height: number },
  slots: number,
): { first: Geometry; slots: number } {
  const availW = canvas.width * 0.9 - (slots - 1) * PLACE_GAP;
  const fit = Math.min(availW / slots / dims.width, (canvas.height * 0.7) / dims.height, 1);
  const width = Math.max(32, Math.floor(dims.width * fit));
  const height = Math.max(32, Math.floor(dims.height * fit));
  const total = slots * width + (slots - 1) * PLACE_GAP;
  return {
    first: {
      x: Math.round((canvas.width - total) / 2),
      y: Math.round((canvas.height - height) / 2 - 16),
      width,
      height,
    },
    slots,
  };
}

interface PlacedImage {
  version: number;
  elementId: string;
  dataUrl: string;
  prompt: string;
  score: number | null;
  geometry: Geometry;
}

export const irisProduceTool: ToolDefinition = {
  name: 'iris-produce',
  title: 'IRIS agent: plan, enhance, generate, critique, refine, place',
  description:
    'Run IRIS, the fleet\'s Visual Artisan, END TO END on the fleet (not on-device) and show its plan in the protocol feed: plan → enhance the brief → generate → critique (score 0..1) → refine once or twice when the score is under minScore → place. Places the image(s) as NEW elements (UNCOMMITTED until approve-batch); when a refinement ran, v1 and the refined image sit side by side with score labels. Each step is a separate fleet call (≤90 s); a mid-sequence failure keeps what already landed and names the failed step.',
  inputSchema: {
    type: 'object',
    properties: {
      brief: { type: 'string', description: 'Design brief, 3..600 chars' },
      width: { type: 'number', description: '256..1024, default 512' },
      height: { type: 'number', description: '256..1024, default 512' },
      style: { type: 'string', description: 'Optional style hint folded into the brief' },
      refine: { type: 'boolean', description: 'Refine when the critique score is under minScore (default true)' },
      maxRefinements: { type: 'number', enum: [1, 2], description: 'Refinement rounds, default 1' },
      minScore: { type: 'number', description: '0..1, default 0.7' },
    },
    required: ['brief'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  available: () => true,
  async execute(args, { signal }) {
    const t0 = Date.now();
    const { doc } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    let brief: string;
    let width: number;
    let height: number;
    let style: string | undefined;
    let refine: boolean;
    let maxRefinements: number;
    let minScore: number;
    try {
      brief = argString(args, 'brief', { required: true, maxLength: 600 })!;
      if (brief.length < 3) throw new ToolError('"brief" must be at least 3 characters');
      width = argNumber(args, 'width', { min: 256, max: 1024, integer: true }) ?? 512;
      height = argNumber(args, 'height', { min: 256, max: 1024, integer: true }) ?? 512;
      style = argString(args, 'style', { maxLength: 120 });
      refine = argBool(args, 'refine') ?? true;
      maxRefinements = argNumber(args, 'maxRefinements', { min: 1, max: 2, integer: true }) ?? 1;
      minScore = argNumber(args, 'minScore', { min: 0, max: 1 }) ?? 0.7;
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }

    const store = getStudioStore().getState();
    const steps: IrisStepOutcome[] = [];
    const record = (step: IrisStepName, okStep: boolean, startedAt: number, summary: string): void => {
      const ms = Date.now() - startedAt;
      steps.push({ step, ok: okStep, ms, summary });
      store.pushProtocolTrace({ ts: Date.now(), kind: 'step', tool: step, detail: summary, ok: okStep, elapsedMs: ms });
    };

    // ── plan ──────────────────────────────────────────────────────────────
    const plan: string[] = [
      'enhance the brief',
      `generate ${width}×${height}`,
      'critique',
      ...(refine ? [`refine if score < ${minScore} (up to ${maxRefinements})`] : []),
      'place on the canvas',
    ];
    record('iris.plan', true, t0, `plan: ${plan.join(' → ')}`);

    // ── enhance (graceful: the brief as-is on any failure) ────────────────
    const briefWithStyle = style ? `${brief}, ${style} style` : brief;
    let prompt = briefWithStyle;
    let enhanced = false;
    {
      const t = Date.now();
      try {
        const body = await irisPost<IrisEnhanceResult>(
          '/enhance-prompt',
          { prompt: briefWithStyle, stage: 'txt2img' },
          'iris enhance-prompt',
          signal,
        );
        const text = typeof body.enhanced === 'string' ? body.enhanced.trim() : '';
        if (!text) throw new ToolError('no enhanced prompt in the response');
        prompt = text;
        enhanced = text !== briefWithStyle;
        record('iris.enhance', true, t, enhanced ? `enhanced: ${trunc(text, 120)}` : 'IRIS kept the brief as-is');
      } catch (err) {
        record('iris.enhance', false, t, `${describeErr(err)} — using the brief as-is`);
      }
    }

    // ── generate → place → critique → (refine → place → critique)* ────────
    const images: PlacedImage[] = [];
    const layout = layoutSlots(doc.size, { width, height }, refine ? 1 + maxRefinements : 1);
    let active: { step: IrisStepName; t: number } = { step: 'iris.generate', t: Date.now() };
    let failedStep: { step: IrisStepName; reason: string } | null = null;

    const generateAndPlace = async (step: 'iris.generate' | 'iris.refine', p: string, version: number) => {
      active = { step, t: Date.now() };
      const body = await irisPost<IrisQuickResult>(
        '/quick',
        // enhance:false — the enhance step already ran (and IRIS's plan_generation
        // still optimizes); a second LLM round trip here is what pushed iris-generate
        // past the edge cut (2026-09-02).
        { prompt: p, width, height, enhance: false },
        step === 'iris.refine' ? `iris refine v${version}` : 'iris generate',
        signal,
      );
      const dataUrl = extractIrisImage(body);
      if (!dataUrl) {
        throw new ToolError(`iris returned no usable image${body.success ? '' : ' (the pipeline did not succeed)'}`);
      }
      record(step, true, active.t, `v${version} generated (${body.duration_ms ?? Date.now() - active.t} ms on the fleet)`);

      active = { step: 'iris.place', t: Date.now() };
      const prev = images[images.length - 1];
      const geometry: Geometry = prev ? besideGeometry(prev.geometry) : layout.first;
      const elementId = store.addElement({
        type: 'image',
        src: dataUrl,
        thumbnail: (await makeThumbnail(dataUrl, 96).catch(() => null)) ?? undefined,
        ...geometry,
        rotation: 0,
        opacity: 1,
      });
      if (!elementId) throw new ToolError('could not place the iris image in the design');
      images.push({ version, elementId, dataUrl, prompt: p, score: null, geometry });
      record('iris.place', true, active.t, `v${version} placed as element ${elementId}`);
    };

    const critique = async (img: PlacedImage): Promise<IrisCritique> => {
      active = { step: 'iris.critique', t: Date.now() };
      const body = await irisPost<IrisEvaluateResult>(
        '/evaluate',
        { image_url: img.dataUrl, original_prompt: brief, optimized_prompt: img.prompt },
        `iris evaluate v${img.version}`,
        signal,
      );
      const c = parseCritique(body);
      img.score = c.score;
      const note = c.evaluated
        ? c.issues[0]
          ? ` · ${trunc(c.issues[0], 80)}`
          : ''
        : ' (IRIS could not see the image — no vision lane; refine skipped)';
      record('iris.critique', true, active.t, `v${img.version} ${fmtScore(c.score)}${note}`);
      return c;
    };

    let rounds = 0;
    try {
      await generateAndPlace('iris.generate', prompt, 1);
      let c = await critique(images[0]);
      while (refine && rounds < maxRefinements && c.evaluated && c.score !== null && c.score < minScore) {
        rounds++;
        await generateAndPlace('iris.refine', foldCritiqueIntoPrompt(prompt, c), rounds + 1);
        c = await critique(images[images.length - 1]);
      }
    } catch (err) {
      const reason = describeErr(err);
      failedStep = { step: active.step, reason };
      record(active.step, false, active.t, reason);
    }

    // ── labels when a refinement ran, so the improvement is visible ───────
    const labelIds: string[] = [];
    if (images.length >= 2) {
      const t = Date.now();
      const palette = DESIGN_PALETTES[doc.palette];
      for (const img of images) {
        const text = img.version === 1 ? `v1 · ${fmtScore(img.score)}` : `v${img.version} refined · ${fmtScore(img.score)}`;
        const id = store.addElement({
          type: 'text',
          text,
          x: img.geometry.x,
          y: img.geometry.y + img.geometry.height + 8,
          width: img.geometry.width,
          height: 24,
          rotation: 0,
          opacity: 1,
          fill: palette.text,
          fontSize: 18,
          fontFamily: 'sans',
          fontWeight: 'normal',
          fontStyle: 'normal',
          align: 'center',
        });
        if (id) labelIds.push(id);
      }
      record('iris.place', true, t, `labels: ${images.map((i) => `v${i.version} ${fmtScore(i.score)}`).join(' | ')}`);
    }

    if (images.length === 0) {
      const reason = failedStep ? `${failedStep.step}: ${failedStep.reason}` : 'no image landed';
      return fail(
        `iris-produce placed nothing — ${reason}. Fix: retry (each step is a separate ≤90 s fleet call), lower width/height, or use generate-image (on-device) / iris-generate for a single shot.`,
      );
    }

    const best = images.reduce((a, b) => ((b.score ?? -1) > (a.score ?? -1) ? b : a), images[0]);
    return ok(
      JSON.stringify({
        device: 'iris',
        brief,
        promptUsed: prompt,
        enhanced,
        plan,
        steps,
        scores: images.map((i) => i.score),
        refinements: rounds,
        refined: images.length > 1,
        best: { version: best.version, score: best.score, elementId: best.elementId },
        elementIds: images.map((i) => i.elementId),
        labelIds,
        failedStep,
        partial: failedStep !== null,
        totalMs: Date.now() - t0,
        batchSummary: currentBatchSummary(),
      }),
    );
  },
};

export const IRIS_PRODUCE_TOOLS: ToolDefinition[] = [irisProduceTool];
