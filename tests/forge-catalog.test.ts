/**
 * The FORGE shelf (2026-10-07): media-forge's curated ops as live forge-*
 * WebMCP tools, read at runtime from the demo governor's
 * `GET /api/demo/forge/ops`. Pins:
 * 1. the tool list MIRRORS the catalogue — an op the shelf starts listing is
 *    registered on the WebMCP surface on the next load, a withdrawn op is
 *    unregistered, and no forge tool exists that the catalogue did not name;
 * 2. a media-forge REFUSAL surfaces as a failed tool result carrying
 *    media-forge's own words (and "AitherSafety" when the safety gate refused);
 *    a governor 403/402 is surfaced the same way, never retried;
 * 3. an unreachable backend degrades to "tools unavailable": the shelf is
 *    EMPTY (no stale tools), the status names why, the static studio tools stay
 *    registered, and a call that finds the backend dead fails loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelContextPolyfill } from '../src/webmcp/polyfill';
import { ToolRegistry } from '../src/webmcp/registry';
import { createStudioStore, getStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import { effectiveDoc } from '../src/state/doc';
import { TOOL_DEFINITIONS, allToolDefinitions } from '../src/webmcp/tools';
import {
  forgeStatusText,
  forgeToolName,
  getForgeStatus,
  getForgeTools,
  loadForgeCatalog,
  resetForgeForTests,
  type ForgeOp,
} from '../src/webmcp/tools/forge';
import { configureDemoStorage, resetDemoStateForTests } from '../src/demo/credits';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SIGNAL = { signal: new AbortController().signal };
const VISITOR = 'visitor-0123456789';

function op(name: string, extra: Partial<ForgeOp> = {}): ForgeOp {
  return {
    name,
    group: 'edit',
    label: name.replace(/_/g, ' '),
    summary: `${name} summary.`,
    inputs: [{ name: 'image', type: 'image', required: true, many: false }],
    params: [],
    cost: 'gpu',
    credits: 100,
    usd: 0.1,
    ...extra,
  };
}

const TXT2IMG = op('txt2img', {
  group: 'generate',
  inputs: [],
  params: [
    { name: 'prompt', type: 'str', default: null },
    { name: 'count', type: 'int', default: 1, min: 1, max: 8 },
    { name: 'preset', type: 'enum', default: 'balanced', choices: ['fast', 'balanced'] },
    { name: 'loras', type: 'loras', default: null },
  ],
  credits: 150,
  usd: 0.15,
});
const REMOVE_BG = op('remove_bg', { params: [{ name: 'bg', type: 'str', default: 'transparent' }] });
const UPSCALE = op('upscale', { group: 'enhance', params: [{ name: 'scale', type: 'float', default: 2, min: 1, max: 4 }] });
const COLOR_GRADE = op('color_grade', { group: 'enhance', credits: 60, usd: 0.06 });

interface Call {
  url: string;
  method: string;
  json?: Record<string, unknown>;
}

type Answer = (call: Call) => unknown;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake governor + media relay. `routes` is mutable so a test can change the catalogue. */
function stubBackend(routes: Record<string, Answer>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const call: Call = { url: String(url), method: init?.method ?? 'GET' };
      if (typeof init?.body === 'string') call.json = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(call);
      for (const [key, answer] of Object.entries(routes)) {
        if (call.url.includes(key)) {
          const body = answer(call);
          return body instanceof Response ? body : json(body);
        }
      }
      return json({ detail: 'Not Found' }, 404);
    }),
  );
  return calls;
}

function shelf(ops: ForgeOp[]) {
  return { ok: true, available: true, safety_level: 'professional', count: ops.length, ops };
}

function governorRoutes(catalogue: () => unknown): Record<string, Answer> {
  return {
    '/api/demo/forge/ops': () => catalogue(),
    '/api/demo/session': () => ({ ok: true, visitor: VISITOR, turns_left: 30, usd_left: 0.5, created_at: 'now' }),
    '/api/demo/credits': () => ({ ok: true, visitor: VISITOR, turns_left: 30, usd_left: 0.5, created_at: 'now' }),
  };
}

function textOf(r: unknown): string {
  return (r as { content: Array<{ text: string }> }).content[0].text;
}
function isError(r: unknown): boolean {
  return Boolean((r as { isError?: boolean }).isError);
}
function forgeTool(name: string) {
  const t = getForgeTools().find((d) => d.name === forgeToolName(name));
  if (!t) throw new Error(`no forge tool for ${name}`);
  return t;
}
function elements() {
  const s = getStudioStore().getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId)!;
  return effectiveDoc(doc, s.pendingBatch).elements;
}

let sourceId = '';

