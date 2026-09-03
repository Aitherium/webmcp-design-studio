/**
 * iris-produce — the compound IRIS agent tool (lane 2, 2026-09-03).
 * Pins:
 * 1. Happy path: enhance → quick → evaluate → place; ONE image element, no
 *    refine when the score clears minScore; every step on the protocol feed.
 * 2. Refine path: a low score folds the critique into a second /quick — two
 *    images side by side (+24 px) plus the score labels.
 * 3. Partial result: a mid-sequence 524 (and a hung call past the per-step
 *    budget) keeps v1 on the canvas, isError false, names the failed step.
 * 4. /enhance-prompt failure falls back to the brief as-is.
 * 5. Arg validation and the no-design guard FAIL (isError) instead of throwing.
 * 6. A blind critique ("could not evaluate with vision") never triggers refine.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import {
  irisProduceTool,
  normalizeIrisScore,
  parseCritique,
  foldCritiqueIntoPrompt,
  layoutSlots,
  setIrisProduceStepTimeoutForTests,
} from '../src/webmcp/tools/irisProduce';
import { PLACE_GAP } from '../src/webmcp/tools/mediaforgePlace';
import { effectiveDoc } from '../src/state/doc';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG = `data:image/png;base64,${TINY_PNG_B64}`;
const SIGNAL = () => ({ signal: new AbortController().signal });

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
type Parsed = {
  steps: Array<{ step: string; ok: boolean; ms: number; summary: string }>;
  scores: Array<number | null>;
  elementIds: string[];
  labelIds: string[];
  refined: boolean;
  refinements: number;
  enhanced: boolean;
  promptUsed: string;
  plan: string[];
  failedStep: { step: string; reason: string } | null;
  partial: boolean;
  best: { version: number; score: number | null; elementId: string };
};

function textOf(r: unknown): string {
  return (r as Result).content[0].text;
}
function parsed(r: unknown): Parsed {
  return JSON.parse(textOf(r)) as Parsed;
}

interface Call {
  path: string;
  body: Record<string, unknown>;
}

/** Route-aware fetch stub: handlers keyed by the IRIS path suffix; each
 * handler returns a Response (or a promise that never settles). */
function stubIris(handlers: Record<string, (body: Record<string, unknown>, n: number) => Promise<Response> | Response>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const path = Object.keys(handlers).find((p) => u.endsWith(p)) ?? u;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ path, body });
      counts[path] = (counts[path] ?? 0) + 1;
      const h = handlers[path];
      if (!h) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
      return h(body, counts[path]);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const enhanceOk = (b: Record<string, unknown>) =>
  json({ enhanced: `${String(b.prompt)}, masterpiece, studio lighting`, original: b.prompt, stage: 'txt2img' });
const quickOk = () => json({ success: true, image: IMG, prompt_used: 'p', duration_ms: 56000 });
const evaluateScore = (score: number, issues: string[] = []) =>
  json({ score, matches_intent: true, strengths: ['clear'], issues, fix_suggestions: [], overall: 'ok' });

let store: ReturnType<typeof createStudioStore>;

beforeEach(() => {
  resetStudioStore();
  store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setIrisProduceStepTimeoutForTests(null);
});

function elements() {
  const s = store.getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId)!;
  return effectiveDoc(doc, s.pendingBatch).elements;
}
function stepEvents() {
  return store.getState().protocolTrace.filter((e) => e.kind === 'step');
}

