/**
 * Poster-frame capture for `video` elements (2026-09-03, the MediaForge
 * animate lane). The canvas is a still-image surface: a video element is
 * drawn as its FIRST FRAME, captured through an offscreen <video> into a
 * 2D canvas. Anything that cannot decode (jsdom, a tainted cross-origin
 * source, a codec the browser lacks) resolves to null — the caller then
 * draws a labelled placeholder instead of hanging on an event that never
 * fires (the same "never wait on jsdom's Image" lesson as thumbnail.ts).
 */

const CAPTURE_TIMEOUT_MS = 6_000;

/** True when this environment can decode video into a 2D canvas. jsdom
 * has HTMLVideoElement but no decoder (`canPlayType` answers '' for every
 * type, and `loadeddata` never fires) — so the decoder probe is the gate,
 * and the 2D context is the second half. */
export function canCapturePoster(): boolean {
  if (typeof document === 'undefined' || typeof HTMLVideoElement === 'undefined') return false;
  try {
    const video = document.createElement('video');
    if (typeof video.canPlayType !== 'function' || video.canPlayType('video/mp4') === '') return false;
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

function drawFrame(video: HTMLVideoElement): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** Capture the first frame of `src` as a PNG data URL, or null. */
export function capturePosterFrame(src: string, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<string | null> {
  if (!canCapturePoster()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // The relay serves CORS for the studio origins; without this flag a
    // cross-origin frame taints the canvas and toDataURL throws.
    video.crossOrigin = 'anonymous';
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        try {
          finish(drawFrame(video));
        } catch {
          finish(null);
        }
      },
      { once: true },
    );
    video.src = src;
    video.load();
  });
}
