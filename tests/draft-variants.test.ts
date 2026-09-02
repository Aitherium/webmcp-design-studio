/**
 * draft-variants: the fan-out is the feature. These pin the two properties a
 * serial rewrite would silently lose —
 *   1. all N requests are IN FLIGHT at once (the gate below only releases the
 *      responses once N have started, so a serial implementation deadlocks and
 *      the test fails rather than passing slowly);
 *   2. every request carries a DISTINCT prompt, because the platform's
 *      MicroScheduler coalesces identical concurrent prompts into one cached
 *      answer (measured 2026-09-02: 0 completion tokens in 10 ms at N>=4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftVariantsTool, variantInstruction } from '../src/webmcp/tools/variants';

afterEach(() => vi.unstubAllGlobals());

function textOf(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? '';
}

/** fetch that holds every response until `expected` calls have arrived. */
function gatedFetch(expected: number, reply: (n: number) => unknown) {
  const bodies: string[] = [];
  let seen = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const idx = seen++;
    bodies.push(String(init.body));
    if (seen === expected) release();
    await gate; // a SERIAL caller never reaches `expected` — this is the assertion
    return new Response(JSON.stringify(reply(idx)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchMock, bodies };
}

const answer = (n: number) => ({ choices: [{ message: { content: `HEADLINE ${n}` } }] });

describe('draft-variants', () => {
  it('fires every request concurrently and returns all the takes', async () => {
    const { fetchMock, bodies } = gatedFetch(4, answer);
    vi.stubGlobal('fetch', fetchMock);
    const out = await draftVariantsTool.execute({ brief: 'spring yard sale', count: 4 }, { signal: new AbortController().signal });
    const parsed = JSON.parse(textOf(out));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(parsed.returned).toBe(4);
    expect(parsed.variants.map((v: { text: string }) => v.text)).toEqual(['HEADLINE 0', 'HEADLINE 1', 'HEADLINE 2', 'HEADLINE 3']);
    expect(bodies).toHaveLength(4);
  });

  it('sends a DISTINCT prompt per request (the coalescing guard)', async () => {
    const { fetchMock, bodies } = gatedFetch(3, answer);
    vi.stubGlobal('fetch', fetchMock);
    await draftVariantsTool.execute({ brief: 'car wash', count: 3 }, { signal: new AbortController().signal });
    const prompts = bodies.map((b) => JSON.parse(b).messages.at(-1).content as string);
    expect(new Set(prompts).size).toBe(3);
    prompts.forEach((p, i) => expect(p).toContain(`Take ${i + 1} of 3`));
  });

  it('returns the successes when some takes fail, and fails only when all do', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const i = n++;
      return i === 0
        ? new Response('upstream exploded', { status: 503 })
        : new Response(JSON.stringify(answer(i)), { status: 200 });
    }));
    const partial = JSON.parse(textOf(await draftVariantsTool.execute({ brief: 'bake sale', count: 3 }, { signal: new AbortController().signal })));
    expect(partial.returned).toBe(2);
    expect(partial.failed).toHaveLength(1);
    expect(partial.failed[0].error).toContain('503');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const dead = await draftVariantsTool.execute({ brief: 'bake sale', count: 2 }, { signal: new AbortController().signal });
    expect((dead as { isError?: boolean }).isError).toBe(true);
    expect(textOf(dead)).toContain('every variant failed');
  });

  it('defaults to 3 takes and REFUSES a count outside 2..6 without calling the lane', async () => {
    const { fetchMock: f1 } = gatedFetch(3, answer);
    vi.stubGlobal('fetch', f1);
    await draftVariantsTool.execute({ brief: 'x' }, { signal: new AbortController().signal });
    expect(f1).toHaveBeenCalledTimes(3);

    // Out of range is an ERROR naming the range, not a silent clamp — the same
    // contract every other numeric arg here has (fontSize 12..240).
    const f2 = vi.fn();
    vi.stubGlobal('fetch', f2);
    const refused = await draftVariantsTool.execute({ brief: 'x', count: 99 }, { signal: new AbortController().signal });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(textOf(refused)).toMatch(/count/);
    expect(f2).not.toHaveBeenCalled();
  });

  it('names an empty answer as a budget problem, not an empty draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'thinking…' } }] }), { status: 200 })));
    const out = await draftVariantsTool.execute({ brief: 'x', count: 2 }, { signal: new AbortController().signal });
    expect(textOf(out)).toContain('token budget reasoning');
  });

  it('varies the angle per take', () => {
    expect(variantInstruction('headline', 0, 3)).not.toBe(variantInstruction('headline', 1, 3));
    expect(variantInstruction('palette', 0, 2)).toContain('#RRGGBB');
  });
});
