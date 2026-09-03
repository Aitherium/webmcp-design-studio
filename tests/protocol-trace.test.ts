/**
 * P1.2 — the protocol feed: the registry records every register /
 * unregister / toolchange / execute, and the sequence is deterministic.
 * This pins the judge-visible story: boot registration burst → the consent
 * pair appears (toolchange) → an execute lands with its verdict and elapsed
 * time → approve-batch vanishes on commit (toolchange).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelContextPolyfill } from '../src/webmcp/polyfill';
import { ToolRegistry, type RegistryCallbacks } from '../src/webmcp/registry';
import { createStudioStore, getStudioStore, setStudioStore } from '../src/state/store';
import type { ProtocolEvent } from '../src/webmcp/types';

beforeEach(() => {
  setStudioStore(createStudioStore());
});

function setup() {
  const surface = new ModelContextPolyfill();
  const trace: ProtocolEvent[] = [];
  const registry = new ToolRegistry(
    () => surface,
    {
      onStatus: () => {},
      onToolsChanged: () => {},
      onTrace: (e) => trace.push(e),
    } satisfies RegistryCallbacks,
  );
  return { surface, registry, trace };
}

describe('protocol feed — the registry records the WebMCP story (P1.2)', () => {
  it('boot: exactly the live roster registers (17 = 19 defs minus the consent pair)', async () => {
    const { registry, trace } = setup();
    await registry.reconcile(getStudioStore().getState());
    const registers = trace.filter((e) => e.kind === 'register');
    expect(registers).toHaveLength(17);
    expect(registers.map((e) => e.tool)).not.toContain('approve-batch');
    expect(registers.map((e) => e.tool)).not.toContain('undo');
    // The first toolchange records the whole roster appearing (the delta
    // lives in the event's `tool` field — it names what changed).
    expect(trace.some((e) => e.kind === 'toolchange' && e.tool.includes('+create-design'))).toBe(true);
  });

  it('a pending batch registers the consent pair + fires toolchange; commit unregisters approve-batch', async () => {
    const { surface, registry, trace } = setup();
    const store = getStudioStore();
    store.getState().createDesign({ name: 'F', size: 'square' });
    await registry.reconcile(store.getState());

    store.getState().addElement({ type: 'text', text: 'hi', x: 0, y: 0, width: 50, height: 20 });
    await registry.reconcile(store.getState());
    const appear = trace.filter((e) => e.kind === 'register').map((e) => e.tool);
    expect(appear).toContain('approve-batch');
    expect(appear).toContain('undo');
    const tc = trace.filter((e) => e.kind === 'toolchange').at(-1);
    expect(tc?.tool).toContain('+approve-batch');
    expect(tc?.tool).toContain('+undo');

    // An execute lands with its verdict + elapsed time (the feed line).
    const out = await surface.executeTool('approve-batch', {});
    expect(out).toBeTruthy();
    const exec = trace.filter((e) => e.kind === 'execute').at(-1);
    expect(exec?.tool).toBe('approve-batch');
    expect(exec?.ok).toBe(true);
    expect(exec?.elapsedMs).toBeTypeOf('number');
    expect(exec?.elapsedMs).toBeGreaterThanOrEqual(0);

    await registry.reconcile(getStudioStore().getState());
    const gone = trace.filter((e) => e.kind === 'unregister').map((e) => e.tool);
    expect(gone).toContain('approve-batch');
    expect(gone).not.toContain('undo'); // canUndo keeps undo registered
    const tc2 = trace.filter((e) => e.kind === 'toolchange').at(-1);
    expect(tc2?.tool).toContain('-approve-batch');
  });

  it('an execute failure records ok:false — the feed never lies about a dead end', async () => {
    const { surface, registry, trace } = setup();
    await registry.reconcile(getStudioStore().getState());
    // export-design IS registered at boot and fails honestly on an empty
    // canvas (fail() sets isError) — the wrapper must record ✗, not ✓.
    const out = await surface.executeTool('export-design', {});
    expect(JSON.parse(out).content?.[0]?.text).toContain('no design exists');
    const failed = trace.filter((e) => e.kind === 'execute' && e.tool === 'export-design').at(-1);
    expect(failed?.ok).toBe(false);
    expect(failed?.elapsedMs).toBeTypeOf('number');
    // An unregistered tool never reaches the wrapper — the polyfill refuses
    // it before any execute event exists (nothing to record, nothing to lie about).
    await expect(surface.executeTool('approve-batch', {})).rejects.toThrow();
    expect(trace.some((e) => e.kind === 'execute' && e.tool === 'approve-batch')).toBe(false);
  });
});
