/**
 * The Media-Forge STUDIO tools (2026-09-03): ComfyUI pipelines behind
 * media-forge driven from the canvas. Pins:
 * 1. arg validation fails LOUD (never throws) and names the fix;
 * 2. the upload → media_id → route → result chain, with the routes' OWN
 *    field names (`target_scale`, `style_id`, `light_prompt`, …) and the
 *    result placed as a NEW element beside the source (x = width + 24) —
 *    the source is never mutated;
 * 3. restyle validates `style_id` against the LIVE preset catalog;
 * 4. critique is read-only and returns the critic's text;
 * 5. storyboard plans then renders N shots into a row;
 * 6. the roster carries all nine, each with the fleet annotations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioStore, getStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import { effectiveDoc } from '../src/state/doc';
import { TOOL_DEFINITIONS } from '../src/webmcp/tools';
import {
  MEDIAFORGE_STUDIO_TOOLS,
  mediaforgeCritiqueTool,
  mediaforgeEnhanceTool,
  mediaforgeOutpaintTool,
  mediaforgeRelightTool,
  mediaforgeRestyleTool,
  mediaforgeStoryboardTool,
  mediaforgeUpscaleTool,
  storyboardRow,
} from '../src/webmcp/tools/mediaforgeStudio';
import { MEDIAFORGE_JOB_TOOLS } from '../src/webmcp/tools/mediaforgeJobs';
import { besideGeometry } from '../src/webmcp/tools/mediaforgePlace';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SIGNAL = { signal: new AbortController().signal };

function textOf(r: unknown): string {
  return (r as { content: Array<{ text: string }> }).content[0].text;
}
function isError(r: unknown): boolean {
  return Boolean((r as { isError?: boolean }).isError);
}

interface Call {
  url: string;
  method: string;
  json?: Record<string, unknown>;
  form?: FormData;
}

/** A fake relay: records every call, answers by route. */
function stubRelay(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const call: Call = { url: String(url), method: init?.method ?? 'GET' };
      if (typeof init?.body === 'string') call.json = JSON.parse(init.body) as Record<string, unknown>;
      if (init?.body instanceof FormData) call.form = init.body;
      calls.push(call);
      for (const [key, answer] of Object.entries(routes)) {
        if (call.url.includes(key)) {
          const body = answer(call);
          if (body instanceof Response) return body;
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
    }),
  );
  return calls;
}

function pngBytes(): Response {
  return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
}

let sourceId = '';

