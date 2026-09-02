/**
 * Embed mode contract (owner 2026-09-01: collapse the studio into the
 * Community Canvas behind the human gate).
 *
 * The same bundle serves BOTH surfaces, and the standalone one is the
 * submission (deadline 2026-09-03): computeEmbed() must be false on the
 * standalone page (no embed param, top-level) and true when framed or
 * asked. markEmbedChrome() must stamp the document so CSS can strip the
 * chrome — and must stamp '0' for the standalone case, so a previous embed
 * session in the same document cannot leak.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeEmbed, markEmbedChrome } from '../src/embed';

describe('computeEmbed', () => {
  beforeEach(() => {
    // Fresh document: no embed param, top-level window.
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'top', { value: window, configurable: true });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-aither-embed');
  });

  it('is false on the standalone page — the submission surface is unchanged', () => {
    expect(computeEmbed()).toBe(false);
  });

  it('is true when ?embed=1 is asked', () => {
    window.history.replaceState({}, '', '/?embed=1');
    expect(computeEmbed()).toBe(true);
  });

  it('is false when a different param is present (embed=0 is not a request)', () => {
    window.history.replaceState({}, '', '/?embed=0');
    expect(computeEmbed()).toBe(false);
  });

  it('is true when framed, regardless of the query string', () => {
    Object.defineProperty(window, 'top', { value: {}, configurable: true });
    expect(window.self !== window.top).toBe(true);
    expect(computeEmbed()).toBe(true);
  });
});

describe('markEmbedChrome', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-aither-embed');
  });

  it('stamps the document for embed mode so CSS can react', () => {
    markEmbedChrome(true);
    expect(document.documentElement.getAttribute('data-aither-embed')).toBe('1');
  });

  it('stamps 0 for standalone so a stale embed marker cannot leak', () => {
    markEmbedChrome(true);
    markEmbedChrome(false);
    expect(document.documentElement.getAttribute('data-aither-embed')).toBe('0');
  });
});
