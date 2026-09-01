/**
 * P1.1 — the image-backend default is now origin-aware, mirroring the text
 * agent (textAgentConfig.ts). Measured 2026-08-31: the previous
 * origin-agnostic on-device default made a judge's first generate-image
 * gamble on the WebGPU lane (SwiftShader 1-6 tok/s + the session
 * circuit-breaker burning a 120s timeout before falling to fleet), while
 * the text agent already defaulted to fleet on the public origins. The
 * fleet lane answers in tens of seconds through the tunnel.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { defaultImageConfig, loadProviderConfig, STORAGE_KEY } from '../src/cloud/imageProviders';

function setHostname(h: string) {
  Object.defineProperty(window, 'location', {
    value: { hostname: h },
    configurable: true,
    writable: true,
  });
}

// This jsdom's window.localStorage is an inert stub (no methods — the suite
// only ever tested the pure serialize/parse functions), so install a real
// in-memory Storage for the stored-choice arm.
function installMemoryStorage() {
  const mem = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
    configurable: true,
  });
}

describe('defaultImageConfig — origin-aware first-visit default (P1.1)', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('defaults to fleet on the PUBLIC origins — a judge never gambles on WebGPU', () => {
    setHostname('studio.aitherium.com');
    expect(defaultImageConfig()).toEqual({ id: 'fleet' });
    setHostname('studio-preview.aitherium.com');
    expect(defaultImageConfig()).toEqual({ id: 'fleet' });
  });

  it('stays on-device everywhere else (localhost dev, private deployments)', () => {
    setHostname('localhost');
    expect(defaultImageConfig()).toEqual({ id: 'on-device' });
    setHostname('127.0.0.1');
    expect(defaultImageConfig()).toEqual({ id: 'on-device' });
  });

  it('loadProviderConfig returns the origin default when nothing is stored', () => {
    setHostname('studio.aitherium.com');
    expect(loadProviderConfig()).toEqual({ id: 'fleet' });
  });

  it('a stored choice always wins over the default', () => {
    setHostname('studio.aitherium.com');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'on-device' }));
    expect(loadProviderConfig()).toEqual({ id: 'on-device' });
  });
});