describe('the pure helpers', () => {
  it('normalizes the 0..10 IRIS score to 0..1 and passes an already-normalized value through', () => {
    expect(normalizeIrisScore(8)).toBe(0.8);
    expect(normalizeIrisScore(6)).toBe(0.6);
    expect(normalizeIrisScore(0.55)).toBe(0.55);
    expect(normalizeIrisScore(1)).toBe(1);
    expect(normalizeIrisScore('8')).toBeNull();
    expect(normalizeIrisScore(Number.NaN)).toBeNull();
  });

  it('parseCritique reads the live /evaluate shape and flags the blind "could not evaluate with vision" answer (probed 2026-09-03: score 6 with no vision is NOT a critique)', () => {
    const blind = parseCritique({
      score: 6,
      issues: ['Could not evaluate with vision — may need manual review'],
      fix_suggestions: ['Try img2img refinement'],
      overall: 'Image generated but could not be evaluated automatically',
    });
    expect(blind.score).toBe(0.6);
    expect(blind.evaluated).toBe(false);
    const real = parseCritique({ score: 5, issues: ['text is unreadable'], fix_suggestions: ['larger headline'] });
    expect(real.evaluated).toBe(true);
    expect(real.issues).toEqual(['text is unreadable']);
    expect(real.fixes).toEqual(['larger headline']);
  });

  it('foldCritiqueIntoPrompt appends the issues and fixes as directives', () => {
    const p = foldCritiqueIntoPrompt('a poster', {
      score: 0.5,
      evaluated: true,
      issues: ['text is unreadable'],
      fixes: ['larger headline'],
      overall: null,
    });
    expect(p).toContain('a poster');
    expect(p).toContain('fix: text is unreadable');
    expect(p).toContain('larger headline');
  });

  it('layoutSlots fits N images side by side inside 90% of the canvas width', () => {
    const one = layoutSlots({ width: 1024, height: 1024 }, { width: 512, height: 512 }, 1);
    expect(one.first.width).toBe(512);
    const two = layoutSlots({ width: 1024, height: 1024 }, { width: 512, height: 512 }, 2);
    expect(two.first.width * 2 + PLACE_GAP).toBeLessThanOrEqual(1024 * 0.9);
    expect(two.first.x).toBeGreaterThan(0);
  });
});

describe('iris-produce — the happy path', () => {
  it('runs enhance → quick → evaluate, places ONE image, no refine when the score clears minScore, and every step is on the feed', async () => {
    const calls = stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () => evaluateScore(8),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster', style: 'retro' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(calls.map((c) => c.path)).toEqual(['/enhance-prompt', '/quick', '/evaluate']);
    // The enhanced prompt is what /quick gets, with the style folded in and enhance:false.
    expect(calls[1].body.prompt).toContain('masterpiece');
    expect(calls[1].body.prompt).toContain('retro style');
    expect(calls[1].body.enhance).toBe(false);
    expect(calls[1].body.width).toBe(512);
    expect(calls[1].body.height).toBe(512);
    // /evaluate gets the image the fleet returned + the original brief.
    expect(calls[2].body.image_url).toBe(IMG);
    expect(calls[2].body.original_prompt).toBe('a spring yard sale poster');
    expect(r.enhanced).toBe(true);
    expect(r.scores).toEqual([0.8]);
    expect(r.refined).toBe(false);
    expect(r.refinements).toBe(0);
    expect(r.elementIds).toHaveLength(1);
    expect(r.labelIds).toHaveLength(0);
    expect(r.failedStep).toBeNull();
    expect(r.partial).toBe(false);
    expect(r.plan.join(' ')).toContain('refine if score < 0.7');
    expect(r.steps.map((s) => s.step)).toEqual(['iris.plan', 'iris.enhance', 'iris.generate', 'iris.place', 'iris.critique']);
    expect(r.steps.every((s) => s.ok && typeof s.ms === 'number')).toBe(true);
    // The canvas: exactly one image element, uncommitted in the pending batch.
    const els = elements();
    expect(els.filter((e) => e.type === 'image')).toHaveLength(1);
    expect(els.filter((e) => e.type === 'text')).toHaveLength(0);
    expect(store.getState().pendingBatch?.ops.length).toBe(1);
    // The feed: one `step` event per step, with the elapsed ms and a summary.
    const feed = stepEvents();
    expect(feed.map((e) => e.tool)).toEqual(['iris.plan', 'iris.enhance', 'iris.generate', 'iris.place', 'iris.critique']);
    expect(feed.every((e) => typeof e.elapsedMs === 'number' && e.detail && e.ok === true)).toBe(true);
    expect(feed[0].detail).toContain('plan:');
  });

  it('honours refine:false and minScore — a low score is reported but never refined', async () => {
    const calls = stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () => evaluateScore(3, ['muddy']),
    });
    const r = parsed(await irisProduceTool.execute({ brief: 'a logo', refine: false }, SIGNAL()));
    expect(calls.filter((c) => c.path === '/quick')).toHaveLength(1);
    expect(r.scores).toEqual([0.3]);
    expect(r.refined).toBe(false);
    expect(r.plan.join(' ')).not.toContain('refine');
  });
});

