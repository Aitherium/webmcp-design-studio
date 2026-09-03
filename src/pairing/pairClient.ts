/**
 * Pairing client — "Connect your own agent" (2026-09-03, WebMCP lane 4).
 *
 * The studio tab pairs itself to a public remote-MCP endpoint so a visitor's
 * OWN ChatGPT / Claude (any remote-MCP client) can drive THIS tab's WebMCP
 * tools. The relay (AitherStudioPair) never sees a tool implementation: it
 * forwards `tools/call` over this WebSocket and the tab executes the tool on
 * its own `document.modelContext` surface, exactly the way a browser agent
 * would. Pairing is therefore NOT a tool and never touches the roster.
 *
 * Wire protocol (mirrors AitherStudioPair.py):
 *   tab    -> relay  {type:"hello", tools:[{name,title?,description,inputSchema,annotations?}]}
 *   relay  -> tab    {type:"call", id, name, arguments}
 *   tab    -> relay  {type:"result", id, result} | {type:"result", id, error}
 *   relay  -> tab    {type:"ping"}   (answered with {type:"pong"})
 *
 * A repeat `hello` REPLACES the roster server-side, so the tab re-sends it on
 * every `toolchange` — the remote agent always lists the live set (the consent
 * pair appears and vanishes for it just as it does for a browser agent).
 *
 * Everything the browser gives us is injectable (fetch, WebSocket, the surface,
 * the clock, the scheduler) so the whole state machine runs under vitest with
 * a fake socket.
 */
import { detectSurface } from '../webmcp/registry';
import type { ModelContextSurface, RegisteredTool } from '../webmcp/types';
import { PAIR_BASE } from '../webmcp/tools/serviceBases';

export type PairStatus =
  | 'idle'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'expired'
  | 'error';

export interface PairState {
  status: PairStatus;
  code: string | null;
  /** The URL the visitor pastes into their agent's MCP-server settings. */
  mcpUrl: string | null;
  /** ms since epoch; null until paired. */
  expiresAt: number | null;
  error: string | null;
  /** Tool calls served to the remote agent this pairing. */
  calls: number;
  lastTool: string | null;
}

export interface PairNewResponse {
  code: string;
  ws_url: string;
  mcp_url: string;
  /** seconds since epoch (the relay's clock). */
  expires_at: number;
  ttl_seconds?: number;
}

/** The subset of the WebSocket API the client uses — a fake implements it. */
export interface PairSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type PairSocketCtor = new (url: string) => PairSocket;

export interface PairDeps {
  fetch?: typeof fetch;
  socket?: PairSocketCtor;
  surface?: () => ModelContextSurface | null;
  /** The page origin relative URLs resolve against. */
  origin?: string;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface HelloTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: RegisteredTool['annotations'];
}

type RelayFrame =
  | { type: 'call'; id: string; name: string; arguments?: unknown }
  | { type: 'ping' }
  | { type: string };

/** Relay close codes (AitherStudioPair.py). */
export const WS_CLOSE_UNKNOWN_CODE = 4404;
export const WS_CLOSE_ALREADY_PAIRED = 4409;

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;

const INITIAL: PairState = {
  status: 'idle',
  code: null,
  mcpUrl: null,
  expiresAt: null,
  error: null,
  calls: 0,
  lastTool: null,
};

// ---------------------------------------------------------------------------
// The tiny store
// ---------------------------------------------------------------------------

let state: PairState = INITIAL;
const listeners = new Set<() => void>();

export function getPairState(): PairState {
  return state;
}

