/**
 * P2.3 — the production-log tool: the Dark Matters exhibit as a WebMCP tool.
 * Any agent can ask "what has the studio produced?" and get the same ledger
 * the rail card renders: days, total pieces, and the last run's health.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStudioStore, getStudioStore, setStudioStore } from '../src/state/store';
import { productionLogTool, type ProductionLog } from '../src/webmcp/tools/production';

beforeEach(() => {
  setStudioStore(createStudioStore());
});

const FIXTURE: ProductionLog = {
  studio: 'WebMCP Design Studio',
  lane: 'mediaforge',
  entries: [
    { run: '2026-08-31T00:00:00Z', produced: 0, characters: [], errors: ['day zero'] },
    {
      run: '2026-09-01T02:23:00Z',
      produced: 4,
      characters: [
        { id: 'moika', name: 'Moika', ok: true, images: 4 },
        { id: 'verity', name: 'Verity Voss', ok: false, images: 0, error: 'boom' },
      ],
      errors: ['verity: boom'],
      wedge_refused: false,
    },
  ],
};

describe('production-log (P2.3)', () => {
  it('is always available — the agent can ask on a fresh page with no design', () => {
    const state = getStudioStore().getState();
    expect(productionLogTool.available!(state)).toBe(true);
  });

  it('answers the ledger when the log is fetchable', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = async () =>
      new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
      const out = await productionLogTool.execute({});
      const text = JSON.parse(out.content[0].text);
      expect(text.days).toBe(2);
      expect(text.totalPieces).toBe(4);
      expect(text.lastRun.produced).toBe(4);
      expect(text.lastRun.wedgeRefused).toBe(false);
    } finally {
      (globalThis as { fetch: unknown }).fetch = realFetch;
    }
  });

  it('fails cleanly when fetch is absent — never throws', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = undefined;
    try {
      const out = await productionLogTool.execute({});
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain('production log');
    } finally {
      (globalThis as { fetch: unknown }).fetch = realFetch;
    }
  });
});