beforeEach(() => {
  resetForgeForTests();
  resetDemoStateForTests();
  configureDemoStorage(null);
  resetStudioStore();
  const store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
  sourceId = store.getState().addElement({ type: 'image', src: TINY_PNG, x: 40, y: 60, width: 200, height: 150, rotation: 0, opacity: 1 })!;
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureDemoStorage(undefined);
});

/* ── 1. the tool list mirrors the catalogue ─────────────────────────────── */

describe('the forge-* tool list mirrors the live catalogue', () => {
  it('one tool per shelf op, named forge-<op>, nothing else', async () => {
    stubBackend(governorRoutes(() => shelf([TXT2IMG, REMOVE_BG, UPSCALE])));
    const st = await loadForgeCatalog();
    expect(st).toMatchObject({ state: 'ready', count: 3, safetyLevel: 'professional' });
    expect(getForgeTools().map((t) => t.name)).toEqual(['forge-txt2img', 'forge-remove-bg', 'forge-upscale']);
    expect(allToolDefinitions()).toHaveLength(TOOL_DEFINITIONS.length + 3);
  });

  it('each tool schema is built from the op manifest: image ports as element ids, typed params, unsupported types dropped', async () => {
    stubBackend(governorRoutes(() => shelf([TXT2IMG, REMOVE_BG])));
    await loadForgeCatalog();
    const gen = forgeTool('txt2img').inputSchema as { properties: Record<string, Record<string, unknown>>; required?: string[] };
    expect(gen.properties.prompt.type).toBe('string');
    expect(gen.properties.count).toMatchObject({ type: 'integer', minimum: 1, maximum: 8 });
    expect(gen.properties.preset).toMatchObject({ type: 'string', enum: ['fast', 'balanced'] });
    expect(gen.properties.loras).toBeUndefined();
    const cut = forgeTool('remove_bg').inputSchema as { properties: Record<string, Record<string, unknown>>; required?: string[] };
    expect(cut.required).toEqual(['image']);
    expect(String(cut.properties.image.description)).toContain('element id');
    expect(forgeTool('remove_bg').description).toContain('AitherSafety');
  });

  it('a new op on the shelf registers on the WebMCP surface; a withdrawn op unregisters — no studio release', async () => {
    let ops = [TXT2IMG, REMOVE_BG, UPSCALE];
    stubBackend(governorRoutes(() => shelf(ops)));
    const surface = new ModelContextPolyfill();
    const registry = new ToolRegistry(() => surface, { onStatus: () => {} });
    const names = async () => (await surface.getTools()).map((t) => t.name).filter((n) => n.startsWith('forge-')).sort();

    await loadForgeCatalog();
    await registry.reconcile(getStudioStore().getState());
    expect(await names()).toEqual(['forge-remove-bg', 'forge-txt2img', 'forge-upscale']);

    ops = [TXT2IMG, REMOVE_BG, COLOR_GRADE]; // media-forge ships color_grade, withdraws upscale
    await loadForgeCatalog();
    await registry.reconcile(getStudioStore().getState());
    expect(await names()).toEqual(['forge-color-grade', 'forge-remove-bg', 'forge-txt2img']);
  });
});

/* ── 2. refusals surface ────────────────────────────────────────────────── */

