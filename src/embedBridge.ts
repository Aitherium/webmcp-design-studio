/**
 * Cross-frame WebMCP bridge — the studio's tools reach the PAGE THAT FRAMES IT.
 *
 * WebMCP tools are per-document: an agent driving aitherium.com/playground sees
 * that page's `document.modelContext`, not the studio's inside the iframe. So in
 * embed mode the studio answers a tiny postMessage protocol that lets the host
 * page register PROXY tools on its own `document.modelContext` and forward
 * calls here — the playground becomes a real WebMCP host whose tools include
 * the studio's, and the consent boundary (approve-batch appearing/vanishing)
 * travels with them via `toolchange`.
 *
 * Wire protocol (all messages `{ bridge: 'webmcp-studio', v: 1, ... }`):
 *   host → studio  { op: 'list' }
 *   studio → host  { op: 'tools', tools: [{name, title, description, inputSchema, annotations}] }
 *   host → studio  { op: 'execute', id, name, input }        (input: object or JSON string)
 *   studio → host  { op: 'result', id, ok, result | error }  (result: the DOMString the API returns)
 *   studio → host  { op: 'toolchange', tools: [...] }        (unsolicited, after every change)
 *
 * Trust: only messages from an allow-listed host origin are answered, and
 * replies go to `event.source` with `event.origin` as the target — never `*`.
 * Standalone mode installs nothing (the submission-integrity invariant).
 */
import type { ModelContextSurface, RegisteredTool } from './webmcp/types';

export const BRIDGE_TAG = 'webmcp-studio';
export const BRIDGE_VERSION = 1;

/** Hosts allowed to drive the studio through the frame. */
export const ALLOWED_HOST_ORIGINS: ReadonlyArray<string | RegExp> = [
  'https://aitherium.com',
  'https://www.aitherium.com',
  /^https:\/\/[a-z0-9-]+\.aitherium\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function hostOriginAllowed(origin: string, allow: ReadonlyArray<string | RegExp> = ALLOWED_HOST_ORIGINS): boolean {
  return allow.some((rule) => (typeof rule === 'string' ? rule === origin : rule.test(origin)));
}

export interface BridgeToolSummary {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

function summarize(tools: RegisteredTool[]): BridgeToolSummary[] {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations as Record<string, unknown> | undefined,
  }));
}

function surface(): ModelContextSurface | null {
  const doc = (document as { modelContext?: ModelContextSurface }).modelContext;
  if (doc) return doc;
  return (navigator as { modelContext?: ModelContextSurface }).modelContext ?? null;
}

/**
 * Install the bridge. Returns a disposer. `getSurface` is injectable for tests.
 */
export function installEmbedBridge(options?: {
  getSurface?: () => ModelContextSurface | null;
  allow?: ReadonlyArray<string | RegExp>;
  target?: Window;
}): () => void {
  const win = options?.target ?? window;
  const getSurface = options?.getSurface ?? surface;
  const allow = options?.allow ?? ALLOWED_HOST_ORIGINS;
  const hosts = new Set<{ source: MessageEventSource; origin: string }>();

  const send = (source: MessageEventSource | null, origin: string, payload: Record<string, unknown>) => {
    if (!source) return;
    (source as Window).postMessage({ bridge: BRIDGE_TAG, v: BRIDGE_VERSION, ...payload }, origin as never);
  };

  const listTools = async (): Promise<BridgeToolSummary[]> => {
    const s = getSurface();
    if (!s) return [];
    return summarize(await s.getTools());
  };

  const onMessage = async (ev: MessageEvent) => {
    const data = ev.data as { bridge?: string; v?: number; op?: string; id?: string; name?: string; input?: unknown } | null;
    if (!data || data.bridge !== BRIDGE_TAG) return;
    if (!hostOriginAllowed(ev.origin, allow)) return;
    if (ev.source) hosts.add({ source: ev.source, origin: ev.origin });
    if (data.op === 'list') {
      send(ev.source, ev.origin, { op: 'tools', tools: await listTools() });
      return;
    }
    if (data.op === 'execute' && typeof data.id === 'string' && typeof data.name === 'string') {
      const s = getSurface();
      if (!s) {
        send(ev.source, ev.origin, { op: 'result', id: data.id, ok: false, error: 'no WebMCP surface in the studio' });
        return;
      }
      try {
        const input = typeof data.input === 'string' ? data.input : JSON.stringify(data.input ?? {});
        const result = await s.executeTool(data.name, input);
        send(ev.source, ev.origin, { op: 'result', id: data.id, ok: true, result });
      } catch (err) {
        send(ev.source, ev.origin, {
          op: 'result',
          id: data.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const onToolChange = async () => {
    if (hosts.size === 0) return;
    const tools = await listTools();
    for (const h of hosts) send(h.source, h.origin, { op: 'toolchange', tools });
  };

  win.addEventListener('message', onMessage);
  const s = getSurface();
  const et = s as unknown as EventTarget | null;
  if (et && typeof et.addEventListener === 'function') et.addEventListener('toolchange', onToolChange);

  return () => {
    win.removeEventListener('message', onMessage);
    if (et && typeof et.removeEventListener === 'function') et.removeEventListener('toolchange', onToolChange);
    hosts.clear();
  };
}
