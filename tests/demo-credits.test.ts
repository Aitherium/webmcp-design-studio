/**
 * Demo credits + GPU burst (lane 3, 2026-09-03) — the studio half of the demo
 * governor. Fake fetch + fake localStorage; every shape below is the
 * governor's own (`AitherOS/services/studio/demo_governor.py`). Pins:
 * 1. ensureVisitor mints when no id is stored, and re-mints on 404 unknown_visitor,
 * 2. debit ok updates the store; debit 402 → CreditsExhausted carrying the server's fix,
 * 3. the hosted-lane guard refuses to send when exhausted and never meters other lanes,
 * 4. burst request 200 / 429 / 402 mapping,
 * 5. the two tools: arg validation + refusal shaping (isError + reason + fix).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreditsExhausted,
  DemoRefused,
  DEMO_BASE,
  VISITOR_KEY,
  configureDemoStorage,
  debit,
  ensureVisitor,
  getBurstStatus,
  getDemoSnapshot,
  meterHostedTurn,
  releaseBurst,
  requestBurst,
  resetDemoStateForTests,
  subscribeCredits,
  type StorageLike,
} from '../src/demo/credits';
import { demoCreditsTool, gpuBurstTool, DEMO_TOOLS } from '../src/webmcp/tools/demo';
import { TOOL_DEFINITIONS } from '../src/webmcp/tools/index';

/* ── fakes ────────────────────────────────────────────────────────────────── */

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const POLICY = {
  turns_per_visitor: 30,
  usd_per_visitor: 0.5,
  burst_usd_per_day: 20,
  burst_max_price_per_hour: 0.6,
  burst_idle_teardown_min: 20,
  burst_enabled: true,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Call {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** A fake governor: routes by path, records every call. */
function fakeGovernor(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url.startsWith(DEMO_BASE)).toBe(true);
    const path = url.slice(DEMO_BASE.length).split('?')[0];
    const call: Call = {
      path,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const handler = routes[path];
    if (!handler) return json(404, { detail: 'Not Found' });
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

const MINTED = { ok: true, visitor: 'v-minted-0123456789abcdef', turns_left: 30, usd_left: 0.5, created_at: '2026-09-03T00:00:00+00:00', policy: POLICY };

function textOf(r: unknown): string {
  return (r as { content: Array<{ text: string }> }).content[0].text;
}
function isError(r: unknown): boolean {
  return (r as { isError?: boolean }).isError === true;
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  resetDemoStateForTests();
  store = fakeStorage();
  configureDemoStorage(store);
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureDemoStorage(undefined);
});

/* ── ensureVisitor ────────────────────────────────────────────────────────── */

describe('ensureVisitor — the visitor id', () => {
  it('mints a session when nothing is stored, and remembers the id under studio.demo.visitor', async () => {
    const gov = fakeGovernor({ '/session': () => json(200, MINTED) });
    const c = await ensureVisitor();
    expect(c.visitor).toBe(MINTED.visitor);
    expect(c.turns_left).toBe(30);
    expect(c.policy?.turns_per_visitor).toBe(30);
    expect(store.getItem(VISITOR_KEY)).toBe(MINTED.visitor);
    expect(gov.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /session']);
    expect(getDemoSnapshot().credits?.visitor).toBe(MINTED.visitor);
  });

  it('reads back a stored id through GET /credits without minting', async () => {
    store.setItem(VISITOR_KEY, 'v-stored-0123456789abcdef');
    const gov = fakeGovernor({
      '/credits': () => json(200, { ...MINTED, visitor: 'v-stored-0123456789abcdef', turns_left: 12 }),
      '/session': () => {
        throw new Error('must not mint');
      },
    });
    const c = await ensureVisitor();
    expect(c.visitor).toBe('v-stored-0123456789abcdef');
    expect(c.turns_left).toBe(12);
    expect(gov.calls).toHaveLength(1);
    expect(gov.fn.mock.calls[0][0]).toContain('/credits?visitor=v-stored-0123456789abcdef');
  });

  it('re-mints when the governor says unknown_visitor (404) and replaces the stored id', async () => {
    store.setItem(VISITOR_KEY, 'v-stale-0123456789abcdef');
    const gov = fakeGovernor({
      '/credits': () => json(404, { detail: { ok: false, reason: 'unknown_visitor' } }),
      '/session': () => json(200, MINTED),
    });
    const c = await ensureVisitor();
    expect(c.visitor).toBe(MINTED.visitor);
    expect(store.getItem(VISITOR_KEY)).toBe(MINTED.visitor);
    expect(gov.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /credits', 'POST /session']);
  });

  it('survives storage being unavailable — the id lives in memory for the tab', async () => {
    configureDemoStorage(null);
    const gov = fakeGovernor({
      '/session': () => json(200, MINTED),
      '/credits': () => json(200, MINTED),
    });
    await ensureVisitor();
    await ensureVisitor();
    // second call reads the in-memory id rather than minting twice
    expect(gov.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /session', 'GET /credits']);
  });

  it('a throwing storage is caught, not fatal', async () => {
    configureDemoStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    fakeGovernor({ '/session': () => json(200, MINTED) });
    await expect(ensureVisitor()).resolves.toMatchObject({ visitor: MINTED.visitor });
  });
});

/* ── debit ────────────────────────────────────────────────────────────────── */

describe('debit — POST /spend', () => {
  it('ok: sends {visitor, kind} and publishes the new balances to subscribers', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    const gov = fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/spend': () => json(200, { ok: true, visitor: MINTED.visitor, turns_left: 29, usd_left: 0.5, created_at: MINTED.created_at }),
    });
    const seen: number[] = [];
    subscribeCredits((s) => seen.push(s.credits?.turns_left ?? -1));
    const c = await debit('turn');
    expect(c.turns_left).toBe(29);
    expect(c.policy?.usd_per_visitor).toBe(0.5); // policy kept from the /credits read
    const spend = gov.calls.find((c) => c.path === '/spend');
    expect(spend?.method).toBe('POST');
    expect(spend?.body).toEqual({ visitor: MINTED.visitor, kind: 'turn' });
    expect(seen.at(-1)).toBe(29);
  });

  it('402 → CreditsExhausted carrying the server\'s fix text, and the meter drops to 0 turns', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    fakeGovernor({
      '/credits': () => json(200, { ...MINTED, turns_left: 1 }),
      '/spend': () =>
        json(402, {
          detail: { ok: false, reason: 'credits_exhausted', fix: 'switch to the on-device brain or bring your own key' },
        }),
    });
    const err = await debit('turn').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreditsExhausted);
    expect(err).toBeInstanceOf(DemoRefused);
    const ex = err as CreditsExhausted;
    expect(ex.status).toBe(402);
    expect(ex.reason).toBe('credits_exhausted');
    expect(ex.fix).toBe('switch to the on-device brain or bring your own key');
    expect(getDemoSnapshot().credits?.turns_left).toBe(0);
  });

  it('a stale id on /spend (404 unknown_visitor) re-mints once and retries the debit', async () => {
    store.setItem(VISITOR_KEY, 'v-stale-0123456789abcdef');
    const gov = fakeGovernor({
      '/credits': () => json(200, { ...MINTED, visitor: 'v-stale-0123456789abcdef' }),
      '/session': () => json(200, MINTED),
      '/spend': (call) =>
        call.body?.visitor === MINTED.visitor
          ? json(200, { ok: true, visitor: MINTED.visitor, turns_left: 29, usd_left: 0.5 })
          : json(404, { detail: { ok: false, reason: 'unknown_visitor' } }),
    });
    const c = await debit('turn');
    expect(c.visitor).toBe(MINTED.visitor);
    expect(c.turns_left).toBe(29);
    expect(gov.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /credits',
      'POST /spend',
      'POST /session',
      'POST /spend',
    ]);
  });
});

