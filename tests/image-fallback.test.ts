/**
 * resolveHostedBase — the D-2291 fleet fallback, CORRECTED 2026-08-30.
 *
 * Measured live 08-30: the original gate checked `!localImageGenerator`, but
 * the loader plugs the generator at CONSTRUCTION on every tier (it throws at
 * use when the tier can't run) — so the gate never fired and Tier B/C got the
 * loud "no image backend is configured" while the fleet lane sat unused. The
 * corrected rule: reaching the hosted tier means local already failed or is
 * absent, so a panel 'on-device' choice falls through to the fleet lane
 * unconditionally. An explicit 'custom' without a URL stays a loud error.
 */
import { describe, expect, it } from 'vitest';
import { resolveHostedBase } from '../src/webmcp/tools/image';

describe('resolveHostedBase — the D-2291 fleet fallback (corrected)', () => {
  it('falls through to the fleet lane for a panel on-device choice (the live Tier B/C dead end)', () => {
    expect(resolveHostedBase({ id: 'on-device' })).toBeTruthy();
  });

  it('keeps an explicit fleet choice', () => {
    expect(resolveHostedBase({ id: 'fleet' })).toBeTruthy();
  });

  it('keeps a configured custom URL', () => {
    expect(resolveHostedBase({ id: 'custom', baseUrl: 'http://sana:8796' })).toBe(
      'http://sana:8796',
    );
  });

  it('still errors LOUD for a custom choice with no URL (the user named a backend and did not configure it)', () => {
    expect(resolveHostedBase({ id: 'custom', baseUrl: '' })).toBeNull();
    expect(resolveHostedBase({ id: 'custom' })).toBeNull();
  });
});