describe('iris-produce — the refine path', () => {
  it('a score under minScore folds the critique into a second /quick: two images side by side (+24 px) plus the score labels', async () => {
    const calls = stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': (_b, n) => (n === 1 ? evaluateScore(5.2, ['headline unreadable']) : evaluateScore(8.1)),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(calls.map((c) => c.path)).toEqual(['/enhance-prompt', '/quick', '/evaluate', '/quick', '/evaluate']);
    // The second /quick carries the critique.
    expect(String(calls[3].body.prompt)).toContain('fix: headline unreadable');
    expect(String(calls[3].body.prompt)).toContain('masterpiece');
    expect(r.scores).toEqual([0.52, 0.81]);
    expect(r.refined).toBe(true);
    expect(r.refinements).toBe(1);
    expect(r.best).toMatchObject({ version: 2, score: 0.81 });
    expect(r.elementIds).toHaveLength(2);
    expect(r.labelIds).toHaveLength(2);
    expect(r.steps.map((s) => s.step)).toEqual([
      'iris.plan', 'iris.enhance', 'iris.generate', 'iris.place', 'iris.critique',
      'iris.refine', 'iris.place', 'iris.critique', 'iris.place',
    ]);
    const els = elements();
    const images = els.filter((e) => e.type === 'image');
    const labels = els.filter((e) => e.type === 'text');
    expect(images).toHaveLength(2);
    expect(labels).toHaveLength(2);
    // v2 sits beside v1: x offset = width + PLACE_GAP, same y, same footprint.
    expect(images[1].x).toBe(images[0].x + images[0].width + PLACE_GAP);
    expect(images[1].y).toBe(images[0].y);
    expect(images[1].width).toBe(images[0].width);
    // Labels name the version and the score so the improvement is visible.
    expect(labels[0].text).toBe('v1 · score 0.52');
    expect(labels[1].text).toBe('v2 refined · score 0.81');
    expect(labels[0].y).toBe(images[0].y + images[0].height + 8);
  });

  it('stops after maxRefinements even while the score stays low (up to 2)', async () => {
    const calls = stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () => evaluateScore(4),
    });
    const r = parsed(await irisProduceTool.execute({ brief: 'a logo', maxRefinements: 2 }, SIGNAL()));
    expect(calls.filter((c) => c.path === '/quick')).toHaveLength(3);
    expect(r.refinements).toBe(2);
    expect(r.elementIds).toHaveLength(3);
    expect(elements().filter((e) => e.type === 'image')).toHaveLength(3);
  });

  it('a BLIND critique (IRIS could not see the image) never triggers a refine — a score with no critique is not a reason to burn 56 s', async () => {
    const calls = stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () =>
        json({
          score: 6,
          issues: ['Could not evaluate with vision — may need manual review'],
          fix_suggestions: ['Try img2img refinement'],
          overall: 'Image generated but could not be evaluated automatically',
        }),
    });
    const r = parsed(await irisProduceTool.execute({ brief: 'a logo' }, SIGNAL()));
    expect(calls.filter((c) => c.path === '/quick')).toHaveLength(1);
    expect(r.scores).toEqual([0.6]);
    expect(r.refined).toBe(false);
    expect(r.steps.find((s) => s.step === 'iris.critique')?.summary).toContain('could not see');
  });
});

