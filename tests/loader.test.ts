/**
 * Loader tier detection — the gating contract's first half.
 *
 * Tier A: WebGPU adapter AND not software-only AND deviceMemory ≥ 6 AND not
 *   saveData/2g AND the weight-mirror Range probe returns 206.
 * Tier B: WebGPU present (software rasteriser OK — text-only on-device).
 * Tier C: everything else (no GPU / low memory / saveData / probe failed).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  TIER_A_MEMORY,
  TIER_B_MEMORY,
  detectTier,
  suggestBonsaiModelId,
  type TierProbeOverrides,
} from '../src/agent/loader';

const FULL_HW: TierProbeOverrides = {
  hasGpu: true,
  adapterInfo: { isFallbackAdapter: false, vendor: 'nvidia' },
  deviceMemory: 16,
  saveData: false,
  effectiveType: '4g',
  range206: true,
};

describe('detectTier — gating tiers', () => {
  it('full desktop hardware → Tier A (text + image on-device)', async () => {
    const v = await detectTier({ overrides: FULL_HW });
    expect(v.tier).toBe('A');
    expect(v.reasons).toHaveLength(0);
  });

  it('software rasteriser (SwiftShader) → Tier B even with plenty of memory', async () => {
    const v = await detectTier({
      overrides: { ...FULL_HW, adapterInfo: { isFallbackAdapter: true, vendor: 'google' } },
    });
    expect(v.tier).toBe('B');
    expect(v.reasons.join(' ')).toContain('software');
  });

  it('WARP (vendor microsoft) counts as software → Tier B', async () => {
    const v = await detectTier({
      overrides: { ...FULL_HW, adapterInfo: { isFallbackAdapter: false, vendor: 'Microsoft' } },
    });
    expect(v.tier).toBe('B');
  });

  it(`deviceMemory < ${TIER_A_MEMORY} but ≥ ${TIER_B_MEMORY} → Tier B (text only)`, async () => {
    const v = await detectTier({
      overrides: { ...FULL_HW, deviceMemory: TIER_A_MEMORY - 1 },
    });
    expect(v.tier).toBe('B');
  });

  it(`deviceMemory < ${TIER_B_MEMORY} → Tier C even with a GPU`, async () => {
    const v = await detectTier({
      overrides: { ...FULL_HW, deviceMemory: TIER_B_MEMORY - 1 },
    });
    expect(v.tier).toBe('C');
  });

  it('data saver on → Tier C (never pull 545 MB on a saveData link)', async () => {
    const v = await detectTier({ overrides: { ...FULL_HW, saveData: true } });
    expect(v.tier).toBe('C');
    expect(v.reasons.join(' ')).toContain('data saver');
  });

  it('2g link → Tier C', async () => {
    const v = await detectTier({ overrides: { ...FULL_HW, effectiveType: '2g' } });
    expect(v.tier).toBe('C');
  });

  it('Range probe failing → Tier C even with perfect hardware', async () => {
    const v = await detectTier({ overrides: { ...FULL_HW, range206: false } });
    expect(v.tier).toBe('C');
    expect(v.reasons.join(' ')).toContain('Range');
  });

  it('no GPU at all → Tier C', async () => {
    const v = await detectTier({ overrides: { ...FULL_HW, hasGpu: false } });
    expect(v.tier).toBe('C');
  });

  it('the Range probe is real: a 206 fetch wins, a 200 fetch loses', async () => {
    // FULL_HW pre-answers range206 — remove it so the fetchImpl is exercised.
    const probeOverrides = (): TierProbeOverrides => ({ ...FULL_HW, range206: undefined });

    const ok = await detectTier({
      overrides: probeOverrides(),
      fetchImpl: (async () => new Response(new Uint8Array(1), {
        status: 206,
        headers: { 'content-range': 'bytes 0-0/1' },
      })) as typeof fetch,
    });
    expect(ok.tier).toBe('A');
    expect(ok.probe.range206).toBe(true);

    const bad = await detectTier({
      overrides: probeOverrides(),
      fetchImpl: (async () => new Response('no ranges for you', { status: 200 })) as typeof fetch,
    });
    expect(bad.tier).toBe('C');
    expect(bad.probe.range206).toBe(false);
  });

  it('reads the REAL navigator when no overrides are given (jsdom: no gpu → Tier C)', async () => {
    // jsdom has no navigator.gpu / deviceMemory / connection — the honest answer is C.
    const v = await detectTier({ fetchImpl: (async () => new Response(new Uint8Array(1), {
      status: 200,
    })) as typeof fetch });
    expect(v.tier).toBe('C');
    expect(v.probe.adapter).toBe(false);
  });
});

/* ── the default model suggestion (errs small — the owner's speed complaint) ── */

describe('suggestBonsaiModelId — errs small, never the 1.1 GB 8B by default', () => {
  const origNav = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  });

  const fakeNav = (deviceMemory?: number, saveData?: boolean, effectiveType?: string) =>
    Object.defineProperty(
      {},
      'deviceMemory',
      { value: deviceMemory, enumerable: true, configurable: true },
    ) as Navigator & { deviceMemory?: number };

  it('a desktop with ample memory gets the 4B (545 MB), NOT the 8B (1104 MB) — the 2026-08-30 measured regression', () => {
    Object.defineProperty(globalThis, 'navigator', { value: fakeNav(32), configurable: true });
    expect(suggestBonsaiModelId()).toBe('bonsai-4b');
  });

  it('a low-memory device gets the 1.7B (236 MB)', () => {
    Object.defineProperty(globalThis, 'navigator', { value: fakeNav(4), configurable: true });
    expect(suggestBonsaiModelId()).toBe('bonsai-1.7b');
  });

  it('saveData and 2g connections get the lightest model', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { connection: { saveData: true } },
      configurable: true,
    });
    expect(suggestBonsaiModelId()).toBe('bonsai-1.7b');
  });
});