/* ── the hosted-lane guard ────────────────────────────────────────────────── */

describe('meterHostedTurn — the guard the agent panel runs BEFORE a fleet turn', () => {
  it('fleet: debits one turn and allows', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    const gov = fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/spend': () => json(200, { ok: true, visitor: MINTED.visitor, turns_left: 29, usd_left: 0.5 }),
    });
    const gate = await meterHostedTurn('fleet');
    expect(gate.allowed).toBe(true);
    if (gate.allowed) {
      expect(gate.metered).toBe(true);
      expect(gate.credits?.turns_left).toBe(29);
    }
    expect(gov.calls.filter((c) => c.path === '/spend')).toHaveLength(1);
  });

  it('fleet + exhausted: REFUSES the send and hands back the server\'s fix', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    fakeGovernor({
      '/credits': () => json(200, { ...MINTED, turns_left: 0 }),
      '/spend': () => json(402, { detail: { ok: false, reason: 'credits_exhausted', fix: 'bring your own key' } }),
    });
    const gate = await meterHostedTurn('fleet');
    expect(gate).toEqual({ allowed: false, reason: 'credits_exhausted', fix: 'bring your own key' });
  });

  it('on-device and BYOK lanes are never metered — no governor call at all', async () => {
    const gov = fakeGovernor({});
    expect(await meterHostedTurn('on-device')).toMatchObject({ allowed: true, metered: false });
    expect(await meterHostedTurn('custom')).toMatchObject({ allowed: true, metered: false });
    expect(gov.calls).toHaveLength(0);
  });

  it('an unreachable governor lets the turn through UNMETERED and records the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const gate = await meterHostedTurn('fleet');
    expect(gate).toMatchObject({ allowed: true, metered: false });
    expect(getDemoSnapshot().error).toContain('Failed to fetch');
  });
});

