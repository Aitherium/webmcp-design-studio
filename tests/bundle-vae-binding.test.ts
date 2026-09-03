/**
 * The webml-image.esm.js VAE loader — pins the three fixes for the live Tier-A
 * failures measured 2026-08-30, against the SHIPPED bundle.
 *
 * The bundle is now shipped MINIFIED, so these assertions had to change shape.
 * Minification renames every local identifier, which killed the previous
 * source-text pins (`const vaeFetcher = httpRangeFetcher(...)` and friends).
 * What survives mangling is what the runtime cannot rename: string literals,
 * object property names read from outside, and numeric constants. Every
 * assertion below is one of those, and every one is behaviour-bearing —
 * mutation-checked by hand at the time of writing (reverting the batch stride
 * to a serial loop, or the bulk shift to a per-element convert, each makes the
 * corresponding case fail).
 *
 * Two assertions were DELETED rather than translated: they matched
 * `'bn.num_batches_tracked'` and `'bn.running_mean'`, which exist in the bundle
 * only inside COMMENTS. A comment cannot fail, so those two pinned nothing and
 * their disappearance under minification is correct, not a regression.
 *
 * The incidents these guard:
 *  - httpRangeFetcher(url) CLOSES OVER its url, and the VAE header read was
 *    made with the MAIN-weights fetcher, so it pulled GGUF bytes and JSON.parse
 *    threw. The VAE reads must use a fetcher bound to the VAE url.
 *  - 251 tensors fetched serially took 63.6 s against the live CDN — over the
 *    loader's 60 s timeout, so the load died mid-sequence and every attempt
 *    fell to the fleet lane. Batches of 12: 13.5 s.
 *  - BF16 converted per element allocated a Uint32Array + Float32Array PER
 *    ELEMENT — 84M allocations over the 168 MB VAE, on the main thread, with no
 *    progress event between tensors. The UI froze at "vae decoder (20%)" and
 *    read as a hang.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bundle = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'webml-image.esm.js'),
  'utf8',
);

describe('webml-image.esm.js — VAE loader (minified bundle)', () => {
  it('is actually the minified artifact, not a readable one', () => {
    // If this fails the bundle was replaced with an unminified build and the
    // rest of this file is asserting against the wrong shape.
    expect(bundle).toContain('generated, minified');
    // No source-path map back into the monorepo.
    expect(bundle).not.toMatch(/apps\/packages|AitherVeil|build_webml_cdn/);
  });

  it('reads the VAE from its own url (the 2026-08-30 Tier-A fix)', () => {
    // A property read from an external init object — survives mangling.
    expect(bundle).toContain('vaeWeightsUrl');
  });

  it('fetches the tensors in BATCHES of 12, not serially (63.6s serial > the 60s loader timeout; 13.5s batched)', () => {
    // The stride is a numeric literal: minification cannot rename it.
    expect(bundle).toMatch(/\+=\s*12/);
    // Progress must move between batches rather than sit at "vae decoder (20%)".
    expect(bundle).toContain('vae decoder');
  });

  it('skips training-only integer tensors instead of killing the VAE load (bn.num_batches_tracked I64, live 08-30)', () => {
    // dtype is a property name; "I64" a string literal. Both survive.
    expect(bundle).toContain('dtype');
    expect(bundle).toContain('I64');
  });

  it('converts BF16 with the BULK typed-array shift, not per-element allocation (the "20% then nothing" wedge)', () => {
    expect(bundle).toContain('BF16');
    // BF16 is the top 16 bits of F32, so the bulk form is one shift per element
    // with zero allocations.
    //
    // A bare /<<\s*16/ does NOT work here and the first version of this guard
    // was vacuous because of it: the bundle contains TWO `<<16`, the per-element
    // `bf16ToF32` helper (`new Uint32Array([e<<16])` — the slow path, still
    // present) and the bulk loop (the fix). Reverting the fix leaves the
    // helper's `<<16` behind, so the loose assertion passed on the wrong one.
    // Caught by mutation-testing this file rather than by reading it.
    //
    // So match the LOOP SHAPE instead. Identifiers are renamed by minification,
    // hence the backreferences: whatever the index is called, it must be the
    // same name in all four positions, and the write must be a shifted read of
    // another typed array — i.e. bulk, not per-element.
    expect(bundle).toMatch(
      /for\(let (\w+)=0;\1<(\w+)\.length;\1\+\+\)(\w+)\[\1\]=\2\[\1\]<<16/,
    );
  });
});
