/**
 * Embed mode for the Playground surface (owner 2026-09-01: collapse the
 * studio into the Community Canvas behind the human gate).
 *
 * The same bundle serves both surfaces: standalone at studio.aitherium.com
 * (the WebMCP submission) and framed at /playground with ?embed=1. Embed
 * mode strips the app chrome (header/footer) so the framed studio reads as
 * part of the hosting page, and marks the document so CSS can react.
 *
 * The standalone surface is unchanged in embed mode's absence — the
 * submission-integrity invariant (deadline 2026-09-03) is that framing the
 * studio never alters the standalone page.
 */
export function computeEmbed(): boolean {
  if (typeof window === 'undefined') return false;
  const framed = window.self !== window.top;
  const asked = new URLSearchParams(window.location.search).get('embed') === '1';
  return framed || asked;
}

export function markEmbedChrome(embed: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-aither-embed', embed ? '1' : '0');
}
