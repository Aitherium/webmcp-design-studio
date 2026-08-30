/**
 * fitOnDeviceDims — the on-device 1024px cap.
 *
 * Measured live 2026-08-30 (owner transcript): the scripted poster plan
 * passes size 'tall' (768×1280), and the on-device runtime threw
 * "bonsai-image: sizes above 1024px are not supported on-device" — so every
 * Tier A poster turn fell to the hosted lane, and when the hosted lane
 * transiently failed, the whole turn died. The local lane must scale to fit
 * the cap, aspect-preserving; the element placement then uses the ACTUAL
 * generated dims so the canvas box is not stretched.
 */
import { describe, expect, it } from 'vitest';
import { fitOnDeviceDims, IMAGE_DIMENSIONS, ON_DEVICE_MAX_DIM } from '../src/webmcp/tools/image';

describe('fitOnDeviceDims — the on-device 1024px cap', () => {
  it('clamps tall (768×1280) to 614×1024 — the exact live 08-30 shape', () => {
    const out = fitOnDeviceDims(IMAGE_DIMENSIONS.tall);
    expect(out.width).toBe(614);
    expect(out.height).toBe(1024);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(ON_DEVICE_MAX_DIM);
    // aspect preserved: 768/1280 === 614/1024
    expect(out.width / out.height).toBeCloseTo(768 / 1280, 2);
  });

  it('clamps wide (1280×768) to 1024×614', () => {
    const out = fitOnDeviceDims(IMAGE_DIMENSIONS.wide);
    expect(out.width).toBe(1024);
    expect(out.height).toBe(614);
    expect(out.width / out.height).toBeCloseTo(1280 / 768, 2);
  });

  it('passes square (1024×1024) through unchanged', () => {
    expect(fitOnDeviceDims(IMAGE_DIMENSIONS.square)).toEqual({ width: 1024, height: 1024 });
  });

  it('never upscales a small request', () => {
    expect(fitOnDeviceDims({ width: 512, height: 768 })).toEqual({ width: 512, height: 768 });
  });

  it('stays within the cap on every axis', () => {
    for (const dims of Object.values(IMAGE_DIMENSIONS)) {
      const out = fitOnDeviceDims(dims);
      expect(out.width).toBeLessThanOrEqual(ON_DEVICE_MAX_DIM);
      expect(out.height).toBeLessThanOrEqual(ON_DEVICE_MAX_DIM);
      expect(out.width).toBeGreaterThanOrEqual(64);
      expect(out.height).toBeGreaterThanOrEqual(64);
    }
  });
});
