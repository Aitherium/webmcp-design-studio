/**
 * Enabling the on-device agent must switch the text lane to it. Measured live
 * 2026-09-23 on studio.aitherium.com: the public-origin default is 'fleet', the
 * consent chip loaded the 4B, and the next turn still went hosted and was
 * refused ("Demo credits exhausted") while the loaded brain sat unused.
 */
import { describe, expect, it } from 'vitest';
import { afterOnDeviceEnabled, type TextAgentConfig } from '../src/agent/textAgentConfig';

describe('afterOnDeviceEnabled', () => {
  it('moves a fleet-default visitor onto the on-device lane', () => {
    const fleet: TextAgentConfig = { mode: 'fleet', baseUrl: '', apiKey: '', model: '' };
    expect(afterOnDeviceEnabled(fleet).mode).toBe('on-device');
  });

  it('keeps a BYOK visitor\'s endpoint settings while switching lanes', () => {
    const custom: TextAgentConfig = { mode: 'custom', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
    expect(afterOnDeviceEnabled(custom)).toEqual({ mode: 'on-device', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
  });
});
