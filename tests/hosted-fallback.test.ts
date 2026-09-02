/**
 * The fleet text lane's fallback: a turn that ERRORS on the primary before any
 * token is replayed on the secondary and the secondary's events are relayed;
 * a turn that already streamed output is never replayed (the user would see
 * the answer twice). Measured need: 2026-09-01, Bonsai segfaulted mid-judging
 * and a judge saw "agent failed: network error" with nothing behind it.
 */
import { describe, expect, it } from 'vitest';
import { createFallbackChatWorker } from '../src/agent/hostedChat';
import type { ChatWorkerLike } from '../src/agent/loader';

type Msg = Parameters<Parameters<ChatWorkerLike['on']>[0]>[0];

function fakeWorker(script: (msg: unknown, emit: (m: Msg) => void) => void) {
  const listeners = new Set<(m: Msg) => void>();
  const posted: unknown[] = [];
  const worker: ChatWorkerLike & { posted: unknown[]; interrupted: number; disposed: number } = {
    posted,
    interrupted: 0,
    disposed: 0,
    post(msg) {
      posted.push(msg);
      script(msg, (m) => listeners.forEach((l) => l(m)));
    },
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    interrupt() {
      this.interrupted += 1;
    },
    dispose() {
      this.disposed += 1;
    },
  };
  return worker;
}

const req = { type: 'generate', prompt: 'hi' } as unknown as Parameters<ChatWorkerLike['post']>[0];

describe('createFallbackChatWorker', () => {
  it('replays a request that errors before any token on the secondary', () => {
    const primary = fakeWorker((_m, emit) => emit({ type: 'error', message: 'agent failed: network error' } as Msg));
    const secondary = fakeWorker((_m, emit) => {
      emit({ type: 'token', text: 'ok' } as Msg);
      emit({ type: 'done', text: 'ok' } as Msg);
    });
    const reasons: string[] = [];
    const w = createFallbackChatWorker(primary, secondary, (r) => reasons.push(r));
    const seen: Msg[] = [];
    w.on((m) => seen.push(m));
    w.post(req);
    expect(secondary.posted).toHaveLength(1);
    expect(reasons).toEqual(['agent failed: network error']);
    expect(seen.map((m) => m.type)).toEqual(['token', 'done']);
  });

  it('never replays once the primary has streamed output', () => {
    const primary = fakeWorker((_m, emit) => {
      emit({ type: 'token', text: 'partial' } as Msg);
      emit({ type: 'error', message: 'stream cut' } as Msg);
    });
    const secondary = fakeWorker(() => {
      throw new Error('secondary must not be posted');
    });
    const w = createFallbackChatWorker(primary, secondary);
    const seen: Msg[] = [];
    w.on((m) => seen.push(m));
    w.post(req);
    expect(secondary.posted).toHaveLength(0);
    expect(seen.map((m) => m.type)).toEqual(['token', 'error']);
  });

  it('passes a healthy primary turn through untouched and fans out interrupt/dispose', () => {
    const primary = fakeWorker((_m, emit) => emit({ type: 'done', text: 'fine' } as Msg));
    const secondary = fakeWorker(() => undefined);
    const w = createFallbackChatWorker(primary, secondary);
    const seen: Msg[] = [];
    w.on((m) => seen.push(m));
    w.post(req);
    expect(seen.map((m) => m.type)).toEqual(['done']);
    expect(secondary.posted).toHaveLength(0);
    w.interrupt();
    w.dispose();
    expect(primary.interrupted + secondary.interrupted).toBe(2);
    expect(primary.disposed + secondary.disposed).toBe(2);
  });
});