/* ── burst ────────────────────────────────────────────────────────────────── */

const STATUS_DOWN = { ok: true, up: false, gpu: null, price_per_hour: null, hours_up: null, live_est_usd: 0, ledger_today_usd: 1.25, usd_left_today: 18.75, policy: POLICY };

describe('requestBurst — POST /burst', () => {
  beforeEach(() => store.setItem(VISITOR_KEY, MINTED.visitor));

  it('200: the grant carries comfyui_url, gpu, price and usd_left_today; the store shows the burst up', async () => {
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': (call) => {
        expect(call.body).toEqual({ visitor: MINTED.visitor });
        return json(200, { ok: true, reused: false, gpu: 'RTX 4090', price_per_hour: 0.55, comfyui_url: 'http://1.2.3.4:8188', instance_id: 42, usd_left_today: 18.2 });
      },
    });
    const g = await requestBurst();
    expect(g).toEqual({ reused: false, gpu: 'RTX 4090', price_per_hour: 0.55, comfyui_url: 'http://1.2.3.4:8188', instance_id: 42, usd_left_today: 18.2 });
    const b = getDemoSnapshot().burst;
    expect(b?.up).toBe(true);
    expect(b?.gpu).toBe('RTX 4090');
    expect(b?.usd_left_today).toBe(18.2);
  });

  it('429 daily_burst_cap_reached → DemoRefused with the reason; the status in the detail updates the meter', async () => {
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': () => json(429, { detail: { ok: false, reason: 'daily_burst_cap_reached', ...STATUS_DOWN, usd_left_today: 0 } }),
    });
    const err = await requestBurst().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DemoRefused);
    expect(err).not.toBeInstanceOf(CreditsExhausted);
    expect((err as DemoRefused).status).toBe(429);
    expect((err as DemoRefused).reason).toBe('daily_burst_cap_reached');
    expect(getDemoSnapshot().burst?.usd_left_today).toBe(0);
  });

  it('429 burst_disabled is a refusal too', async () => {
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': () => json(429, { detail: { ok: false, reason: 'burst_disabled', ...STATUS_DOWN } }),
    });
    await expect(requestBurst()).rejects.toMatchObject({ status: 429, reason: 'burst_disabled' });
  });

  it('402 → CreditsExhausted (a burst needs credits left)', async () => {
    fakeGovernor({
      '/credits': () => json(200, { ...MINTED, turns_left: 0 }),
      '/burst': () => json(402, { detail: { ok: false, reason: 'credits_exhausted', ...STATUS_DOWN } }),
    });
    await expect(requestBurst()).rejects.toBeInstanceOf(CreditsExhausted);
  });

  it('502 burst_up_failed carries the MediaForge error', async () => {
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': () => json(502, { detail: { ok: false, reason: 'burst_up_failed', error: 'mediaforge burst_up: timeout' } }),
    });
    await expect(requestBurst()).rejects.toMatchObject({ status: 502, reason: 'burst_up_failed', detail: { error: 'mediaforge burst_up: timeout' } });
  });

  it('status + release round trip', async () => {
    const gov = fakeGovernor({
      '/burst/status': () => json(200, { ...STATUS_DOWN, up: true, gpu: 'RTX 4090', price_per_hour: 0.55, hours_up: 0.2, live_est_usd: 0.11, usd_left_today: 18.64 }),
      '/burst/release': () => json(200, { ok: true, was_up: true }),
    });
    const s = await getBurstStatus();
    expect(s.up).toBe(true);
    expect(s.usd_left_today).toBe(18.64);
    expect(getDemoSnapshot().burst?.up).toBe(true);
    const r = await releaseBurst();
    expect(r).toEqual({ ok: true, was_up: true });
    expect(getDemoSnapshot().burst?.up).toBe(false);
    expect(gov.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /burst/status', 'POST /burst/release']);
  });
});

/* ── the tools ────────────────────────────────────────────────────────────── */