describe('iris-produce — partial results and graceful degradation', () => {
  it('a mid-sequence 524 on /evaluate keeps v1 on the canvas: isError false, failedStep names the step and the edge cut', async () => {
    stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () => new Response('', { status: 524 }),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(r.partial).toBe(true);
    expect(r.failedStep?.step).toBe('iris.critique');
    expect(r.failedStep?.reason).toContain('524');
    expect(r.failedStep?.reason).toContain('100 s');
    expect(r.elementIds).toHaveLength(1);
    expect(r.scores).toEqual([null]);
    expect(elements().filter((e) => e.type === 'image')).toHaveLength(1);
    const critique = stepEvents().find((e) => e.tool === 'iris.critique');
    expect(critique?.ok).toBe(false);
  });

  it('a HUNG /evaluate past the per-step budget times out (never one long call): v1 stays, the step is reported', async () => {
    setIrisProduceStepTimeoutForTests(60);
    stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': quickOk,
      '/evaluate': () => new Promise<Response>(() => undefined),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(r.failedStep?.step).toBe('iris.critique');
    expect(r.failedStep?.reason).toContain('timed out');
    expect(r.elementIds).toHaveLength(1);
  });

  it('a failed /quick with NOTHING placed FAILS (isError) and names the fix — the enhance step alone is not a result', async () => {
    stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': () => json({ detail: 'Not Found' }, 404),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(true);
    expect(textOf(out)).toContain('iris.generate');
    expect(textOf(out)).toContain('404');
    expect(textOf(out)).toContain('relay');
    expect(textOf(out)).toContain('Fix:');
    expect(elements()).toHaveLength(0);
  });

  it('a refine that dies mid-way keeps v1 (scored) and reports iris.refine as the failed step', async () => {
    stubIris({
      '/enhance-prompt': enhanceOk,
      '/quick': (_b, n) => (n === 1 ? quickOk() : new Response('', { status: 524 })),
      '/evaluate': () => evaluateScore(4, ['flat']),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(r.failedStep?.step).toBe('iris.refine');
    expect(r.scores).toEqual([0.4]);
    expect(r.elementIds).toHaveLength(1);
    expect(r.labelIds).toHaveLength(0);
  });

  it('/enhance-prompt failing (404, or an empty answer) falls back to the brief as-is and the run still completes', async () => {
    const calls = stubIris({
      '/enhance-prompt': () => json({ detail: 'Not Found' }, 404),
      '/quick': quickOk,
      '/evaluate': () => evaluateScore(9),
    });
    const out = await irisProduceTool.execute({ brief: 'a spring yard sale poster' }, SIGNAL());
    expect((out as Result).isError).toBe(false);
    const r = parsed(out);
    expect(calls[1].body.prompt).toBe('a spring yard sale poster');
    expect(r.enhanced).toBe(false);
    expect(r.promptUsed).toBe('a spring yard sale poster');
    expect(r.failedStep).toBeNull();
    const enhance = r.steps.find((s) => s.step === 'iris.enhance');
    expect(enhance?.ok).toBe(false);
    expect(enhance?.summary).toContain('using the brief as-is');
    expect(r.elementIds).toHaveLength(1);

    // An empty `enhanced` is the same fallback, not a crash.
    vi.unstubAllGlobals();
    const calls2 = stubIris({
      '/enhance-prompt': () => json({ enhanced: '', original: 'x' }),
      '/quick': quickOk,
      '/evaluate': () => evaluateScore(9),
    });
    await irisProduceTool.execute({ brief: 'a logo for a bakery' }, SIGNAL());
    expect(calls2[1].body.prompt).toBe('a logo for a bakery');
  });
});

describe('iris-produce — argument validation (FAILS, never throws)', () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{}, '"brief" is required'],
    [{ brief: 'ab' }, 'at least 3'],
    [{ brief: 'x'.repeat(601) }, 'at most 600'],
    [{ brief: 'a poster', width: 100 }, '"width" must be >= 256'],
    [{ brief: 'a poster', height: 2048 }, '"height" must be <= 1024'],
    [{ brief: 'a poster', width: 512.5 }, 'integer'],
    [{ brief: 'a poster', minScore: 2 }, '"minScore" must be <= 1'],
    [{ brief: 'a poster', maxRefinements: 3 }, '"maxRefinements" must be <= 2'],
    [{ brief: 'a poster', refine: 'yes' }, '"refine" must be a boolean'],
  ];
  for (const [args, message] of bad) {
    it(`rejects ${JSON.stringify(args).slice(0, 60)} with a fail() naming "${message}"`, async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const out = await irisProduceTool.execute(args, SIGNAL());
      expect((out as Result).isError).toBe(true);
      expect(textOf(out)).toContain(message);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('answers "no design exists" as a fail() on a fresh page (the call-time guard, not a registration gate)', async () => {
    resetStudioStore();
    const empty = createStudioStore();
    setStudioStore(empty as never);
    vi.stubGlobal('fetch', vi.fn());
    const out = await irisProduceTool.execute({ brief: 'a poster' }, SIGNAL());
    expect((out as Result).isError).toBe(true);
    expect(textOf(out)).toContain('create-design');
  });

  it('declares the contract: fleet-side, feed-visible, non-idempotent, non-destructive', () => {
    expect(irisProduceTool.name).toBe('iris-produce');
    expect(irisProduceTool.description).toMatch(/fleet/);
    expect(irisProduceTool.description).toMatch(/feed/);
    expect(irisProduceTool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect((irisProduceTool.inputSchema.required as string[])).toEqual(['brief']);
  });
});
