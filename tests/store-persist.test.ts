/**
 * Studio state persistence — the "I SEE NOTHING" fix (2026-08-30).
 *
 * The store booted with docs:[] and NO persistence: every reload wiped the
 * design, and with no doc the canvas rendered 0x0 with no message — a fresh
 * load showed literally NOTHING while the person's poster was gone (measured
 * live: the owner reloaded repeatedly through the session to pick up new
 * bundles, losing each poster). Docs + current doc + the pending batch now
 * persist to localStorage; this pins the serialize/parse round-trip and the
 * reject-malformed guard.
 */
import { describe, expect, it } from 'vitest';
import {
  STATE_STORAGE_KEY,
  parsePersistedState,
  serializeStudioState,
  type PersistedStudioState,
} from '../src/state/store';

const sample: PersistedStudioState = {
  docs: [
    {
      id: 'doc_1',
      name: 'Car Wash Poster',
      size: { width: 1080, height: 1440 },
      palette: 'neon',
      background: 'white',
      createdAt: 1,
      updatedAt: 2,
      elementCount: 1,
      elements: [
        {
          id: 'el_1',
          type: 'image',
          src: 'data:image/png;base64,AAAA',
          x: 233,
          y: 208,
          width: 614,
          height: 1024,
          rotation: 0,
          zIndex: 0,
          opacity: 1,
        },
      ],
      pending: null,
    },
  ],
  currentDocId: 'doc_1',
  pendingBatch: {
    id: 'batch_1',
    createdAt: 3,
    ops: [{ kind: 'add', element: { id: 'el_2', type: 'text', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, opacity: 1 } }],
  },
};

describe('studio state persistence — the reload-wipe fix', () => {
  it('round-trips docs + current doc + pending batch through the storage string', () => {
    const raw = serializeStudioState(sample);
    const back = parsePersistedState(raw);
    expect(back).toEqual(sample);
    // The storage key is stable so a deployed build finds what the last one wrote.
    expect(STATE_STORAGE_KEY).toBe('webmcp.studio.state.v1');
  });

  it('rejects malformed storage content instead of crashing the boot', () => {
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState('not json')).toBeNull();
    expect(parsePersistedState(JSON.stringify({ docs: 'nope' }))).toBeNull();
    expect(parsePersistedState(JSON.stringify({ currentDocId: 42 }))).toBeNull();
  });

  it('keeps image srcs — the element the canvas draws', () => {
    const back = parsePersistedState(serializeStudioState(sample));
    expect(back?.docs[0].elements[0].src).toBe('data:image/png;base64,AAAA');
  });
});