describe('demo-credits + gpu-burst tools', () => {
  it('are registered at the END of the roster (before iris-produce, which lane 2 appended 2026-09-03) with the declared annotations', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names.slice(-3)).toEqual(['demo-credits', 'gpu-burst', 'iris-produce']);
    expect(DEMO_TOOLS).toEqual([demoCreditsTool, gpuBurstTool]);
    expect(demoCreditsTool.annotations?.readOnlyHint).toBe(true);
    expect(gpuBurstTool.annotations?.readOnlyHint).toBe(false);
    expect(gpuBurstTool.annotations?.destructiveHint).toBe(false);
    // The description must say what it costs and who pays, and that the governor tears it down.
    expect(gpuBurstTool.description).toMatch(/cloud GPU/i);
    expect(gpuBurstTool.description).toMatch(/daily cap/i);
    expect(gpuBurstTool.description).toMatch(/idle/i);
    expect(gpuBurstTool.inputSchema.required).toEqual(['action']);
  });

  it('demo-credits returns balances + policy', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    fakeGovernor({ '/credits': () => json(200, { ...MINTED, turns_left: 27, usd_left: 0.48 }) });
    const r = await demoCreditsTool.execute({}, { signal: new AbortController().signal });
    expect(isError(r)).toBe(false);
    expect(JSON.parse(textOf(r))).toEqual({ turns_left: 27, usd_left: 0.48, policy: POLICY });
  });

  it('demo-credits: an unreachable governor is an isError with a named reason, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const r = await demoCreditsTool.execute({}, { signal: new AbortController().signal });
    expect(isError(r)).toBe(true);
    expect(JSON.parse(textOf(r))).toMatchObject({ reason: 'demo_governor_unreachable' });
  });

  it('gpu-burst validates action: missing and unknown values are isError before any network call', async () => {
    const gov = fakeGovernor({});
    const sig = { signal: new AbortController().signal };
    const missing = await gpuBurstTool.execute({}, sig);
    expect(isError(missing)).toBe(true);
    expect(textOf(missing)).toContain('"action" is required');
    const bad = await gpuBurstTool.execute({ action: 'nuke' }, sig);
    expect(isError(bad)).toBe(true);
    expect(textOf(bad)).toContain('must be one of: status, request, release');
    const wrongType = await gpuBurstTool.execute({ action: 1 }, sig);
    expect(isError(wrongType)).toBe(true);
    expect(gov.calls).toHaveLength(0);
  });

  it('gpu-burst request 200 → comfyui_url, gpu, price, usd_left_today', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': () => json(200, { ok: true, reused: true, gpu: 'RTX 4090', price_per_hour: 0.55, comfyui_url: 'http://1.2.3.4:8188', instance_id: 42, usd_left_today: 18.2 }),
    });
    const r = await gpuBurstTool.execute({ action: 'request' }, { signal: new AbortController().signal });
    expect(isError(r)).toBe(false);
    expect(JSON.parse(textOf(r))).toEqual({ comfyui_url: 'http://1.2.3.4:8188', gpu: 'RTX 4090', price_per_hour: 0.55, usd_left_today: 18.2, reused: true });
  });

  it('gpu-burst request refusals: 402 carries reason + fix; 429 carries reason + usd_left_today; 502 carries the error', async () => {
    store.setItem(VISITOR_KEY, MINTED.visitor);
    const sig = { signal: new AbortController().signal };
    let mode: 402 | 429 | 502 = 402;
    fakeGovernor({
      '/credits': () => json(200, MINTED),
      '/burst': () => {
        if (mode === 402) return json(402, { detail: { ok: false, reason: 'credits_exhausted', fix: 'bring your own key' } });
        if (mode === 429) return json(429, { detail: { ok: false, reason: 'daily_burst_cap_reached', ...STATUS_DOWN, usd_left_today: 0.01 } });
        return json(502, { detail: { ok: false, reason: 'burst_up_failed', error: 'no offers under $0.60/h' } });
      },
    });
    const r402 = await gpuBurstTool.execute({ action: 'request' }, sig);
    expect(isError(r402)).toBe(true);
    expect(JSON.parse(textOf(r402))).toEqual({ reason: 'credits_exhausted', fix: 'bring your own key' });

    mode = 429;
    const r429 = await gpuBurstTool.execute({ action: 'request' }, sig);
    expect(isError(r429)).toBe(true);
    expect(JSON.parse(textOf(r429))).toEqual({ reason: 'daily_burst_cap_reached', status: 429, usd_left_today: 0.01 });

    mode = 502;
    const r502 = await gpuBurstTool.execute({ action: 'request' }, sig);
    expect(isError(r502)).toBe(true);
    expect(JSON.parse(textOf(r502))).toEqual({ reason: 'burst_up_failed', status: 502, error: 'no offers under $0.60/h' });
  });

  it('gpu-burst status and release', async () => {
    fakeGovernor({
      '/burst/status': () => json(200, { ...STATUS_DOWN, up: true, gpu: 'RTX 4090', price_per_hour: 0.55, hours_up: 0.5 }),
      '/burst/release': () => json(200, { ok: true, was_up: true }),
    });
    const sig = { signal: new AbortController().signal };
    const s = await gpuBurstTool.execute({ action: 'status' }, sig);
    expect(JSON.parse(textOf(s))).toMatchObject({ up: true, gpu: 'RTX 4090', price_per_hour: 0.55, usd_left_today: 18.75 });
    const r = await gpuBurstTool.execute({ action: 'release' }, sig);
    expect(JSON.parse(textOf(r))).toEqual({ released: true, was_up: true });
  });
});
