/**
 * The single-model slot — the gating contract's second half.
 *
 * ensureModel('text' | 'image'): loading one UNLOADS the other first; never
 * two model sets resident; mutex-guarded; a failed load disables that kind
 * for the session (falling to the next tier) — never a crash.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { agentLoader, LoaderError, type ChatWorkerLike, type ImageRuntimeLike, type WebMLRuntimeModule } from '../src/agent/loader';

/** The slot tests run against a pinned Tier A so the loader uses the stubs. */
const TIER_A = 'A' as const;

/** Stub runtimes that speak the worker wire protocol. */
function makeStubRuntime(log: string[]) {
  const workers: ChatWorkerLike[] = [];
  const chatModule: WebMLRuntimeModule = {
    createBonsaiChatWorker(): ChatWorkerLike {
      let listener: ((msg: unknown) => void) | null = null;
      const worker: ChatWorkerLike = {
        post(msg) {
          if (msg.type === 'load') {
            queueMicrotask(() => listener?.({ type: 'ready', modelId: msg.modelId }));
          }
        },
        on(l) {
          listener = l as (msg: unknown) => void;
          return () => {
            if (listener === l) listener = null;
          };
        },
        interrupt() {
          log.push('interrupt');
        },
        dispose() {
          log.push('dispose:text');
        },
      };
      workers.push(worker);
      return worker;
    },
    async createBonsaiImageRuntime(): Promise<ImageRuntimeLike> {
      log.push('image:init');
      return {
        ready: true,
        async generate() {
          log.push('image:generate');
          return new Blob(['x'], { type: 'image/png' });
        },
        dispose() {
          log.push('dispose:image');
        },
      };
    },
  };
  return { chatModule, workers };
}

beforeEach(() => {
  agentLoader.reset();
  agentLoader.injectRuntimes(null);
  agentLoader.setTierOverride(TIER_A);
});

describe('single-model slot', () => {
  it('ensureModel("text") loads and fills the slot; dispose tears it down', async () => {
    const log: string[] = [];
    agentLoader.injectRuntimes({ text: makeStubRuntime(log).chatModule });
    agentLoader.setConsent(true);

    await agentLoader.ensureModel('text', { modelId: 'bonsai-4b' });
    expect(agentLoader.getSlot()).toBe('text');
    expect(agentLoader.getChatWorker()).not.toBeNull();

    await agentLoader.unload('text');
    expect(agentLoader.getSlot()).toBeNull();
    expect(log).toContain('dispose:text');
  });

  it('loading IMAGE unloads the TEXT worker FIRST — one model set at a time', async () => {
    const log: string[] = [];
    const stubs = makeStubRuntime(log);
    agentLoader.injectRuntimes({ text: stubs.chatModule, image: stubs.chatModule });
    agentLoader.setConsent(true);

    await agentLoader.ensureModel('text', { modelId: 'bonsai-1.7b' });
    expect(agentLoader.getSlot()).toBe('text');

    await agentLoader.ensureModel('image');
    expect(agentLoader.getSlot()).toBe('image');
    expect(agentLoader.getImageRuntime()).not.toBeNull();
    expect(agentLoader.getChatWorker()).toBeNull();
    // The unload happened BEFORE the image init (the contract's order).
    expect(log.indexOf('dispose:text')).toBeLessThan(log.indexOf('image:init'));
  });

  it('loading TEXT unloads the IMAGE runtime first', async () => {
    const log: string[] = [];
    const stubs = makeStubRuntime(log);
    agentLoader.injectRuntimes({ text: stubs.chatModule, image: stubs.chatModule });
    agentLoader.setConsent(true);

    await agentLoader.ensureModel('image');
    expect(agentLoader.getSlot()).toBe('image');

    await agentLoader.ensureModel('text', { modelId: 'bonsai-4b' });
    expect(agentLoader.getSlot()).toBe('text');
    expect(agentLoader.getImageRuntime()).toBeNull();
    expect(log.indexOf('dispose:image')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('dispose:image')).toBeGreaterThan(log.indexOf('image:init'));
  });

  it('a failed load marks the kind disabled for the SESSION — the next tier takes over', async () => {
    const log: string[] = [];
    const stubs = makeStubRuntime(log);
    const badImage: WebMLRuntimeModule = {
      ...stubs.chatModule,
      async createBonsaiImageRuntime() {
        throw new Error('GPU exploded (simulated)');
      },
    };
    agentLoader.injectRuntimes({ text: stubs.chatModule, image: badImage });
    agentLoader.setConsent(true);

    await expect(agentLoader.ensureModel('image')).rejects.toBeInstanceOf(LoaderError);
    expect(agentLoader.isDisabled('image')).toBe(true);
    expect(agentLoader.getSlot()).toBeNull();

    // Retrying the SAME kind fails fast with the session-disabled error.
    await expect(agentLoader.ensureModel('image')).rejects.toThrow(/disabled for this session/);

    // The OTHER kind still works.
    await agentLoader.ensureModel('text', { modelId: 'bonsai-4b' });
    expect(agentLoader.getSlot()).toBe('text');
  });

  it('consent is mandatory — no auto-load on page open (gating contract)', async () => {
    const log: string[] = [];
    agentLoader.injectRuntimes({ text: makeStubRuntime(log).chatModule });
    // NO setConsent(true).
    await expect(agentLoader.ensureModel('text')).rejects.toThrow(/consent/);
    expect(agentLoader.getSlot()).toBeNull();
    expect(agentLoader.getChatWorker()).toBeNull();
  });

  it('Tier B/C rejects image (image needs Tier A hardware) even with consent', async () => {
    // Pin the singleton at Tier B — the tier check in loadImage must refuse
    // BEFORE any runtime import happens.
    agentLoader.setTierOverride('B');
    const log: string[] = [];
    agentLoader.injectRuntimes({ image: makeStubRuntime(log).chatModule });
    agentLoader.setConsent(true);
    await expect(agentLoader.ensureModel('image')).rejects.toBeInstanceOf(LoaderError);
    expect(log).not.toContain('image:init');
    expect(agentLoader.getSlot()).toBeNull();
  });

  it('interrupt propagates to the resident worker', async () => {
    const log: string[] = [];
    const stubs = makeStubRuntime(log);
    agentLoader.injectRuntimes({ text: stubs.chatModule });
    agentLoader.setConsent(true);
    await agentLoader.ensureModel('text', { modelId: 'bonsai-4b' });
    agentLoader.interrupt('text');
    expect(log).toContain('interrupt');
  });
});