beforeEach(() => {
  resetStudioStore();
  const store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
  sourceId = store.getState().addElement({ type: 'image', src: TINY_PNG, x: 40, y: 60, width: 200, height: 150, rotation: 0, opacity: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function currentElements() {
  const s = getStudioStore().getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId)!;
  return effectiveDoc(doc, s.pendingBatch).elements;
}

/* ── roster ─────────────────────────────────────────────────────────────── */

describe('roster — the nine mediaforge-* studio tools', () => {
  const NAMES = [
    'mediaforge-animate', 'mediaforge-upscale', 'mediaforge-enhance', 'mediaforge-restyle', 'mediaforge-relight',
    'mediaforge-storyboard', 'mediaforge-critique', 'mediaforge-outpaint', 'mediaforge-job-status',
  ];

  it('every name is registered, kebab-case with the mediaforge- prefix, and says it runs on the fleet', () => {
    const defs = [...MEDIAFORGE_STUDIO_TOOLS, ...MEDIAFORGE_JOB_TOOLS];
    expect(defs.map((t) => t.name).sort()).toEqual([...NAMES].sort());
    const registered = TOOL_DEFINITIONS.map((t) => t.name);
    for (const n of NAMES) expect(registered).toContain(n);
    for (const t of defs) {
      expect(t.name).toMatch(/^mediaforge-[a-z-]+$/);
      expect(t.description.toLowerCase()).toContain('fleet');
      expect(t.description.toLowerCase()).toContain('not on-device');
      expect((t.inputSchema as { required?: string[] }).required?.length).toBeGreaterThan(0);
      expect(t.annotations?.destructiveHint).toBe(false);
    }
  });

  it('mutating tools carry readOnly/idempotent false; critique is read-only', () => {
    for (const t of MEDIAFORGE_STUDIO_TOOLS) {
      if (t.name === 'mediaforge-critique') continue;
      expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    }
    expect(mediaforgeCritiqueTool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });
});

/* ── arg validation ─────────────────────────────────────────────────────── */

describe('arg validation — fails, never throws, names the fix', () => {
  it('a missing target is an isError result naming "target"', async () => {
    stubRelay({});
    const out = await mediaforgeUpscaleTool.execute({}, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('"target" is required');
  });

  it('an unknown element id names the fix (generate an image first) and makes NO relay call', async () => {
    const calls = stubRelay({});
    const out = await mediaforgeEnhanceTool.execute({ target: 'el_nope' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('generate-image');
    expect(calls).toHaveLength(0);
  });

  it('a range violation is reported with the bound', async () => {
    stubRelay({});
    const out = await mediaforgeUpscaleTool.execute({ target: 'last-image', scale: 9 }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('"scale" must be <= 4');
  });

  it('outpaint refuses all-zero margins before uploading anything', async () => {
    const calls = stubRelay({});
    const out = await mediaforgeOutpaintTool.execute({ target: 'last-image', prompt: 'sky' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('left/right/top/bottom');
    expect(calls).toHaveLength(0);
  });

  it('relight fbc without a background element names the missing arg', async () => {
    const calls = stubRelay({});
    const out = await mediaforgeRelightTool.execute({ target: 'last-image', light_prompt: 'dusk', mode: 'fbc' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('"background"');
    expect(calls).toHaveLength(0);
  });

  it('a relay 404 fails LOUD with the relay hint', async () => {
    stubRelay({});
    const out = await mediaforgeUpscaleTool.execute({ target: 'last-image' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('404');
    expect(textOf(out)).toContain('relay');
  });

  it('a studio `ok:false` answer surfaces the route\'s own reason', async () => {
    stubRelay({
      '/api/upload': () => ({ ok: true, id: 7 }),
      '/api/studio/upscale': () => ({ ok: false, error: 'no gallery image for media_id=7', id: null, image: null }),
    });
    const out = await mediaforgeUpscaleTool.execute({ target: 'last-image' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('no gallery image for media_id=7');
  });
});

/* ── the chain ──────────────────────────────────────────────────────────── */

describe('upload → media_id → route → result → NEW element beside the source', () => {
  it('upscale: posts {media_id, model, target_scale} and places the result at x = source.x + width + 24', async () => {
    const calls = stubRelay({
      '/api/upload': () => ({ ok: true, id: 4242 }),
      '/api/studio/upscale': () => ({ ok: true, id: 4243, image: '/media/up.png' }),
      '/media/up.png': () => pngBytes(),
    });
    const out = await mediaforgeUpscaleTool.execute({ target: sourceId, scale: 3 }, SIGNAL);
    expect(isError(out)).toBe(false);
    const upload = calls.find((c) => c.url.includes('/api/upload'))!;
    expect(upload.method).toBe('POST');
    expect(upload.form?.get('file')).toBeInstanceOf(Blob);
    const op = calls.find((c) => c.url.includes('/api/studio/upscale'))!;
    expect(op.json).toEqual({ media_id: 4242, model: '4x-UltraSharp.pth', target_scale: 3 });
    expect(calls.map((c) => c.url).some((u) => u.endsWith('/media/up.png'))).toBe(true);

    const parsed = JSON.parse(textOf(out)) as Record<string, unknown>;
    expect(parsed.sourceElementId).toBe(sourceId);
    expect(parsed.device).toBe('mediaforge');
    const els = currentElements();
    expect(els).toHaveLength(2);
    const source = els.find((e) => e.id === sourceId)!;
    const added = els.find((e) => e.id === parsed.elementId)!;
    expect(source.src).toBe(TINY_PNG); // never mutated
    expect(added.type).toBe('image');
    expect(added.src?.startsWith('data:image/png;base64,')).toBe(true);
    expect({ x: added.x, y: added.y, width: added.width, height: added.height }).toEqual({ x: 40 + 200 + 24, y: 60, width: 200, height: 150 });
    // The batch holds an ADD, never an update of the source.
    const ops = getStudioStore().getState().pendingBatch!.ops;
    expect(ops.some((o) => o.kind === 'update')).toBe(false);
  });

  it('enhance: posts the route\'s own flags and reads images[] (the list-shaped answer)', async () => {
    const calls = stubRelay({
      '/api/upload': () => ({ ok: true, id: 9 }),
      '/api/studio/enhance': () => ({ ok: true, ids: [10], images: ['/media/enh.png'], op: 'enhance' }),
      '/media/enh.png': () => pngBytes(),
    });
    const out = await mediaforgeEnhanceTool.execute({ target: 'last-image', face: true, scale: 1.5 }, SIGNAL);
    expect(isError(out)).toBe(false);
    const op = calls.find((c) => c.url.includes('/api/studio/enhance'))!;
    expect(op.json).toEqual({ media_id: 9, detail: true, face: true, hands: false, scale: 1.5, denoise: 0.22, preserve_face: true });
    expect(currentElements()).toHaveLength(2);
  });

  it('relight fbc uploads the background too and posts background_id', async () => {
    const bgId = getStudioStore().getState().addElement({ type: 'image', src: TINY_PNG, x: 0, y: 0, width: 50, height: 50, rotation: 0, opacity: 1 });
    let uploads = 0;
    const calls = stubRelay({
      '/api/upload': () => ({ ok: true, id: 100 + ++uploads }),
      '/api/studio/relight': () => ({ ok: true, ids: [1], images: ['/media/lit.png'] }),
      '/media/lit.png': () => pngBytes(),
    });
    const out = await mediaforgeRelightTool.execute({ target: sourceId, light_prompt: 'soft window light', mode: 'fbc', background: bgId }, SIGNAL);
    expect(isError(out)).toBe(false);
    const op = calls.find((c) => c.url.includes('/api/studio/relight'))!;
    expect(op.json).toEqual({ media_id: 101, mode: 'fbc', light_prompt: 'soft window light', seed: null, background_id: 102 });
  });

  it('outpaint: posts left/right/top/bottom + a live-validated style', async () => {
    const calls = stubRelay({
      '/api/studio/status': () => ({ available: true, styles: ['anime', 'photoreal'] }),
      '/api/upload': () => ({ ok: true, id: 5 }),
      '/api/studio/outpaint': () => ({ ok: true, ids: [6], images: ['/media/out.png'] }),
      '/media/out.png': () => pngBytes(),
    });
    const out = await mediaforgeOutpaintTool.execute({ target: 'last-image', prompt: 'more sky', top: 128, style: 'photoreal' }, SIGNAL);
    expect(isError(out)).toBe(false);
    const op = calls.find((c) => c.url.includes('/api/studio/outpaint'))!;
    expect(op.json).toEqual({ media_id: 5, prompt: 'more sky', left: 0, right: 0, top: 128, bottom: 0, style: 'photoreal' });
  });

  it('outpaint refuses a style the fleet does not list and names the valid ones', async () => {
    stubRelay({ '/api/studio/status': () => ({ styles: ['anime', 'photoreal'] }) });
    const out = await mediaforgeOutpaintTool.execute({ target: 'last-image', top: 64, style: 'watercolour' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('anime, photoreal');
  });
});

/* ── restyle: the live preset catalog ───────────────────────────────────── */

describe('restyle — style_id validated against the live preset catalog', () => {
  const CATALOG = { ok: true, groups: { Anime: [{ id: 'anime-cel', label: 'Cel' }], Photoreal: [{ id: 'photo-film', label: 'Film' }] } };

  it('a preset id from /api/studio/styles goes through as style_id', async () => {
    const calls = stubRelay({
      '/api/studio/styles': () => CATALOG,
      '/api/upload': () => ({ ok: true, id: 3 }),
      '/api/studio/restyle': () => ({ ok: true, ids: [4], images: ['/media/re.png'], style: 'photo-film' }),
      '/media/re.png': () => pngBytes(),
    });
    const out = await mediaforgeRestyleTool.execute({ target: 'last-image', style_id: 'photo-film', strength: 0.5 }, SIGNAL);
    expect(isError(out)).toBe(false);
    const op = calls.find((c) => c.url.includes('/api/studio/restyle'))!;
    expect(op.json).toEqual({ media_id: 3, style_id: 'photo-film', strength: 0.5, structure_strength: 0.6, count: 1 });
    // The catalog is read BEFORE the upload — a bad id never costs a round trip.
    expect(calls.findIndex((c) => c.url.includes('/api/studio/styles'))).toBeLessThan(calls.findIndex((c) => c.url.includes('/api/upload')));
  });

  it('an unknown style_id is refused with the catalog listed, and nothing is uploaded', async () => {
    const calls = stubRelay({ '/api/studio/styles': () => CATALOG });
    const out = await mediaforgeRestyleTool.execute({ target: 'last-image', style_id: 'anime' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('anime-cel, photo-film');
    expect(calls.some((c) => c.url.includes('/api/upload'))).toBe(false);
  });
});

/* ── critique ───────────────────────────────────────────────────────────── */

describe('critique — read-only text', () => {
  it('returns score/summary/issues and adds NO element', async () => {
    const calls = stubRelay({
      '/api/upload': () => ({ ok: true, id: 77 }),
      '/api/studio/critique': () => ({ ok: true, score: 7.5, summary: 'clean composition, soft focus', issues: [{ label: 'soft focus', severity: 'low', box: [0, 0, 1, 1] }] }),
    });
    const out = await mediaforgeCritiqueTool.execute({ target: 'last-image', focus: 'artifacts' }, SIGNAL);
    expect(isError(out)).toBe(false);
    const op = calls.find((c) => c.url.includes('/api/studio/critique'))!;
    expect(op.json).toEqual({ media_id: 77, focus: 'artifacts' });
    const parsed = JSON.parse(textOf(out)) as Record<string, unknown>;
    expect(parsed.score).toBe(7.5);
    expect(parsed.summary).toContain('soft focus');
    expect(parsed.issues).toHaveLength(1);
    expect(currentElements()).toHaveLength(1);
  });

  it('refuses a focus outside the critic\'s set', async () => {
    stubRelay({});
    const out = await mediaforgeCritiqueTool.execute({ target: 'last-image', focus: 'vibes' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('general, anatomy, artifacts, seams');
  });
});

/* ── storyboard ─────────────────────────────────────────────────────────── */

describe('storyboard — plan, then N shots in a row', () => {
  const PLAN = {
    ok: true,
    title: 'Dawn Patrol',
    scenes: [
      { name: 'intro', prompt: 'a surfer at dawn', motion: 'subtle', duration: 3 },
      { name: 'wave', prompt: 'a wave curling', motion: 'strong', duration: 2 },
      { name: 'end', prompt: 'the beach empty', motion: 'subtle', duration: 3 },
    ],
  };

  it('storyboardRow lays N equal 3:2 cells across the width with a 24px gutter', () => {
    const cells = storyboardRow(1080, 3);
    expect(cells).toHaveLength(3);
    expect(cells[0].x).toBe(24);
    expect(cells[1].x).toBe(24 + cells[0].width + 24);
    expect(cells[2].x + cells[2].width).toBeLessThanOrEqual(1080 - 24);
    for (const c of cells) expect(c.height).toBe(Math.round((c.width * 2) / 3));
  });

  it('posts {concept, shots, style, fps}, renders each scene via txt2img and places a row', async () => {
    let n = 0;
    const calls = stubRelay({
      '/api/studio/status': () => ({ styles: ['anime', 'photoreal'] }),
      '/api/studio/storyboard': () => PLAN,
      '/api/studio/txt2img': () => ({ ok: true, ids: [++n], images: [`/media/shot${n}.png`] }),
      '/media/shot': () => pngBytes(),
    });
    const out = await mediaforgeStoryboardTool.execute({ concept: 'a surfer at dawn', shots: 3 }, SIGNAL);
    expect(isError(out)).toBe(false);
    const plan = calls.find((c) => c.url.includes('/api/studio/storyboard'))!;
    expect(plan.json).toEqual({ concept: 'a surfer at dawn', shots: 3, style: 'anime', fps: 8 });
    const renders = calls.filter((c) => c.url.includes('/api/studio/txt2img'));
    expect(renders.map((c) => c.json?.prompt)).toEqual(['a surfer at dawn', 'a wave curling', 'the beach empty']);
    const parsed = JSON.parse(textOf(out)) as { title: string; rendered: unknown[]; failed: unknown[] };
    expect(parsed.title).toBe('Dawn Patrol');
    expect(parsed.rendered).toHaveLength(3);
    expect(parsed.failed).toHaveLength(0);
    const shots = currentElements().filter((e) => e.id !== sourceId);
    expect(shots).toHaveLength(3);
    expect(shots.every((e) => e.type === 'image' && e.y === 24)).toBe(true);
    expect(shots[1].x).toBe(shots[0].x + shots[0].width + 24);
  });

  it('render:false returns the plan only and renders nothing', async () => {
    const calls = stubRelay({ '/api/studio/status': () => ({ styles: ['anime'] }), '/api/studio/storyboard': () => PLAN });
    const out = await mediaforgeStoryboardTool.execute({ concept: 'x', render: false }, SIGNAL);
    expect(isError(out)).toBe(false);
    expect(JSON.parse(textOf(out)).scenes).toHaveLength(3);
    expect(calls.some((c) => c.url.includes('txt2img'))).toBe(false);
    expect(currentElements()).toHaveLength(1);
  });

  it('a shot that fails is reported in `failed` while the others still land', async () => {
    let n = 0;
    stubRelay({
      '/api/studio/status': () => ({ styles: ['anime'] }),
      '/api/studio/storyboard': () => PLAN,
      '/api/studio/txt2img': () => (++n === 2 ? { ok: false, error: 'ComfyUI busy' } : { ok: true, ids: [n], images: [`/media/s${n}.png`] }),
      '/media/s': () => pngBytes(),
    });
    const out = await mediaforgeStoryboardTool.execute({ concept: 'x', shots: 3 }, SIGNAL);
    expect(isError(out)).toBe(false);
    const parsed = JSON.parse(textOf(out)) as { rendered: unknown[]; failed: Array<{ shot: string; error: string }> };
    expect(parsed.rendered).toHaveLength(2);
    expect(parsed.failed).toEqual([{ shot: 'wave', error: expect.stringContaining('ComfyUI busy') }]);
  });
});

/* ── placement geometry ─────────────────────────────────────────────────── */

describe('besideGeometry', () => {
  it('offsets x by width + 24 and keeps the footprint unless a size is given', () => {
    expect(besideGeometry({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 134, y: 20, width: 100, height: 50 });
    expect(besideGeometry({ x: 10, y: 20, width: 100, height: 50 }, { width: 30, height: 40 })).toEqual({ x: 134, y: 20, width: 30, height: 40 });
  });
});
