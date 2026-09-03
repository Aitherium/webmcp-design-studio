/**
 * The pairing lane (2026-09-03, WebMCP lane 4) — "Connect your own agent".
 * Pins, with a FAKE socket + fake fetch + fake surface:
 * 1. URL derivation: relative relay answers are rebuilt from the lane base and
 *    the page origin (wss ⇐ https, ws ⇐ http); absolute answers pass through.
 * 2. hello carries the LIVE roster from the surface (name/description/schema/
 *    annotations, never `execute`), and is re-sent on toolchange.
 * 3. call → executeTool on the surface → result (JSON-parsed).
 * 4. A throwing tool → error frame; the store counts calls either way.
 * 5. ping → pong; 4404 → expired, 4409 → error; stop closes and resets.
 * Pairing is NOT a tool: the roster count and the protocol trace are untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPairState,
  resetPairingForTests,
  resolvePairUrls,
  startPairing,
  stopPairing,
  subscribePair,
  WS_CLOSE_ALREADY_PAIRED,
  WS_CLOSE_UNKNOWN_CODE,
  type PairSocket,
} from '../src/pairing/pairClient';
import type { ModelContextSurface, RegisteredTool } from '../src/webmcp/types';
import { TOOL_DEFINITIONS } from '../src/webmcp/tools';

class FakeSocket implements PairSocket {
  static instances: FakeSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  // --- test helpers ---
  open(): void {
    this.onopen?.({});
  }
  serverSend(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  serverClose(code?: number, reason?: string): void {
    this.onclose?.({ code, reason });
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const ROSTER: RegisteredTool[] = [
  {
    name: 'list-designs',
    description: 'List designs',
    inputSchema: { type: 'object', properties: {} },
    window: null,
    origin: null,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add-text',
    title: 'Add text',
    description: 'Add a text element',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    window: null,
    origin: null,
  },
];

function fakeSurface(execute: (name: string, input: unknown) => Promise<string>) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const surface: ModelContextSurface & { fireToolChange(): void } = {
    isPolyfill: true,
    registerTool: async () => undefined,
    getTools: async () => ROSTER,
    executeTool: async (tool, input) => execute(typeof tool === 'string' ? tool : tool.name, input),
    addEventListener: (_type, l) => {
      listeners.add(l);
    },
    removeEventListener: (_type, l) => {
      listeners.delete(l);
    },
    fireToolChange: () => {
      for (const l of listeners) {
        if (typeof l === 'function') l(new Event('toolchange'));
        else l.handleEvent(new Event('toolchange'));
      }
    },
  };
  return surface;
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const RELATIVE_ANSWER = {
  code: 'ABC234',
  ws_url: '/pair/ws/ABC234',
  mcp_url: '/mcp/ABC234',
  expires_at: 1_800_000_000,
  ttl_seconds: 1800,
};

async function flush(): Promise<void> {
  // Two microtask turns: getTools() then send().
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetPairingForTests();
  FakeSocket.instances = [];
});

describe('resolvePairUrls — where the tab and the agent actually connect', () => {
  it('rebuilds relative relay answers from the lane base + page origin', () => {
    const out = resolvePairUrls(RELATIVE_ANSWER, '/api', 'https://studio-preview.aitherium.com');
    expect(out.wsUrl).toBe('wss://studio-preview.aitherium.com/api/pair/ws/ABC234');
    expect(out.mcpUrl).toBe('https://studio-preview.aitherium.com/api/mcp/ABC234');
  });

  it('uses ws (not wss) on a plain-http dev origin and tolerates a trailing slash', () => {
    const out = resolvePairUrls(RELATIVE_ANSWER, '/api/', 'http://localhost:5173');
    expect(out.wsUrl).toBe('ws://localhost:5173/api/pair/ws/ABC234');
    expect(out.mcpUrl).toBe('http://localhost:5173/api/mcp/ABC234');
  });

  it('honours an absolute lane base from the PUBLIC origin (studio.aitherium.com)', () => {
    const out = resolvePairUrls(
      RELATIVE_ANSWER,
      'https://studio-preview.aitherium.com/api',
      'https://studio.aitherium.com',
    );
    expect(out.wsUrl).toBe('wss://studio-preview.aitherium.com/api/pair/ws/ABC234');
    expect(out.mcpUrl).toBe('https://studio-preview.aitherium.com/api/mcp/ABC234');
  });

  it('passes absolute relay answers through, swapping https→wss for the socket', () => {
    const out = resolvePairUrls(
      {
        code: 'ABC234',
        ws_url: 'https://relay.example/api/pair/ws/ABC234',
        mcp_url: 'https://relay.example/api/mcp/ABC234',
      },
      '/api',
      'http://localhost:5173',
    );
    expect(out.wsUrl).toBe('wss://relay.example/api/pair/ws/ABC234');
    expect(out.mcpUrl).toBe('https://relay.example/api/mcp/ABC234');
    expect(
      resolvePairUrls(
        { code: 'X', ws_url: 'wss://r.example/pair/ws/X', mcp_url: 'https://r.example/mcp/X' },
        '/api',
        'http://localhost',
      ).wsUrl,
    ).toBe('wss://r.example/pair/ws/X');
  });
});

describe('startPairing — hello, call/result, error, lifecycle', () => {
  it('POSTs /pair/new, opens the socket, and sends hello with the live roster', async () => {
    const fetchSpy = fakeFetch(RELATIVE_ANSWER);
    const surface = fakeSurface(async () => '{}');
    const st = await startPairing('/api', {
      fetch: fetchSpy,
      socket: FakeSocket,
      surface: () => surface,
      origin: 'https://studio-preview.aitherium.com',
      now: () => 1_000,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://studio-preview.aitherium.com/api/pair/new',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(st.status).toBe('connecting');
    expect(st.code).toBe('ABC234');
    expect(st.mcpUrl).toBe('https://studio-preview.aitherium.com/api/mcp/ABC234');
    expect(st.expiresAt).toBe(1_000 + 1800 * 1000);

    const sock = FakeSocket.instances[0];
    expect(sock.url).toBe('wss://studio-preview.aitherium.com/api/pair/ws/ABC234');
    sock.open();
    await flush();
    const [hello] = sock.frames();
    expect(hello.type).toBe('hello');
    expect(hello.tools).toEqual([
      {
        name: 'list-designs',
        title: undefined,
        description: 'List designs',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'add-text',
        title: 'Add text',
        description: 'Add a text element',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        annotations: undefined,
      },
    ]);
    // Never the implementation.
    expect(JSON.stringify(hello)).not.toContain('execute');
    expect(getPairState().status).toBe('connected');

    // toolchange → the roster is announced again.
    surface.fireToolChange();
    await flush();
    expect(sock.frames().filter((f) => f.type === 'hello')).toHaveLength(2);
  });

  it('answers a call frame by executing the tool on the surface', async () => {
    const calls: Array<[string, unknown]> = [];
    const surface = fakeSurface(async (name, input) => {
      calls.push([name, input]);
      return JSON.stringify({ content: [{ type: 'text', text: 'added' }], isError: false });
    });
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => surface,
      origin: 'http://localhost:5173',
    });
    const sock = FakeSocket.instances[0];
    sock.open();
    await flush();
    sock.serverSend({ type: 'call', id: 'c1', name: 'add-text', arguments: { text: 'hi' } });
    await flush();
    expect(calls).toEqual([['add-text', { text: 'hi' }]]);
    const result = sock.frames().find((f) => f.type === 'result');
    expect(result).toEqual({
      type: 'result',
      id: 'c1',
      result: { content: [{ type: 'text', text: 'added' }], isError: false },
    });
    expect(getPairState().calls).toBe(1);
    expect(getPairState().lastTool).toBe('add-text');
  });

  it('turns a throwing tool into an error frame and still counts the call', async () => {
    const surface = fakeSurface(async () => {
      throw new DOMException('tool "nope" is not registered', 'NotFoundError');
    });
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => surface,
      origin: 'http://localhost:5173',
    });
    const sock = FakeSocket.instances[0];
    sock.open();
    await flush();
    sock.serverSend({ type: 'call', id: 'c9', name: 'nope', arguments: {} });
    await flush();
    const result = sock.frames().find((f) => f.type === 'result');
    expect(result).toEqual({
      type: 'result',
      id: 'c9',
      error: 'NotFoundError: tool "nope" is not registered',
    });
    expect(getPairState().calls).toBe(1);
  });

  it('answers ping with pong and ignores junk', async () => {
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => fakeSurface(async () => '{}'),
      origin: 'http://localhost:5173',
    });
    const sock = FakeSocket.instances[0];
    sock.open();
    await flush();
    sock.serverSend({ type: 'ping' });
    sock.onmessage?.({ data: 'not json' });
    expect(sock.frames().filter((f) => f.type === 'pong')).toHaveLength(1);
  });

  it('reconnects with backoff while the code is live, expires on 4404 / TTL', async () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    let now = 0;
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => fakeSurface(async () => '{}'),
      origin: 'http://localhost:5173',
      now: () => now,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      cancel: () => undefined,
    });
    const first = FakeSocket.instances[0];
    first.open();
    await flush();
    expect(getPairState().status).toBe('connected');

    first.serverClose(1006);
    expect(getPairState().status).toBe('reconnecting');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(1000);
    scheduled[0].fn();
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].serverClose(1006);
    expect(scheduled[1].ms).toBe(2000); // doubled

    // The relay says the code is gone → expired, no further attempts.
    scheduled[1].fn();
    FakeSocket.instances[2].serverClose(WS_CLOSE_UNKNOWN_CODE);
    expect(getPairState().status).toBe('expired');
    expect(scheduled).toHaveLength(2);

    // Past the TTL, a close is terminal too.
    resetPairingForTests();
    FakeSocket.instances = [];
    scheduled.length = 0;
    now = 0;
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => fakeSurface(async () => '{}'),
      origin: 'http://localhost:5173',
      now: () => now,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      cancel: () => undefined,
    });
    now = 1800 * 1000 + 1;
    FakeSocket.instances[0].serverClose(1006);
    expect(getPairState().status).toBe('expired');
    expect(scheduled).toHaveLength(0);
  });

  it('reports 4409 (already paired) as an error and stop() resets everything', async () => {
    const seen: string[] = [];
    const unsub = subscribePair(() => seen.push(getPairState().status));
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => fakeSurface(async () => '{}'),
      origin: 'http://localhost:5173',
    });
    FakeSocket.instances[0].serverClose(WS_CLOSE_ALREADY_PAIRED);
    expect(getPairState().status).toBe('error');
    expect(getPairState().error).toMatch(/already paired/);
    stopPairing();
    expect(getPairState()).toMatchObject({ status: 'idle', code: null, mcpUrl: null });
    expect(seen).toContain('pairing');
    expect(seen).toContain('connecting');
    unsub();

    // stop() on a live pairing closes the socket cleanly.
    await startPairing('/api', {
      fetch: fakeFetch(RELATIVE_ANSWER),
      socket: FakeSocket,
      surface: () => fakeSurface(async () => '{}'),
      origin: 'http://localhost:5173',
    });
    const live = FakeSocket.instances[1];
    stopPairing();
    expect(live.closed).toEqual({ code: 1000, reason: 'pairing ended' });
    expect(getPairState().status).toBe('idle');
  });

  it('surfaces a failed /pair/new loudly', async () => {
    await expect(
      startPairing('/api', {
        fetch: fakeFetch({ error: 'nope' }, 502),
        socket: FakeSocket,
        surface: () => null,
        origin: 'http://localhost:5173',
      }),
    ).rejects.toThrow(/502/);
    expect(getPairState().status).toBe('error');
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe('pairing is not a tool', () => {
  it('does not appear in the roster', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).not.toContain('pair');
    expect(TOOL_DEFINITIONS.some((t) => /pair|mcp/.test(t.name))).toBe(false);
  });
});
