/**
 * The IRIS + Media-Forge WebMCP tools (2026-08-31, the demo integration).
 * Pins:
 * 1. iris-generate: response → element placement (the pipeline story —
 *    best_score / refinement_rounds — survives into the result), bare-base64
 *    normalization, loud 404 naming the relay.
 * 2. mediaforge-remove-bg: target resolution ('last-image' / explicit id),
 *    the REPLACE semantics (update op, not a new element), image/blob
 *    response handling, loud 404.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import { irisGenerateTool, extractIrisImage } from '../src/webmcp/tools/iris';
import {
  mediaforgeRemoveBgTool,
  resolveImageTarget,
  extractRemoveBgImage,
} from '../src/webmcp/tools/mediaforge';
import { normalizeServiceImage } from '../src/webmcp/tools/serviceBases';
import { effectiveDoc } from '../src/state/doc';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// Above the normalizer's 100-char bare-base64 floor (a real 1x1 PNG is 96).
const LONG_PNG_B64 = TINY_PNG_B64 + TINY_PNG_B64;

function textOf(r: { content: Array<{ type: 'text'; text: string }> }): string {
  return r.content[0].text;
}

beforeEach(() => {
  resetStudioStore();
  const store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchJson(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('normalizeServiceImage — the shared image-shape normalizer', () => {
  it('passes data: URLs through and prefixes bare base64', () => {
    expect(normalizeServiceImage(`data:image/png;base64,${TINY_PNG_B64}`)).toBe(
      `data:image/png;base64,${TINY_PNG_B64}`,
    );
    expect(normalizeServiceImage(LONG_PNG_B64)).toBe(`data:image/png;base64,${LONG_PNG_B64}`);
    // The floor: a 96-char string is not an image payload.
    expect(normalizeServiceImage(TINY_PNG_B64)).toBeNull();
  });

  it('refuses URLs — never silently trusts a cross-origin fetch', () => {
    expect(normalizeServiceImage('https://example.com/img.png')).toBeNull();
    expect(normalizeServiceImage('')).toBeNull();
    expect(normalizeServiceImage(null)).toBeNull();
  });
});

describe('iris-generate — the autonomous pipeline tool', () => {
  it('extractIrisImage picks the pipeline result from all its shapes', () => {
    expect(extractIrisImage({ success: true, image: `data:image/png;base64,${TINY_PNG_B64}` })).toBe(
      `data:image/png;base64,${TINY_PNG_B64}`,
    );
    expect(extractIrisImage({ success: true, images: [LONG_PNG_B64] })).toBe(
      `data:image/png;base64,${LONG_PNG_B64}`,
    );
    expect(extractIrisImage({ success: true, image: 'https://x/y.png' })).toBeNull();
    expect(extractIrisImage({ success: false, image: LONG_PNG_B64 })).toBeNull();
  });

  it('executes the full pipeline, places the element, and reports the story', async () => {
    stubFetchJson({
      success: true,
      image: `data:image/png;base64,${TINY_PNG_B64}`,
      best_score: 8.5,
      refinement_rounds: 2,
      steps: [{ type: 'evaluate', evaluation: { score: 8.5, overall: 'strong composition' } }],
      plan: { optimized_prompt: 'a glowing neon coffee cup' },
    });
    const out = await irisGenerateTool.execute(
      { prompt: 'a coffee cup', size: 'square', maxRounds: 2 },
      { signal: new AbortController().signal },
    );
    const parsed = JSON.parse(textOf(out)) as Record<string, unknown>;
    expect(parsed.elementId).toBeTruthy();
    expect(parsed.device).toBe('iris');
    expect(parsed.bestScore).toBe(8.5);
    expect(parsed.refinementRounds).toBe(2);
    expect(parsed.evaluation).toMatchObject({ score: 8.5, overall: 'strong composition' });
    expect(parsed.optimizedPrompt).toContain('neon');
  });

  it('fails LOUD with the relay hint on a 404 (the slice-2 boundary)', async () => {
    stubFetchJson({ detail: 'Not Found' }, 404);
    const out = await irisGenerateTool.execute(
      { prompt: 'x' },
      { signal: new AbortController().signal },
    );
    expect(textOf(out)).toContain('404');
    expect(textOf(out)).toContain('relay');
  });
});

describe('mediaforge-remove-bg — the cutout tool', () => {
  it('resolves "last-image" to the most recent image element (pending batch included)', () => {
    const store = createStudioStore();
    resetStudioStore();
    setStudioStore(store as never);
    store.getState().createDesign({ name: 'd', size: 'square', palette: 'neon', background: 'white' });
    store.getState().addElement({
      type: 'image',
      src: `data:image/png;base64,${TINY_PNG_B64}`,
      x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1,
    });
    const found = resolveImageTarget('last-image');
    expect('elementId' in found).toBe(true);
    if ('elementId' in found) {
      expect(found.src).toContain('data:image/png;base64');
      const updated = store.getState().updateElement(found.elementId, {
        src: `data:image/png;base64,${TINY_PNG_B64}xxx`,
      });
      expect(updated).toBe(true);
      // The replace is an UPDATE op in the batch — never a second element.
      expect(store.getState().pendingBatch?.ops.some((op) => op.kind === 'update')).toBe(true);
    }
  });

  it('extractRemoveBgImage handles the JSON and blob-ish shapes', () => {
    expect(extractRemoveBgImage({ success: true, image: LONG_PNG_B64 })).toBe(
      `data:image/png;base64,${LONG_PNG_B64}`,
    );
    expect(extractRemoveBgImage({ result: { image: LONG_PNG_B64 } })).toBe(
      `data:image/png;base64,${LONG_PNG_B64}`,
    );
    expect(extractRemoveBgImage({ success: false, image: LONG_PNG_B64 })).toBeNull();
  });

  it('executes the cutout and REPLACES the target element src', async () => {
    const store = createStudioStore();
    resetStudioStore();
    setStudioStore(store as never);
    store.getState().createDesign({ name: 'd', size: 'square', palette: 'neon', background: 'white' });
    const elementId = store.getState().addElement({
      type: 'image',
      src: `data:image/png;base64,${TINY_PNG_B64}`,
      x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1,
    });
    stubFetchJson({ success: true, image: `data:image/png;base64,${TINY_PNG_B64}cut` });
    const out = await mediaforgeRemoveBgTool.execute(
      { target: 'last-image' },
      { signal: new AbortController().signal },
    );
    expect(textOf(out)).toContain('"elementId"');
    const state = store.getState();
    const doc = state.docs.find((d) => d.id === state.currentDocId)!;
    // The element is in the PENDING BATCH until approve — the effective doc
    // is what the canvas draws, and it must contain exactly ONE image (the
    // cutout REPLACED the src; never a second element).
    const eff = effectiveDoc(doc, state.pendingBatch);
    expect(state.pendingBatch?.ops.some((op) => op.kind === 'update' && op.elementId === elementId)).toBe(true);
    expect(eff.elements.filter((e) => e.type === 'image').length).toBe(1);
  });
});