export function subscribePair(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(patch: Partial<PairState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// ---------------------------------------------------------------------------
// URL derivation
// ---------------------------------------------------------------------------

function toWsScheme(url: URL): URL {
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  return url;
}

function isAbsolute(u: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
}

/**
 * The relay returns absolute URLs when it knows its public base and RELATIVE
 * ones (`/pair/ws/<CODE>`, `/mcp/<CODE>`) otherwise. A relative path is the
 * relay's OWN route, which behind the studio's nginx lives under the lane
 * base (`/api`) — so relative answers are rebuilt from the base the tab used
 * for `/pair/new` and resolved against the page origin; wss follows https.
 */
export function resolvePairUrls(
  resp: Pick<PairNewResponse, 'code' | 'ws_url' | 'mcp_url'>,
  baseUrl: string,
  origin: string,
): { wsUrl: string; mcpUrl: string } {
  const base = baseUrl.replace(/\/+$/, '');
  const wsUrl = isAbsolute(resp.ws_url)
    ? toWsScheme(new URL(resp.ws_url)).href
    : toWsScheme(new URL(`${base}/pair/ws/${resp.code}`, origin)).href;
  const mcpUrl = isAbsolute(resp.mcp_url)
    ? new URL(resp.mcp_url).href
    : new URL(`${base}/mcp/${resp.code}`, origin).href;
  return { wsUrl, mcpUrl };
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

interface Session {
  code: string;
  wsUrl: string;
  expiresAt: number;
  socket: PairSocket | null;
  backoffMs: number;
  timer: unknown;
  stopped: boolean;
  deps: Required<PairDeps>;
  onToolChange: (() => void) | null;
}

let session: Session | null = null;

function fillDeps(deps: PairDeps): Required<PairDeps> {
  return {
    fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    socket: deps.socket ?? (WebSocket as unknown as PairSocketCtor),
    surface: deps.surface ?? detectSurface,
    origin: deps.origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost'),
    now: deps.now ?? (() => Date.now()),
    schedule: deps.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
    cancel: deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
  };
}

async function currentRoster(surface: ModelContextSurface | null): Promise<HelloTool[]> {
  if (!surface) return [];
  const tools = await surface.getTools();
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}

async function sendHello(s: Session): Promise<void> {
  const roster = await currentRoster(s.deps.surface());
  s.socket?.send(JSON.stringify({ type: 'hello', tools: roster }));
}

/** Run one forwarded call on the live surface and answer it. */
async function serveCall(
  s: Session,
  frame: { id: string; name: string; arguments?: unknown },
): Promise<void> {
  const surface = s.deps.surface();
  const args =
    frame.arguments && typeof frame.arguments === 'object'
      ? (frame.arguments as Record<string, unknown>)
      : {};
  let reply: Record<string, unknown>;
  if (!surface) {
    reply = { type: 'result', id: frame.id, error: 'WebMCP surface is absent in this tab' };
  } else {
    try {
      // executeTool goes through the registry's wrapped execute, so the call
      // lands in the protocol feed like any browser-agent call.
      const text = await surface.executeTool(frame.name, args);
      let result: unknown = text;
      try {
        result = JSON.parse(text);
      } catch {
        /* a tool may return a bare string — pass it through */
      }
      reply = { type: 'result', id: frame.id, result };
    } catch (err) {
      reply = { type: 'result', id: frame.id, error: describeError(err) };
    }
  }
  setState({ calls: state.calls + 1, lastTool: frame.name });
  s.socket?.send(JSON.stringify(reply));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function connect(s: Session): void {
  if (s.stopped) return;
  if (s.deps.now() >= s.expiresAt) {
    finish(s, { status: 'expired', error: null });
    return;
  }
  setState({ status: state.status === 'connected' ? 'reconnecting' : state.status });
  const socket = new s.deps.socket(s.wsUrl);
  s.socket = socket;

  socket.onopen = () => {
    if (s.stopped || s.socket !== socket) return;
    s.backoffMs = BACKOFF_START_MS;
    void sendHello(s).then(() => {
      if (s.socket === socket && !s.stopped) setState({ status: 'connected', error: null });
    });
    const surface = s.deps.surface();
    if (surface && !s.onToolChange) {
      s.onToolChange = () => {
        void sendHello(s);
      };
      surface.addEventListener('toolchange', s.onToolChange);
    }
  };

  socket.onmessage = (ev) => {
    if (s.socket !== socket) return;
    let frame: RelayFrame;
    try {
      frame = JSON.parse(String(ev.data)) as RelayFrame;
    } catch {
      return; // not ours
    }
    if (frame.type === 'call' && 'id' in frame && 'name' in frame) {
      void serveCall(s, frame);
    } else if (frame.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }));
    }
  };

  socket.onerror = () => {
    /* onclose follows; the reconnect decision lives there */
  };

  socket.onclose = (ev) => {
    if (s.socket !== socket) return;
    s.socket = null;
    if (s.stopped) return;
    if (ev.code === WS_CLOSE_UNKNOWN_CODE) {
      finish(s, { status: 'expired', error: null });
      return;
    }
    if (ev.code === WS_CLOSE_ALREADY_PAIRED) {
      finish(s, { status: 'error', error: 'This code is already paired to another tab.' });
      return;
    }
    if (s.deps.now() >= s.expiresAt) {
      finish(s, { status: 'expired', error: null });
      return;
    }
    setState({ status: 'reconnecting' });
    const delay = s.backoffMs;
    s.backoffMs = Math.min(s.backoffMs * 2, BACKOFF_MAX_MS);
    s.timer = s.deps.schedule(() => {
      s.timer = null;
      connect(s);
    }, delay);
  };
}

function finish(s: Session, patch: Partial<PairState>): void {
  s.stopped = true;
  if (s.timer != null) s.deps.cancel(s.timer);
  s.timer = null;
  const surface = s.deps.surface();
  if (surface && s.onToolChange) surface.removeEventListener('toolchange', s.onToolChange);
  s.onToolChange = null;
  const sock = s.socket;
  s.socket = null;
  try {
    sock?.close(1000, 'pairing ended');
  } catch {
    /* already closed */
  }
  if (session === s) session = null;
  setState(patch);
}

/**
 * Mint a code and hold the pairing open. Resolves once the code is known
 * (the socket connects in the background); rejects when `/pair/new` fails.
 */
export async function startPairing(
  baseUrl: string = PAIR_BASE,
  deps: PairDeps = {},
): Promise<PairState> {
  stopPairing();
  const full = fillDeps(deps);
  setState({ ...INITIAL, status: 'pairing' });
  const base = baseUrl.replace(/\/+$/, '');
  let resp: PairNewResponse;
  try {
    const r = await full.fetch(new URL(`${base}/pair/new`, full.origin).href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`pairing relay answered ${r.status}`);
    resp = (await r.json()) as PairNewResponse;
    if (!resp || typeof resp.code !== 'string' || !resp.code) {
      throw new Error('pairing relay returned no code');
    }
  } catch (err) {
    setState({ status: 'error', error: describeError(err) });
    throw err;
  }
  const { wsUrl, mcpUrl } = resolvePairUrls(resp, base, full.origin);
  const ttlMs = (resp.ttl_seconds ?? 30 * 60) * 1000;
  // The relay's expires_at is on ITS clock; the tab's own clock + TTL is the
  // number the reconnect loop can trust.
  const expiresAt = full.now() + ttlMs;
  const s: Session = {
    code: resp.code,
    wsUrl,
    expiresAt,
    socket: null,
    backoffMs: BACKOFF_START_MS,
    timer: null,
    stopped: false,
    deps: full,
    onToolChange: null,
  };
  session = s;
  setState({ status: 'connecting', code: resp.code, mcpUrl, expiresAt, error: null });
  connect(s);
  return state;
}

/** End the pairing (the tab's side); the relay drops the code on close. */
export function stopPairing(): void {
  if (session) finish(session, { ...INITIAL });
  else if (state.status !== 'idle') setState({ ...INITIAL });
}

/** Test seam: forget everything without touching a socket. */
export function resetPairingForTests(): void {
  if (session) {
    session.stopped = true;
    if (session.timer != null) session.deps.cancel(session.timer);
    session = null;
  }
  state = INITIAL;
  listeners.clear();
}
