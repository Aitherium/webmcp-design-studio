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
  it('starts with the always-on tools only', async () => {
    const h = setup();
    await h.registry.reconcile(getStudioStore().getState());
    const names = await namesOf(h);
    expect(names.sort()).toEqual([...ALWAYS_ON].sort());
  });

  it('design tools appear once a design exists', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    store.getState().createDesign({ name: 'Flyer', size: 'flyer' });
    await h.registry.reconcile(store.getState());
    const names = await namesOf(h);
    expect(names).toEqual(expect.arrayContaining(DESIGN_ONLY));
    expect(names).toEqual(expect.arrayContaining(ALWAYS_ON));
    expect(names).not.toContain('approve-batch');
  });

  it('approve-batch appears only while pending and disappears after commit', async () => {
    const h = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'Flyer', size: 'square' });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');

    store.getState().addElement({ type: 'text', text: 'hi', x: 0, y: 0, width: 50, height: 20 });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('approve-batch');

    store.getState().commitBatch();
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('approve-batch');
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

  it('an aborted tool re-registers when its predicate flips back', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).not.toContain('get-design-state');

    store.getState().createDesign({ name: 'D', size: 'square' });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('get-design-state');

    // No design any more (fresh store holds none) → abort → gone.
    setStudioStore(createStudioStore());
    await h.registry.reconcile(getStudioStore().getState());
    expect(await namesOf(h)).not.toContain('get-design-state');

    // Design again → re-registered with a fresh controller.
    getStudioStore().getState().createDesign({ name: 'D2', size: 'square' });
    await h.registry.reconcile(getStudioStore().getState());
    expect(await namesOf(h)).toContain('get-design-state');
  });

  it('toolchange fires on every registration change (dynamic list updates)', async () => {
    const h = setup();
    const store = getStudioStore();
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).toHaveLength(ALWAYS_ON.length);

    store.getState().createDesign({ name: 'F', size: 'poster' });
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)!.length).toBe(ALWAYS_ON.length + DESIGN_ONLY.length);

    store.getState().addElement({ type: 'text', text: 'x', x: 0, y: 0, width: 10, height: 10 });
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).toContain('approve-batch');

    store.getState().commitBatch();
    await h.registry.reconcile(store.getState());
    expect(h.toolLists.at(-1)).not.toContain('approve-batch');
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

  it('reconcile with an empty store after a design keeps only always-on tools', async () => {
    const h = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'T', size: 'square' });
    await h.registry.reconcile(store.getState());
    expect(await namesOf(h)).toContain('add-text');
    await h.registry.reconcile(createStudioStore().getState());
    const names = await namesOf(h);
    expect(names).toEqual([...ALWAYS_ON].sort());
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
