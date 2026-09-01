/**
 * The "image element placed" ground-truth check (BonsaiChat runTurn): the
 * scripted first turn leaves its batch PENDING for the human's Approve, so an
 * image element lives in pendingBatch.ops, NOT in the committed doc's
 * elements. The check must read the EFFECTIVE doc (committed + pending) —
 * the same view the canvas and get-design-state use.
 *
 * Measured live 2026-08-30 (Car Wash poster turn): generate-image returned the
 * elementId, the batch panel showed the add op, the canvas rendered it — and
 * the bubble still said "image element not placed", because the check read
 * d.elements (committed only) while its own comment claimed "(committed or
 * pending)". The comment was the spec; the code was the bug.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStudioStore, getStudioStore, setStudioStore } from '../src/state/store';
import { effectiveDoc } from '../src/state/doc';

beforeEach(() => {
  setStudioStore(createStudioStore());
});

function imageLanded(): boolean {
  const after = getStudioStore().getState();
  const doc = after.docs.find((d) => d.id === after.currentDocId);
  const eff = doc ? effectiveDoc(doc, after.pendingBatch) : null;
  return (eff?.elements ?? []).some((e) => e.type === 'image');
}

describe('the scripted-turn image ground truth', () => {
  it('a PENDING image add counts as placed (the exact 08-30 false negative)', () => {
    const store = getStudioStore();
    store.getState().createDesign({ name: 'Poster', size: 'poster', palette: 'neon' });
    // the tool's addElement lands in the pending batch, uncommitted
    const elementId = store.getState().addElement({
      type: 'image', src: 'data:image/png;base64,AAAA', x: 10, y: 10,
      width: 100, height: 100, rotation: 0, opacity: 1,
    });
    expect(elementId).toBeTruthy();
    expect(store.getState().pendingBatch).not.toBeNull();
    // committed doc alone has NO image (the old check read this and lied)
    const committed = store.getState().docs.find((d) => d.id === store.getState().currentDocId);
    expect(committed!.elements.some((e) => e.type === 'image')).toBe(false);
    // the effective view must see it
    expect(imageLanded()).toBe(true);
  });

  it('an APPROVED image add counts as placed', () => {
    const store = getStudioStore();
    store.getState().createDesign({ name: 'Poster', size: 'poster', palette: 'neon' });
    store.getState().addElement({
      type: 'image', src: 'data:image/png;base64,AAAA', x: 0, y: 0,
      width: 100, height: 100, rotation: 0, opacity: 1,
    });
    store.getState().commitBatch();
    expect(imageLanded()).toBe(true);
  });

  it('no image anywhere -> not placed (the check still fails closed)', () => {
    const store = getStudioStore();
    store.getState().createDesign({ name: 'Poster', size: 'poster', palette: 'neon' });
    store.getState().addElement({
      type: 'text', text: 'headline', x: 0, y: 0,
      width: 100, height: 100, rotation: 0, opacity: 1,
    });
    expect(imageLanded()).toBe(false);
  });
});
