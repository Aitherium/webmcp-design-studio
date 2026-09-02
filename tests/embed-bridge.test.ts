/**
 * The cross-frame bridge: a framing page on an allowed origin can list the
 * studio's tools and execute them; a stranger origin is ignored; a toolchange
 * is pushed to every host that has spoken; replies never go to `*`.
 */
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_TAG, hostOriginAllowed, installEmbedBridge } from '../src/embedBridge';
import type { ModelContextSurface } from '../src/webmcp/types';

function fakeSurface() {
  const et = new EventTarget();
  const surface = Object.assign(et, {
    registerTool: async () => undefined,
    getTools: async () => [
      { name: 'create-design', description: 'make one', inputSchema: { type: 'object' }, window: null, origin: 'x' },
    ],
    executeTool: async (name: string, input?: string | Record<string, unknown>) =>
      JSON.stringify({ ran: name, input: typeof input === 'string' ? JSON.parse(input) : input }),
  }) as unknown as ModelContextSurface & EventTarget;
  return surface;
}

function fakeHost() {
  const posted: Array<{ msg: unknown; origin: string }> = [];
  const source = { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) } as unknown as Window;
  return { source, posted };
}

function deliver(target: EventTarget, data: unknown, origin: string, source: Window) {
  target.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

describe('hostOriginAllowed', () => {
  it('allows the apex, subdomains and localhost; refuses strangers', () => {
    expect(hostOriginAllowed('https://aitherium.com')).toBe(true);
    expect(hostOriginAllowed('https://portal.aitherium.com')).toBe(true);
    expect(hostOriginAllowed('http://localhost:3000')).toBe(true);
    expect(hostOriginAllowed('https://evil.example')).toBe(false);
    expect(hostOriginAllowed('https://aitherium.com.evil.example')).toBe(false);
  });
});

describe('installEmbedBridge', () => {
  it('lists and executes for an allowed host, replying to that host origin only', async () => {
    const target = new EventTarget() as unknown as Window;
    const surface = fakeSurface();
    const dispose = installEmbedBridge({ getSurface: () => surface, target });
    const host = fakeHost();
    deliver(target as unknown as EventTarget, { bridge: BRIDGE_TAG, v: 1, op: 'list' }, 'https://aitherium.com', host.source);
    await vi.waitFor(() => expect(host.posted.length).toBe(1));
    expect(host.posted[0].origin).toBe('https://aitherium.com');
    const tools = (host.posted[0].msg as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['create-design']);

    deliver(target as unknown as EventTarget,
      { bridge: BRIDGE_TAG, v: 1, op: 'execute', id: 'r1', name: 'create-design', input: { name: 'Flyer' } },
      'https://aitherium.com', host.source);
    await vi.waitFor(() => expect(host.posted.length).toBe(2));
    const reply = host.posted[1].msg as { op: string; id: string; ok: boolean; result: string };
    expect(reply.op).toBe('result');
    expect(reply.id).toBe('r1');
    expect(reply.ok).toBe(true);
    expect(JSON.parse(reply.result)).toEqual({ ran: 'create-design', input: { name: 'Flyer' } });
    dispose();
  });

  it('ignores a stranger origin entirely', async () => {
    const target = new EventTarget() as unknown as Window;
    const dispose = installEmbedBridge({ getSurface: fakeSurface, target });
    const host = fakeHost();
    deliver(target as unknown as EventTarget, { bridge: BRIDGE_TAG, v: 1, op: 'list' }, 'https://evil.example', host.source);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.posted).toHaveLength(0);
    dispose();
  });

  it('pushes toolchange to hosts that have spoken', async () => {
    const target = new EventTarget() as unknown as Window;
    const surface = fakeSurface();
    const dispose = installEmbedBridge({ getSurface: () => surface, target });
    const host = fakeHost();
    deliver(target as unknown as EventTarget, { bridge: BRIDGE_TAG, v: 1, op: 'list' }, 'https://aitherium.com', host.source);
    await vi.waitFor(() => expect(host.posted.length).toBe(1));
    surface.dispatchEvent(new Event('toolchange'));
    await vi.waitFor(() => expect(host.posted.length).toBe(2));
    expect((host.posted[1].msg as { op: string }).op).toBe('toolchange');
    dispose();
  });
});
