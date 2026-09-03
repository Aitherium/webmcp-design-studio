/**
 * Media-Forge relay client — the helpers every `mediaforge-*` tool shares
 * (2026-09-03). The contract, measured against media-forge's OpenAPI:
 *   POST {base}/api/upload            multipart `file`   → {ok, id}
 *   POST {base}/api/studio/<op>       JSON {media_id,…}  → {ok, image | images[] | video | …}
 *   GET  {base}/media/<path>          the bytes
 *   GET  {base}/api/jobs/{jid}        {ok, job:{status: running|done|error, result, error}}
 * Every studio route answers HTTP 200 with `ok: false` + `error` on a
 * domain failure, so `okOrThrow` is the second half of every hop.
 */
import { ToolError } from './helpers';
import { MEDIAFORGE_BASE } from './serviceBases';

/** The relay base without a trailing slash (`/api/mediaforge/` → `/api/mediaforge`). */
export function mediaforgeBase(): string {
  return MEDIAFORGE_BASE.replace(/\/+$/, '');
}

/** Absolute URL for a relay-relative media path (`/media/x.mp4`). */
export function absoluteMediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const b = mediaforgeBase();
  const rel = path.replace(/^\/+/, '');
  if (/^https?:\/\//.test(b)) return `${b}/${rel}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${b}/${rel}`;
}

export function relayError(status: number, what: string): ToolError {
  return new ToolError(
    `media-forge ${what} HTTP ${status}${status === 404 ? ' — the media-forge relay is not configured on this origin yet' : ''}`,
  );
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The element's `src` as bytes: a data URL is decoded locally; an http(s)
 * source is fetched (the relay serves CORS for the studio origins). */
export async function srcToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return dataUrlToBlob(src);
  const res = await fetch(src);
  if (!res.ok) throw new ToolError(`source image fetch HTTP ${res.status}`);
  return res.blob();
}

/** Convert an element source to the /api/upload multipart body (field `file`). */
export async function srcToFormData(src: string, filename = 'source.png'): Promise<FormData> {
  const fd = new FormData();
  fd.append('file', await srcToBlob(src), filename);
  return fd;
}

/** Upload an element source into the media-forge gallery → media id. */
export async function uploadSource(src: string): Promise<number> {
  const res = await fetch(`${mediaforgeBase()}/api/upload`, { method: 'POST', body: await srcToFormData(src) });
  if (!res.ok) throw relayError(res.status, 'upload');
  const body = (await res.json()) as { ok?: boolean; id?: unknown };
  if (!body.ok || typeof body.id !== 'number') throw new ToolError('media-forge upload returned no media id');
  return body.id;
}

/** POST a JSON body to a studio route and return the parsed answer. */
export async function postStudio<T extends { ok?: boolean; error?: unknown }>(
  route: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${mediaforgeBase()}/api/studio/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw relayError(res.status, route);
  return (await res.json()) as T;
}

/** GET a JSON route under the relay base (`api/studio/status`, `api/jobs/x`). */
export async function getJson<T>(path: string, what: string): Promise<T> {
  const res = await fetch(`${mediaforgeBase()}/${path.replace(/^\/+/, '')}`);
  if (!res.ok) throw relayError(res.status, what);
  return (await res.json()) as T;
}

/** A studio answer with `ok: false` carries the real reason — surface it. */
export function okOrThrow<T extends { ok?: boolean; error?: unknown }>(body: T, what: string): T {
  if (body.ok === false || (body.ok === undefined && typeof body.error === 'string')) {
    const why = typeof body.error === 'string' && body.error ? body.error : 'no reason given';
    throw new ToolError(`media-forge ${what} failed: ${why}`);
  }
  return body;
}

/** The output image paths a studio op returned (`image` or `images[]`). */
export function imagePaths(body: { image?: unknown; images?: unknown }): string[] {
  const out: string[] = [];
  if (typeof body.image === 'string' && body.image.startsWith('/')) out.push(body.image);
  if (Array.isArray(body.images)) {
    for (const p of body.images) if (typeof p === 'string' && p.startsWith('/')) out.push(p);
  }
  return out;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  // Chunked btoa — FileReader.readAsDataURL is broken in some jsdom/CI
  // environments and the chunked path avoids the call-stack limit anyway.
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

/** Fetch a relay media path and return it as a data URL. */
export async function fetchMediaAsDataUrl(path: string, what: string): Promise<string> {
  const res = await fetch(`${mediaforgeBase()}${path}`);
  if (!res.ok) throw relayError(res.status, `${what} result fetch`);
  return blobToDataUrl(await res.blob());
}
