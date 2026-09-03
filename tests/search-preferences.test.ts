/**
 * search-preferences: recall by MEANING with the aither-code-embed model in the tab.
 *
 * The embedder is a 396 MB download behind a consent gate, so the unit tests
 * exercise the seams around it: the ranking math, the two rules that decide
 * whether the model may load at all (empty store => never; no consent => never,
 * with a message that names the fix), the worker protocol against a fake
 * Worker, and the consent KEY parity with agent/loader.ts, which is what keeps
 * "the same chip" true rather than asserted.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CODE_EMBED_DIM,
  CONSENT_REQUIRED_MESSAGE,
  EmbedderUnavailableError,
  ON_DEVICE_CONSENT_KEY,
  PrefEmbedderClient,
  cosine,
  isOnDeviceConsentGiven,
  prefDocument,
  rankByCosine,
  searchPrefs,
} from '../src/webml/prefEmbedder';
import { MEMORY_TOOLS, searchPreferencesTool } from '../src/webmcp/tools/memory';

const here = dirname(fileURLToPath(import.meta.url));

/* -- ranking math ------------------------------------------------------------ */

describe('cosine / rankByCosine', () => {
  it('cosine: identical=1, orthogonal=0, opposite=-1, degenerate=0', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });

  it('ranks by descending similarity, ties by key, honours limit, rounds scores', () => {
    const q = [1, 0, 0];
    const ranked = rankByCosine(
      q,
      [
        { key: 'far', value: 'x', vec: [0, 1, 0] },
        { key: 'near', value: 'y', vec: [0.9, 0.1, 0] },
        { key: 'exact', value: 'z', vec: [2, 0, 0] },
        { key: 'also-far', value: 'w', vec: [0, 0, 1] },
      ],
      3,
    );
    expect(ranked.map((r) => r.key)).toEqual(['exact', 'near', 'also-far']);
    expect(ranked[0].score).toBe(1);
    expect(ranked[1].score).toBe(Math.round(cosine(q, [0.9, 0.1, 0]) * 1e4) / 1e4);
  });

  it('prefDocument embeds key AND value so either half can match a query', () => {
    expect(prefDocument('brand_color', '#ff6600')).toBe('brand_color: #ff6600');
  });
});

/* -- the two "never load the model" rules ------------------------------------ */

