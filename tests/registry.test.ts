/**
 * Dual-surface registry: the dynamic-reconcile story — 5 always-on tools,
 * design tools appear once a design exists, approve-batch appears ONLY
 * while a batch is pending and vanishes on commit; failures surface LOUD.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelContextPolyfill } from '../src/webmcp/polyfill';
import { ToolRegistry, type RegistryCallbacks } from '../src/webmcp/registry';
import { createStudioStore, getStudioStore, setStudioStore, type WebMCPStatus } from '../src/state/store';

beforeEach(() => {
  setStudioStore(createStudioStore());
});

interface Harness {
  surface: ModelContextPolyfill;
  registry: ToolRegistry;
  statuses: WebMCPStatus[];
  toolLists: string[][];
}

/** A minimal surface whose registerTool behavior can be swapped. */
function stubSurface(register: () => Promise<void>): ModelContextPolyfill {
  const surface = new ModelContextPolyfill();
  surface.registerTool = register;
  return surface;
}

function setup(callbacks?: Partial<RegistryCallbacks>): Harness {
  const surface = new ModelContextPolyfill();
  const statuses: WebMCPStatus[] = [];
  const toolLists: string[][] = [];
  const registry = new ToolRegistry(
    () => surface,
    {
      onStatus: (s) => statuses.push(s),
      onToolsChanged: (names) => toolLists.push(names),
      ...callbacks,
    },
  );
  return { surface, registry, statuses, toolLists };
}

async function namesOf(h: Harness): Promise<string[]> {
  return (await h.surface.getTools()).map((t) => t.name).sort();
}

// generate-image is ALWAYS_ON since 2026-08-30: gating registration on
// currentDocId filtered it out of the surface on a fresh page ("5 tools
// live" with no image tool), so the agent could never call it — the doc
// requirement is a call-time guard, not a registration gate.
const ALWAYS_ON = [
  'create-design',
  'list-designs',
  'recall-preference',
  'remember-preference',
  'undo',
  'generate-image',
  // The IRIS + Media-Forge service tools (2026-08-31, the WebMCP demo):
  // always registered, call-time guards answer "no design exists".
  'iris-generate',
  'mediaforge-remove-bg',
  // P2.3: the production exhibit — the log is read-only and
  // always available, so the agent can ask "what has the studio produced?"
  // on a fresh page with no design.
  'production-log',
  'draft-variants',
  'search-preferences',
  // The VIDEO lane (2026-09-03): always registered, call-time guard answers
  // "no design exists"; video-status needs no design at all.
  'render-video',
  'video-status',
];
const DESIGN_ONLY = [
  'add-text',
  'duplicate-design',
  'edit-element',
  'export-design',
  'get-design-state',
  'remove-element',
  'restyle-design',
];

