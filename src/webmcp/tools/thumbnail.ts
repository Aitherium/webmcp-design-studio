/**
 * Downscale a data URL to a small preview. Used to keep agent-facing results
 * small (thumbnails, export previews) — never ships a full-res image to the
 * agent's context.
 * Returns null when no 2D canvas is available (headless/tests).
 */
export async function makeThumbnail(dataUrl: string, maxSize = 96): Promise<string | null> {
  try {
    // Real image decoding (headless/test environments never fire onload —
    // jsdom's Image cannot load anything). decode() is the capability probe:
    // absent → return null immediately instead of hanging.
    if (typeof Image === 'undefined' || typeof Image.prototype.decode !== 'function') return null;

    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