describe('a refusal surfaces with media-forge\'s own words', () => {
  it('an AitherSafety refusal is a failed result naming AitherSafety, the tier and the reason; nothing placed', async () => {
    const calls = stubBackend({
      ...governorRoutes(() => shelf([TXT2IMG])),
      '/api/demo/forge/op/txt2img': () => ({
        ok: false,
        refused: true,
        op: 'txt2img',
        error: "op 'txt2img' prompt refused at safety level 'professional'",
        safety_level: 'professional',
        charged_usd: 0,
        usd_left: 0.5,
      }),
    });
    await loadForgeCatalog();
    const before = elements().length;
    const out = await forgeTool('txt2img').execute({ prompt: 'something refused' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('REFUSED by AitherSafety');
    expect(textOf(out)).toContain("prompt refused at safety level 'professional'");
    expect(textOf(out)).toContain('Nothing was charged');
    expect(elements()).toHaveLength(before);
    // exactly one op call — a refusal is an answer, never retried
    expect(calls.filter((c) => c.url.includes('/forge/op/'))).toHaveLength(1);
  });

  it('a governor 403 (op not offered) is surfaced verbatim', async () => {
    stubBackend({
      ...governorRoutes(() => shelf([TXT2IMG])),
      '/api/demo/forge/op/txt2img': () =>
        json({ detail: { ok: false, reason: 'op_not_offered', error: 'txt2img: not offered on the hosted plan' } }, 403),
    });
    await loadForgeCatalog();
    const out = await forgeTool('txt2img').execute({ prompt: 'a cat' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('REFUSED: txt2img: not offered on the hosted plan');
  });

  it('an empty allowance (402) says so with the governor\'s fix', async () => {
    stubBackend({
      ...governorRoutes(() => shelf([TXT2IMG])),
      '/api/demo/forge/op/txt2img': () =>
        json({ detail: { ok: false, reason: 'credits_exhausted', fix: 'the on-device tools still work' } }, 402),
    });
    await loadForgeCatalog();
    const out = await forgeTool('txt2img').execute({ prompt: 'a cat' }, SIGNAL);
    expect(textOf(out)).toContain('demo allowance is spent — the on-device tools still work');
  });

  it('a success uploads the source, runs the op with its media id and places the result beside it', async () => {
    const calls = stubBackend({
      ...governorRoutes(() => shelf([REMOVE_BG])),
      '/api/demo/forge/upload': () => ({ ok: true, media_id: 41 }),
      '/api/demo/forge/op/remove_bg': () => ({
        ok: true, op: 'remove_bg', images: ['/media/cut.png'], head_ids: [42], charged_usd: 0.1, usd_left: 0.4,
      }),
      '/media/cut.png': () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } }),
    });
    await loadForgeCatalog();
    const out = await forgeTool('remove_bg').execute({ image: sourceId, bg: 'white' }, SIGNAL);
    expect(isError(out)).toBe(false);
    const run = calls.find((c) => c.url.includes('/forge/op/remove_bg'))!;
    expect(run.json).toEqual({ visitor: VISITOR, params: { image: 41, bg: 'white' } });
    const upload = calls.find((c) => c.url.includes('/forge/upload'))!;
    expect(upload.json).toMatchObject({ visitor: VISITOR, image: TINY_PNG });
    const result = JSON.parse(textOf(out)) as { elementId: string; sourceElementId: string; chargedUsd: number };
    expect(result.sourceElementId).toBe(sourceId);
    expect(result.chargedUsd).toBe(0.1);
    const placed = elements().find((e) => e.id === result.elementId)!;
    expect(placed.x).toBe(40 + 200 + 24);
    // never the owner surface
    expect(calls.some((c) => /\/api\/mediaforge\/api\//.test(c.url) || /\/api\/ops\b/.test(c.url))).toBe(false);
  });
});

/* ── 3. an unreachable backend degrades ─────────────────────────────────── */

describe('an unreachable media-forge degrades to "tools unavailable"', () => {
  it('a network failure leaves the shelf empty with a reason; the static studio tools are untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const st = await loadForgeCatalog();
    expect(st.state).toBe('unavailable');
    expect(st.reason).toContain('Failed to fetch');
    expect(getForgeTools()).toEqual([]);
    expect(allToolDefinitions()).toEqual(TOOL_DEFINITIONS);
    expect(forgeStatusText(getForgeStatus())).toMatch(/^Media Forge tools unavailable — /);

    const surface = new ModelContextPolyfill();
    const registry = new ToolRegistry(() => surface, { onStatus: () => {} });
    await registry.reconcile(getStudioStore().getState());
    const names = (await surface.getTools()).map((t) => t.name);
    expect(names).toContain('create-design');
    expect(names.some((n) => n.startsWith('forge-'))).toBe(false);
  });

  it('the governor\'s 503 mediaforge_unreachable empties a shelf that WAS live, and its tools unregister', async () => {
    let up = true;
    stubBackend(governorRoutes(() =>
      up
        ? shelf([TXT2IMG, REMOVE_BG])
        : json({ detail: { ok: false, available: false, reason: 'mediaforge_unreachable', error: 'GET /ops: ConnectError' } }, 503),
    ));
    const surface = new ModelContextPolyfill();
    const registry = new ToolRegistry(() => surface, { onStatus: () => {} });
    await loadForgeCatalog();
    await registry.reconcile(getStudioStore().getState());
    expect((await surface.getTools()).filter((t) => t.name.startsWith('forge-'))).toHaveLength(2);

    up = false;
    const st = await loadForgeCatalog();
    await registry.reconcile(getStudioStore().getState());
    expect(st).toMatchObject({ state: 'unavailable', count: 0 });
    expect(st.reason).toContain('GET /ops: ConnectError');
    expect((await surface.getTools()).filter((t) => t.name.startsWith('forge-'))).toHaveLength(0);
    expect((await surface.getTools()).map((t) => t.name)).toContain('create-design');
  });

  it('a call that finds the backend dead fails loudly and flips the status, never throws', async () => {
    const routes = governorRoutes(() => shelf([TXT2IMG]));
    stubBackend({
      ...routes,
      '/api/demo/forge/op/txt2img': () =>
        json({ detail: { ok: false, available: false, reason: 'mediaforge_unreachable', error: 'POST /op/txt2img: ConnectError' } }, 503),
    });
    await loadForgeCatalog();
    const out = await forgeTool('txt2img').execute({ prompt: 'a cat' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('Media Forge tools unavailable: POST /op/txt2img: ConnectError');
    expect(getForgeStatus().state).toBe('unavailable');
  });
});