describe('ToolRegistry.reconcile', () => {
  it('starts with every tool except the consent pair — an absent tool is a dead end the agent cannot see (2026-08-30: a fresh page registered 6 tools; the re-issue\'s get-design-state answered "not registered"). Call-time guards answer "no design exists" instead', async () => {
    const h = setup();
    await h.registry.reconcile(getStudioStore().getState());
    const names = await namesOf(h);
    // P1.3: undo joined approve-batch as the pending-only pair — the dynamic
    // toolchange story is the consent boundary, and it fires for BOTH tools.
    expect(names.sort()).toEqual([...ALWAYS_ON, ...DESIGN_ONLY].filter((n) => n !== 'undo').sort());
    expect(names).not.toContain('approve-batch'); // the consent pair — the toolchange demo
    expect(names).not.toContain('undo');
  });

  it('design tools appear once a design exists', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    store.getState().createDesign({ name: 'Flyer', size: 'flyer' });
    await h.registry.reconcile(store.getState());
    const names = await namesOf(h);
    expect(names).toEqual(expect.arrayContaining(DESIGN_ONLY));
    expect(names).toEqual(expect.arrayContaining(ALWAYS_ON.filter((n) => n !== 'undo')));
    expect(names).not.toContain('approve-batch');
  });

  it('the consent pair appears with a pending batch; approve-batch vanishes on commit while undo stays as the safety net (P1.3)', async () => {
    const h = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'Flyer', size: 'square' });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');
    expect(await namesOf(h)).not.toContain('undo');

    store.getState().addElement({ type: 'text', text: 'hi', x: 0, y: 0, width: 50, height: 20 });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('approve-batch');
    expect(await namesOf(h)).toContain('undo');

    store.getState().commitBatch();
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');
    // canUndo is true after a commit — undo stays registered (its natural
    // moment is right after approving, when the mistake becomes visible).
    expect(await namesOf(h)).toContain('undo');
  });

  it('a design with pending edits re-registers approve-batch after a discard+new edit', async () => {
    const h = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'X', size: 'square' });
    store.getState().addElement({ type: 'text', text: 'a', x: 0, y: 0, width: 10, height: 10 });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('approve-batch');

    store.getState().discardBatch();
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');

    store.getState().addElement({ type: 'text', text: 'b', x: 0, y: 0, width: 10, height: 10 });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('approve-batch');
  });

  it('approve-batch re-registers when a batch appears and disappears (the one deliberate gate)', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');

    store.getState().createDesign({ name: 'D', size: 'square' });
    store.getState().addElement({ type: 'text', text: 'x', x: 0, y: 0, width: 10, height: 10 });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('approve-batch');

    // Batch committed → gone again (the toolchange demo).
    store.getState().commitBatch();
    await h.registry.reconcile(getStudioStore().getState());
    expect(await namesOf(h)).not.toContain('approve-batch');

    // Design again → re-registered with a fresh controller.
    getStudioStore().getState().createDesign({ name: 'D2', size: 'square' });
    await h.registry.reconcile(getStudioStore().getState());
    expect(await namesOf(h)).toContain('get-design-state');
  });

  it('toolchange fires on every registration change (the consent-pair flip is the dynamic event)', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).toHaveLength(ALWAYS_ON.length + DESIGN_ONLY.length - 1);

    store.getState().createDesign({ name: 'F', size: 'poster' });
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)!.length).toBe(ALWAYS_ON.length + DESIGN_ONLY.length - 1);

    store.getState().addElement({ type: 'text', text: 'x', x: 0, y: 0, width: 10, height: 10 });
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).toContain('approve-batch');
    expect(h.toolLists.at(-1)).toContain('undo');

    store.getState().commitBatch();
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).not.toContain('approve-batch');
    // undo stays while the design has committed versions (canUndo).
    expect(h.toolLists.at(-1)).toContain('undo');
  });

  it('a registerTool rejection surfaces LOUD in status failures', async () => {
    const statuses: WebMCPStatus[] = [];
    const rejecting = stubSurface(async () => {
      throw new DOMException('tools feature denied', 'NotAllowedError');
    });
    const registry = new ToolRegistry(
      () => rejecting,
      { onStatus: (s) => statuses.push(s), onToolsChanged: () => {} },
    );

    await registry.reconcile(getStudioStore().getState());
    const last = statuses.at(-1)!;
    expect(last.surface).toBe('polyfill');
    expect(last.failures.length).toBeGreaterThan(0);
    expect(last.failures[0].name).toBe('list-designs');
    expect(last.failures[0].error).toContain('NotAllowedError');
  });

  it('an absent surface reports surface off without throwing', async () => {
    const statuses: WebMCPStatus[] = [];
    const registry = new ToolRegistry(
      () => null,
      { onStatus: (s) => statuses.push(s), onToolsChanged: () => {} },
    );
    await registry.reconcile(getStudioStore().getState());
    const last = statuses.at(-1)!;
    expect(last.surface).toBe('off');
    expect(last.failures.length).toBeGreaterThan(0);
  });

  it('reconcile with an empty store after a design keeps every tool except approve-batch', async () => {
    const h = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'T', size: 'square' });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('add-text');
    await h.registry.reconcile(createStudioStore().getState());
    const names = await namesOf(h);
    // P1.3: undo is consent-pair-gated, so the empty-store roster is
    // ALWAYS_ON + DESIGN_ONLY minus undo (approve-batch was already absent).
    expect(names).toEqual([...ALWAYS_ON, ...DESIGN_ONLY].filter((n) => n !== 'undo').sort());
  });
});

/**
 * Regression: reconcile must not feed its own status writes back into
 * reconcile. The real wiring (main.tsx) subscribes the registry to the
 * store; reconcile() unconditionally emits status at the end, and zustand
 * notifies subscribers on every set — so on the old code one reconcile
 * spawned an endless microtask loop that starved the event loop before
 * first paint (measured 2026-08-26 in Chrome, stack:
 * reconcileNow → emitStatus → onStatus → setWebMCPStatus → subscriber →
 * reconcile). Two guards close it: the store setters skip unchanged values
 * and the subscriber only reconciles on design-slice changes. This test
 * drives the REAL store + subscriber wiring and asserts the loop settles.
 * Mutation check: reverting BOTH guards (old main.tsx wiring + old
 * setters) makes this test HANG forever — the exact production symptom.
 */
it('reconcile settles — no endless status→reconcile loop', async () => {
  const store = createStudioStore();
  setStudioStore(store);
  const surface = new ModelContextPolyfill();
  const statuses: WebMCPStatus[] = [];
  const registry = new ToolRegistry(
    () => surface,
    {
      // Real main.tsx wiring: status flows INTO the store, whose notify would
      // feed the subscriber (and thus reconcile) on broken code.
      onStatus: (s) => { statuses.push(s); store.getState().setWebMCPStatus(s); },
      onToolsChanged: () => undefined,
    },
  );
  // main.tsx wiring (design-slice guard included).
  store.subscribe((state, prev) => {
    if (state.docs !== prev.docs || state.pendingBatch !== prev.pendingBatch ||
        state.currentDocId !== prev.currentDocId) {
      void registry.reconcile(state);
    }
  });
  void registry.reconcile(store.getState());

  // Drain microtasks in a bounded loop; the old code's status writes keep
  // notifying the subscriber and never settle. The new code settles after
  // the first reconcile (status identical → setter skips → no notify).
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  const settledAt = statuses.length;
  // Give the loop every chance to keep going on broken code.
  await new Promise((r) => setTimeout(r, 20));
  expect(statuses.length).toBe(settledAt);
  expect(statuses.length).toBeLessThanOrEqual(2); // initial + first emit
  expect(statuses[0]?.surface).toBe('polyfill');
  expect(store.getState().webmcpStatus?.surface).toBe('polyfill');
});
