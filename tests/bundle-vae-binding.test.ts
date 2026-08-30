/**
 * The webml-image.esm.js VAE fetcher binding — pins the fix for the live
 * Tier-A failure measured 2026-08-30: httpRangeFetcher(url) CLOSES OVER its
 * url, and the bundle called readSafetensorsIndex(init.vaeWeightsUrl,
 * fetchRange) with the MAIN-weights-bound fetcher — so the VAE header read
 * pulled GGUF bytes and JSON.parse threw ("Unexpected token '�'" / "Unexpected
 * end of JSON input"). The VAE header AND tensor reads must use a fetcher
 * bound to the VAE url itself. The bundle is a generated artifact (source
 * drifted), so the pin is textual against the shipped file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bundle = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'webml-image.esm.js'),
  'utf8',
);

describe('webml-image.esm.js — VAE fetcher binding', () => {
  it('binds the VAE reads to a VAE-scoped fetcher (the 2026-08-30 Tier-A fix)', () => {
    expect(bundle).toContain('const vaeFetcher = httpRangeFetcher(init.vaeWeightsUrl)');
    expect(bundle).toContain('readSafetensorsIndex(init.vaeWeightsUrl, vaeFetcher)');
    expect(bundle).toContain('await vaeFetcher(t.start, t.start + t.length - 1)');
  });

  it('never passes the main-weights fetcher into the VAE reader (the bug shape)', () => {
    expect(bundle).not.toContain('readSafetensorsIndex(init.vaeWeightsUrl, fetchRange)');
  });
});