describe('searchPrefs gates', () => {
  it('an EMPTY store answers instantly and never touches consent or the embedder', async () => {
    const consent = vi.fn(() => false);
    const embed = vi.fn();
    const r = await searchPrefs('anything', { list: async () => [], consent, embed });
    expect(r).toMatchObject({ query: 'anything', results: [], searched: 0, onDevice: true });
    expect(consent).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('without on-device consent it REFUSES with the message naming the chip, and never embeds', async () => {
    const embed = vi.fn();
    await expect(
      searchPrefs('colours', {
        list: async () => [{ key: 'brand_color', value: '#ff6600' }],
        consent: () => false,
        embed,
      }),
    ).rejects.toThrow(EmbedderUnavailableError);
    await expect(
      searchPrefs('colours', {
        list: async () => [{ key: 'brand_color', value: '#ff6600' }],
        consent: () => false,
        embed,
      }),
    ).rejects.toThrow(CONSENT_REQUIRED_MESSAGE);
    expect(embed).not.toHaveBeenCalled();
    expect(CONSENT_REQUIRED_MESSAGE).toContain('recall-preference');
  });

  it('with consent it embeds the query in query mode and the docs in document mode, then ranks', async () => {
    const calls: Array<[string[], string]> = [];
    // A toy embedder: "colour"-ish text points along x, "address"-ish along y.
    const embed = async (texts: string[], mode: 'query' | 'document') => {
      calls.push([texts, mode]);
      return texts.map((t) => (/colou?r|#[0-9a-f]{6}/i.test(t) ? [1, 0.1] : [0.1, 1]));
    };
    const r = await searchPrefs('what colour does the user like', {
      list: async () => [
        { key: 'store_address', value: '12 Main St' },
        { key: 'brand_color', value: '#ff6600' },
      ],
      consent: () => true,
      embed,
      limit: 1,
    });
    // The studio recipe's query_prefix is "", so the query goes RAW (mode "document"):
    // mode "query" would prepend the worker's code-search Instruct prefix, a train/serve
    // mismatch for this model.
    expect(calls[0]).toEqual([['what colour does the user like'], 'document']);
    expect(calls[1]).toEqual([['store_address: 12 Main St', 'brand_color: #ff6600'], 'document']);
    expect(r.searched).toBe(2);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].key).toBe('brand_color');
    expect(r.provider).toBe('aither-studio-embed');
    expect(r.dim).toBe(CODE_EMBED_DIM);
  });
});

/* -- consent key parity: the SAME chip, proven not asserted -------------------- */

describe('consent key parity with agent/loader.ts', () => {
  it('reads the exact key loader.ts writes', () => {
    const loader = readFileSync(join(here, '..', 'src', 'agent', 'loader.ts'), 'utf8');
    const m = loader.match(/const CONSENT_KEY = ['"]([^'"]+)['"]/);
    expect(m, 'loader.ts must still declare CONSENT_KEY').not.toBeNull();
    expect(ON_DEVICE_CONSENT_KEY).toBe(m![1]);
  });

  it('isOnDeviceConsentGiven: "1" is consent, anything else (or a throwing storage) is not', () => {
    const mk = (v: string | null) => ({ getItem: () => v }) as unknown as Storage;
    expect(isOnDeviceConsentGiven(mk('1'))).toBe(true);
    expect(isOnDeviceConsentGiven(mk('0'))).toBe(false);
    expect(isOnDeviceConsentGiven(mk(null))).toBe(false);
    expect(isOnDeviceConsentGiven(undefined)).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(isOnDeviceConsentGiven(throwing)).toBe(false);
  });
});

/* -- worker protocol against a fake Worker ------------------------------------ */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

class FakeWorker {
  listeners = new Map<string, Array<(ev: unknown) => void>>();
  posted: unknown[] = [];
  terminated = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    for (const fn of this.listeners.get('message') ?? []) fn({ data });
  }
  fail(message: string) {
    for (const fn of this.listeners.get('error') ?? []) fn({ message });
  }
}

describe('PrefEmbedderClient protocol', () => {
  it('load posts the weights URL, resolves on ready; embed round-trips by requestId and caches', async () => {
    const fw = new FakeWorker();
    const c = new PrefEmbedderClient(() => fw as unknown as Worker, 'https://example.test/w.gguf');
    const loading = c.load();
    expect(fw.posted[0]).toEqual({ type: 'load', modelId: 'https://example.test/w.gguf' });
    fw.emit({ type: 'progress', progress: 40, file: 'downloading' });
    expect(c.status).toMatchObject({ phase: 'loading', progress: 40, detail: 'downloading' });
    fw.emit({ type: 'ready', modelId: 'x' });
    await loading;
    expect(c.status.phase).toBe('ready');

    const vec = () => Array.from({ length: CODE_EMBED_DIM }, (_, i) => (i === 0 ? 1 : 0));
    const p = c.embed(['a', 'b'], 'document');
    await tick(); // embed awaits the (settled) load promise before posting
    const req = fw.posted[1] as { type: string; requestId: string; texts: string[]; mode: string };
    expect(req).toMatchObject({ type: 'embed', texts: ['a', 'b'], mode: 'document' });
    fw.emit({ type: 'embed-result', requestId: req.requestId, vectors: [vec(), vec()] });
    const out = await p;
    expect(out).toHaveLength(2);

    // 'a' is cached: only 'c' goes to the worker this time.
    const p2 = c.embed(['a', 'c'], 'document');
    await tick();
    const req2 = fw.posted[2] as { requestId: string; texts: string[] };
    expect(req2.texts).toEqual(['c']);
    fw.emit({ type: 'embed-result', requestId: req2.requestId, vectors: [vec()] });
    expect(await p2).toHaveLength(2);
  });

  it('a wrong-width vector is refused (wrong weights loaded), not returned', async () => {
    const fw = new FakeWorker();
    const c = new PrefEmbedderClient(() => fw as unknown as Worker);
    const loading = c.load();
    fw.emit({ type: 'ready' });
    await loading;
    const p = c.embed(['a'], 'query');
    await tick();
    const req = fw.posted[1] as { requestId: string };
    fw.emit({ type: 'embed-result', requestId: req.requestId, vectors: [[1, 2, 3]] });
    await expect(p).rejects.toThrow(/expected 1024/);
  });

  it('a worker script failure rejects load, terminates, and allows a retry', async () => {
    const fw = new FakeWorker();
    let spawns = 0;
    const c = new PrefEmbedderClient(() => {
      spawns++;
      return fw as unknown as Worker;
    });
    const loading = c.load();
    fw.fail('404 on worker script');
    await expect(loading).rejects.toThrow(/embedding worker failed: 404/);
    expect(fw.terminated).toBe(true);
    expect(c.status.phase).toBe('error');
    void c.load(); // retry spawns again rather than returning the dead promise
    expect(spawns).toBe(2);
  });
});

/* -- tool surface ------------------------------------------------------------- */

describe('search-preferences tool', () => {
  it('is registered third in MEMORY_TOOLS, read-only, with query required', () => {
    expect(MEMORY_TOOLS.map((t) => t.name)).toEqual([
      'remember-preference',
      'recall-preference',
      'search-preferences',
    ]);
    expect(searchPreferencesTool.annotations).toMatchObject({ readOnlyHint: true });
    expect(searchPreferencesTool.inputSchema.required).toEqual(['query']);
    expect(searchPreferencesTool.description).toMatch(/on-device|INSIDE this tab/i);
    expect(searchPreferencesTool.description).toContain('recall-preference');
  });

  it('rejects a bad limit through the shared arg helpers (fail, not throw)', async () => {
    const r = await searchPreferencesTool.execute({ query: 'x', limit: 99 });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).toMatch(/limit.*<= 10/);
  });
});
