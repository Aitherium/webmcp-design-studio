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
    expect(bundle).toContain('vaeFetcher(t.start, t.start + t.length - 1)');
  });

  it('fetches the 251 tensors in BATCHES of 12, not serially (the 2026-08-30 "20% then disappeared": 63.6s serial > the 60s loader timeout; 13.5s batched)', () => {
    // The serial loop measured 63.6s against the live CDN — over the loader's
    // 60s load timeout, so the load died mid-sequence, the lane got struck,
    // and every attempt fell to the fleet lane (device:"cloud" in the trace).
    expect(bundle).toContain('for (let i = 0; i < VAETensors.length; i += 12)');
    expect(bundle).toContain('Promise.all(');
    // Progress must move between batches, not sit at "vae decoder (20%)".
    expect(bundle).toContain('progress("weights", 20 + Math.round((i / VAETensors.length) * 10), "vae decoder")');
  });

  it('never passes the main-weights fetcher into the VAE reader (the bug shape)', () => {
    expect(bundle).not.toContain('readSafetensorsIndex(init.vaeWeightsUrl, fetchRange)');
  });

  it('skips training-only integer tensors instead of killing the VAE load (bn.num_batches_tracked I64, live 08-30)', () => {
    expect(bundle).toContain('t.dtype === "I64" || t.dtype === "I32"');
    expect(bundle).toContain('continue;');
    expect(bundle).toContain("'bn.num_batches_tracked'");
  });

  it('converts BF16 tensors with the BULK typed-array shift, not per-element allocation (the 2026-08-30 "20% then nothing" wedge)', () => {
    expect(bundle).toContain('t.dtype === "BF16"');
    // The wedge: per-element bf16ToF32 allocated a Uint32Array + Float32Array
    // PER ELEMENT — 84M heap allocations over the 168 MB VAE, on the main
    // thread, with no progress event between tensors; the UI froze at
    // "vae decoder (20%)" for minutes and read as a hang. The fetch was
    // never the stall (httpRangeFetcher has a watchdog).
    expect(bundle).not.toContain('bf16ToF32(dv.getUint16');
    // The fix: BF16 is the top 16 bits of F32, so the bulk form is one
    // typed-array shift per element with zero allocations.
    expect(bundle).toContain('const src = new Uint16Array(raw.buffer, raw.byteOffset, t.length / 2)');
    expect(bundle).toContain('const dst = new Uint32Array(out.buffer)');
    expect(bundle).toContain('dst[i] = src[i] << 16');
    expect(bundle).toContain("'bn.running_mean'");
  });
});
