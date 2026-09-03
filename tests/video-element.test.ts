/**
 * The `video` canvas element type (2026-09-03, the MediaForge animate lane).
 * Pins:
 * 1. round-trip through the doc store: add (pending) → effective doc →
 *    approve → committed, with `src` (the clip URL) and `poster` kept;
 * 2. the agent-facing summary never carries src/poster and flags hasVideo;
 * 3. poster capture is a capability probe: in jsdom (no decoder, no 2D
 *    context) it resolves null immediately — the canvas then draws the
 *    labelled placeholder instead of hanging on an event that never fires.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStudioStore, getStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import { applyOps, describeDesign, effectiveDoc, summarizeElement, type DesignElement } from '../src/state/doc';
import { canCapturePoster, capturePosterFrame } from '../src/canvas/videoPoster';

const CLIP = 'https://studio-preview.aitherium.com/api/mediaforge/media/anim.mp4';
const POSTER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeEach(() => {
  resetStudioStore();
  const store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
});

function doc() {
  const s = getStudioStore().getState();
  return s.docs.find((d) => d.id === s.currentDocId)!;
}

describe('video element — the doc store round trip', () => {
  it('adds as a pending op, shows in the effective doc, and survives approve with src + poster', () => {
    const store = getStudioStore().getState();
    const id = store.addElement({ type: 'video', src: CLIP, poster: POSTER, x: 10, y: 20, width: 320, height: 180, rotation: 0, opacity: 1 });
    expect(id).toBeTruthy();
    // Pending, not committed.
    expect(doc().elements).toHaveLength(0);
    const eff = effectiveDoc(doc(), getStudioStore().getState().pendingBatch);
    const pending = eff.elements.find((e) => e.id === id)!;
    expect(pending.type).toBe('video');
    expect(pending.src).toBe(CLIP);
    expect(pending.poster).toBe(POSTER);

    expect(getStudioStore().getState().commitBatch()).not.toBeNull();
    const committed = doc().elements.find((e) => e.id === id)!;
    expect(committed).toMatchObject({ type: 'video', src: CLIP, poster: POSTER, x: 10, y: 20, width: 320, height: 180 });
  });

  it('applyOps keeps a video element alongside the existing types untouched', () => {
    const base = doc();
    const video: DesignElement = { id: 'v1', type: 'video', src: CLIP, x: 0, y: 0, width: 100, height: 60, rotation: 0, zIndex: 0, opacity: 1 };
    const text: DesignElement = { id: 't1', type: 'text', text: 'hi', x: 0, y: 0, width: 100, height: 20, rotation: 0, zIndex: 1, opacity: 1 };
    const next = applyOps(base, [{ kind: 'add', element: video }, { kind: 'add', element: text }, { kind: 'update', elementId: 'v1', patch: { x: 40 } }]);
    expect(next.elements.map((e) => e.type)).toEqual(['video', 'text']);
    expect(next.elements[0].x).toBe(40);
    expect(next.elements[0].src).toBe(CLIP);
  });
});

describe('video element — the agent-facing summary', () => {
  it('summarizeElement strips src + poster and flags hasVideo', () => {
    const el: DesignElement = { id: 'v', type: 'video', src: CLIP, poster: POSTER, x: 1, y: 2, width: 3, height: 4, rotation: 0, zIndex: 0, opacity: 1 };
    const summary = summarizeElement(el);
    expect(summary.hasVideo).toBe(true);
    expect(summary.hasImage).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain('anim.mp4');
    expect(JSON.stringify(summary)).not.toContain('base64');
    // An image element does not grow a hasVideo flag.
    expect(summarizeElement({ ...el, type: 'image', poster: undefined }).hasVideo).toBeUndefined();
  });

  it('describeDesign lists a pending video element with hasVideo', () => {
    getStudioStore().getState().addElement({ type: 'video', src: CLIP, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1 });
    const s = getStudioStore().getState();
    const d = describeDesign(doc(), s.pendingBatch);
    expect(d.elements).toHaveLength(1);
    expect(d.elements[0]).toMatchObject({ type: 'video', hasVideo: true });
  });
});

describe('poster capture — a capability probe, never a hang', () => {
  it('jsdom cannot decode video: canCapturePoster is false and capture resolves null fast', async () => {
    expect(canCapturePoster()).toBe(false);
    const started = Date.now();
    await expect(capturePosterFrame(CLIP)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
