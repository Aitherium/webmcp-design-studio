/**
 * Relay base URLs for the studio's SERVICE tools (IRIS + Media-Forge,
 * 2026-08-31 — the WebMCP demo integration). Same origin-aware pattern as
 * imageProviders.ts:
 * - PUBLIC origins (studio.aitherium.com — GitHub Pages, static — and
 *   studio-preview) reach the services CROSS-ORIGIN through the
 *   studio-api.aitherium.com tunnel relay (slice 2: tunnel routes +
 *   CORS for /api/iris/* and /api/mediaforge/*);
 * - everything else (localhost dev behind the studio nginx) uses the
 *   same-origin /api/iris/ + /api/mediaforge/ proxy locations
 *   (studio-static-default.conf, upstreams aitheros-iris:8786 and
 *   aitheros-mediaforge:8200).
 */
// 2026-09-03: studio-api.aitherium.com (aither-create) is gone -- its relay routes were swept
// from develop and the container is not running (502 on every path). The preview origin's
// nginx relays /api/iris/ and /api/mediaforge/ with CORS for studio.aitherium.com, so both
// tools ride the same origin the hosted chat lane already uses.
export const IRIS_BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'studio.aitherium.com' ||
    window.location.hostname === 'studio-preview.aitherium.com')
    ? 'https://studio-preview.aitherium.com/api/iris'
    : '/api/iris/';

export const MEDIAFORGE_BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'studio.aitherium.com' ||
    window.location.hostname === 'studio-preview.aitherium.com')
    ? 'https://studio-preview.aitherium.com/api/mediaforge'
    : '/api/mediaforge/';

/** Normalize a service image payload to a data URL — the same shapes the
 * image lane's normalizer accepts (data: prefixed, bare base64). A bare URL
 * is NOT silently trusted: fetching it cross-origin needs the relay's CORS,
 * so it surfaces as a loud error instead of a broken canvas element. */
export function normalizeServiceImage(image: unknown): string | null {
  if (typeof image !== 'string' || !image) return null;
  if (image.startsWith('data:')) return image;
  if (/^[A-Za-z0-9+/=]+$/.test(image) && image.length > 100) {
    return `data:image/png;base64,${image}`;
  }
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return null; // URL — the caller must relay it; never guess
  }
  return null;
}

/**
 * VIDEO lane (2026-09-03): render-video / video-status. The relay is the
 * studio's own nginx (`/api/video/` → the awrun-backed intake on the host),
 * reached cross-origin from the public origins via studio-preview — the same
 * lane shape as `/api/image/`. Renders are QUEUED (202 + job_id) and polled;
 * a Cloudflare 100 s edge limit never sees a long request.
 */
export const VIDEO_BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'studio.aitherium.com' ||
    window.location.hostname === 'studio-preview.aitherium.com')
    ? 'https://studio-preview.aitherium.com/api/video'
    : '/api/video/';
