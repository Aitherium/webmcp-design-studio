/**
 * Pending-batch semantics: everything the agent does lands uncommitted;
 * approve applies it as one version, discard drops it, undo pops committed
 * versions (one batch = one step).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStudioStore, getStudioStore, setStudioStore } from '../src/state/store';
import { effectiveDoc } from '../src/state/doc';

beforeEach(() => {
  setStudioStore(createStudioStore());
});

function makeDesign(): string {
  const store = getStudioStore();
  const doc = store.getState().createDesign({ name: 'Test', size: 'square', palette: 'neon' });
  return doc.id;
}

function addText(text: string): string {
  return getStudioStore().getState().addElement({
    type: 'text',
    text,
    x: 10,
    y: 10,
    width: 200,
    height: 40,
  });
}

describe('pending → approve semantics', () => {
  it('agent edits land in a pending batch, not in the committed doc', () => {
    makeDesign();
    const id = addText('hello');
    const s = getStudioStore().getState();
    expect(s.pendingBatch).not.toBeNull();
    expect(s.pendingBatch!.ops).toHaveLength(1);
    expect(s.docs[0].elements).toHaveLength(0); // committed doc untouched
    expect(effectiveDoc(s.docs[0], s.pendingBatch).elements[0].id).toBe(id);
  });

  it('approve applies the whole batch, clears pending, and pushes one version', () => {
    makeDesign();
    addText('hello');
    addText('world');
    const committed = getStudioStore().getState().commitBatch();
    const s = getStudioStore().getState();
    expect(s.pendingBatch).toBeNull();
    expect(committed!.elements).toHaveLength(2);
    expect(s.docs[0].elements).toHaveLength(2);
  });

  it('approve with no pending batch returns null', () => {
    makeDesign();
    expect(getStudioStore().getState().commitBatch()).toBeNull();
  });

  it('discard drops the pending batch without touching the doc', () => {
    makeDesign();
    addText('hello');
    getStudioStore().getState().discardBatch();
    const s = getStudioStore().getState();
    expect(s.pendingBatch).toBeNull();
    expect(s.docs[0].elements).toHaveLength(0);
  });
});

describe('undo semantics', () => {
  it('one batch commit is one undo step', () => {
    makeDesign();
    addText('a');
    addText('b');
    getStudioStore().getState().commitBatch();
    const applied = getStudioStore().getState().undo();
    expect(applied).toBe(1);
    const s = getStudioStore().getState();
    expect(s.docs[0].elements).toHaveLength(0); // both edits rolled back
    expect(s.pendingBatch).toBeNull();
  });

  it('undo with an empty version stack returns 0 (nothing to undo)', () => {
    makeDesign();
    expect(getStudioStore().getState().undo()).toBe(0);
  });

  it('undo refuses while a batch is pending', () => {
    makeDesign();
    addText('a');
    expect(getStudioStore().getState().undo()).toBe(0);
    expect(getStudioStore().getState().pendingBatch).not.toBeNull();
  });

  it('undo(steps) pops up to the requested number of versions', () => {
    makeDesign();
    addText('a');
    getStudioStore().getState().commitBatch();
    addText('b');
    getStudioStore().getState().commitBatch();
    const applied = getStudioStore().getState().undo(2);
    expect(applied).toBe(2);
    expect(getStudioStore().getState().docs[0].elements).toHaveLength(0);
  });
});

describe('op coalescing and validation', () => {
  it('consecutive updates to the same element coalesce into one op', () => {
    makeDesign();
    const id = addText('hello');
    const store = getStudioStore();
    store.getState().updateElement(id, { text: 'hell' });
    store.getState().updateElement(id, { text: 'hel', fontSize: 72 });
    // add + ONE coalesced update (typing = one op, not one per keystroke)
    expect(store.getState().pendingBatch!.ops).toHaveLength(2);
    const op = store.getState().pendingBatch!.ops[1];
    expect(op.kind).toBe('update');
    if (op.kind === 'update') {
      expect(op.patch).toMatchObject({ text: 'hel', fontSize: 72 });
    }
  });

  it('updating an unknown element id fails and appends nothing', () => {
    makeDesign();
    expect(getStudioStore().getState().updateElement('nope', { text: 'x' })).toBe(false);
    expect(getStudioStore().getState().pendingBatch).toBeNull();
  });

  it('removing an unknown element id fails', () => {
    makeDesign();
    expect(getStudioStore().getState().removeElement('nope')).toBe(false);
  });

  it('a remove supersedes a pending update of the same element', () => {
    makeDesign();
    const id = addText('hello');
    const store = getStudioStore();
    store.getState().updateElement(id, { fontSize: 80 });
    expect(store.getState().pendingBatch!.ops).toHaveLength(2); // add + update
    store.getState().removeElement(id);
    // The update op is dropped; add + remove remain.
    expect(store.getState().pendingBatch!.ops).toHaveLength(2);
    const last = store.getState().pendingBatch!.ops[1];
    expect(last.kind).toBe('remove');
    // Effective doc: element gone.
    const eff = effectiveDoc(store.getState().docs[0], store.getState().pendingBatch);
    expect(eff.elements).toHaveLength(0);
  });

  it('addElement assigns an increasing zIndex', () => {
    makeDesign();
    const a = addText('a');
    const b = addText('b');
    const eff = effectiveDoc(getStudioStore().getState().docs[0], getStudioStore().getState().pendingBatch);
    const za = eff.elements.find((e) => e.id === a)!.zIndex;
    const zb = eff.elements.find((e) => e.id === b)!.zIndex;
    expect(zb).toBe(za + 1);
  });
});

describe('design lifecycle guards', () => {
  it('create-design switches to the new doc and starts clean', () => {
    makeDesign();
    addText('hello');
    const store = getStudioStore();
    const doc = store.getState().createDesign({ name: 'Second', size: 'story' });
    const s = store.getState();
    expect(s.currentDocId).toBe(doc.id);
    expect(s.pendingBatch).toBeNull(); // in-flight batch dropped by design
    expect(doc.size).toEqual({ width: 1080, height: 1920 });
  });

  it('duplicate-design clones committed elements but not the pending batch', () => {
    makeDesign();
    addText('hello');
    getStudioStore().getState().commitBatch();
    const copy = getStudioStore().getState().duplicateDesign('Copy');
    expect(copy!.name).toBe('Copy');
    expect(copy!.elements).toHaveLength(1);
    expect(copy!.id).not.toBe(getStudioStore().getState().docs[0].id);
  });

  it('duplicate-design returns null with no design', () => {
    expect(getStudioStore().getState().duplicateDesign()).toBeNull();
  });
});
