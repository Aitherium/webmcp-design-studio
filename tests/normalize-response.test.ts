/**
 * normalizeImageResponse — the media-forge canvas_compat shape (D-192).
 *
 * Measured live 2026-08-30 through the real chain (studio-api tunnel →
 * aither-create → media-forge): canvas_compat answers
 * `{success: true, result: {images: ["iVBORw0KGgo…"]}}` — RAW base64, nested
 * under `result.images`. The normalizer handled `result.image|dataUrl|url`
 * but never `result.images`, and a bare base64 string (no `data:` prefix)
 * was treated as a URL and FETCHED — a guaranteed "failed fetching returned
 * URL" on the exact shape the fleet lane returns. Transport was green the
 * whole time; the parse was the last step, and it was never tested.
 */
import { describe, expect, it } from 'vitest';
import { normalizeImageResponse } from '../src/cloud/imageProviders';

const BARE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${BARE_B64}`;

describe('normalizeImageResponse — media-forge canvas_compat shape', () => {
  it('reads result.images[0] — the D-192 canvas_compat response (live 08-30)', async () => {
    await expect(
      normalizeImageResponse({ success: true, result: { images: [BARE_B64] } }),
    ).resolves.toBe(DATA_URL);
  });

  it('wraps a bare base64 payload instead of fetching it as a URL (the live failure shape)', async () => {
    // Without the wrap this tries abortableFetch("iVBORw0KGgo…") and throws
    // "failed fetching returned URL" — the exact dead end the studio hit.
    const out = await normalizeImageResponse({ success: true, result: { images: [BARE_B64] } });
    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(out).not.toMatch(/failed fetching returned URL/);
  });

  it('keeps the AitherBonsaiImage top-level images shape (unchanged)', async () => {
    await expect(normalizeImageResponse({ success: true, images: [DATA_URL] })).resolves.toBe(DATA_URL);
  });

  it('keeps nested {result: {url}} — a real URL is still fetched, never wrapped', async () => {
    const url = '/api/image/photo.png';
    // A path with an extension is not bare base64 — it must not gain a data:
    // prefix. In the test env the relative fetch fails, and THAT is the proof:
    // it took the fetch path (the wrap path resolves without any fetch).
    await expect(normalizeImageResponse({ success: true, result: { url } })).rejects.toThrow(
      /failed fetching returned URL/,
    );
  });

  it('still fails loudly on success:false', async () => {
    await expect(
      normalizeImageResponse({ success: false, error: 'backend down' }),
    ).rejects.toThrow(/backend down/);
  });
});
