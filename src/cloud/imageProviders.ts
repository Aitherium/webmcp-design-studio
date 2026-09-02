/**
 * Image provider panel — self-service routing for the generate-image tool.
 *
 * The generate-image tool's cloud tier used to be hardcoded to one hosted
 * endpoint. This module makes the target a choice the user owns, persisted in
 * localStorage:
 *
 *   on-device  → the bundled WebGPU runtime (Tier A), no backend involved
 *   fleet      → the studio's nginx proxy (`/api/image/`), which forwards to
 *                AitherBonsaiImage's SYNC `/v1/generate` contract
 *   custom     → any OpenAI-style endpoint the user names, with an optional
 *                `X-API-Key` header (Sana, ComfyUI, SD — whatever they run)
 *
 * The sync contract is deliberately the AitherBonsaiImage one — `POST {base}/generate`
 * answers `{success, images: [...]}` in one request (measured: 58–75s at 512²,
 * 92–271s at 1024², so the loader shows progress while it waits) — with the
 * normalize step accepting the shapes real providers actually return.
 */
export type ImageProviderId = 'on-device' | 'fleet' | 'custom';

export interface ImageProviderConfig {
  id: ImageProviderId;
  /** base URL for `fleet`/`custom`; trailing slash allowed, stripped on use. */
  baseUrl?: string;
  /** sent as `X-API-Key` on every request when set (custom providers). */
  apiKey?: string;
}

export const STORAGE_KEY = 'webmcp.imageProvider';

/**
 * The studio's hosted image lane. On the PUBLIC hosts (studio.aitherium.com —
 * GitHub Pages, which rejects POSTs — and studio-preview, a static nginx)
 * the lane is CROSS-ORIGIN to studio-preview.aitherium.com/api/image — the
 * studio's own nginx, which rewrites /api/image/generate to Sana's /v1/generate
 * and answers the CORS preflight (measured 2026-09-02: 200 with an image in
 * ~6 s). It WAS studio-api.aitherium.com (aither-create → media-forge → Sana),
 * which took ~171 s end to end and hit Cloudflare's 100 s cut as a 524 on every
 * judge-facing generate (measured 2026-09-01, 3 of 3). Same host the chat lane
 * already uses (hostedChat.ts).
 * Localhost dev keeps the same-origin nginx proxy → AitherSana.
 */
export const FLEET_DEFAULT_BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'studio.aitherium.com' ||
    window.location.hostname === 'studio-preview.aitherium.com')
    ? 'https://studio-preview.aitherium.com/api/image'
    : '/api/image/';

/** Origin-aware first-visit default — mirrors the text agent's default
 * (textAgentConfig.ts): on the PUBLIC origins the fleet lane is the default,
 * because a judge's first generate-image must not gamble on the WebGPU lane
 * (measured 2026-08-31: SwiftShader runs 1-6 tok/s and wedges — the session
 * circuit-breaker then burns a 120s timeout before falling to fleet). The
 * fleet lane answers in tens of seconds through the tunnel. On-device stays
 * the default everywhere else (localhost dev, private deployments). A stored
 * choice always wins over the default. */
export function defaultImageConfig(): ImageProviderConfig {
  const isPublicOrigin =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'studio.aitherium.com' ||
      window.location.hostname === 'studio-preview.aitherium.com');
  return { id: isPublicOrigin ? 'fleet' : 'on-device' };
}

/** Shape sent to a provider's `POST {base}/generate`. */
export interface SyncGenerateRequest {
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  seed?: number;
}

export interface SyncGenerateResult {
  dataUrl: string;
  elapsedMs: number;
  seed: number;
  backend?: string;
  model?: string;
}

export function loadProviderConfig(): ImageProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultImageConfig();
    const parsed = JSON.parse(raw) as Partial<ImageProviderConfig>;
    if (parsed.id !== 'on-device' && parsed.id !== 'fleet' && parsed.id !== 'custom') {
      return defaultImageConfig();
    }
    return { id: parsed.id, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey };
  } catch {
    return defaultImageConfig();
  }
}

export function saveProviderConfig(config: ImageProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage can throw in private/restricted contexts; the panel still
    // works for the session, it just won't remember the choice.
  }
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** fetch that forwards an external AbortSignal to an internal controller, with an
 *  optional wall-clock deadline of its own (generation is slow: 58–271s measured). */
async function abortableFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs?: number,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * One-shot synchronous generate against a fleet/custom provider. The body is
 * the AitherBonsaiImage /v1/generate contract; the response is normalized so
 * the common provider shapes all land on a data URL. Every failure names the
 * failing hop (request, HTTP status, body error, missing image, fetch of a
 * returned URL).
 */
export async function syncGenerateImage(
  providerBase: string,
  request: SyncGenerateRequest,
  options?: { apiKey?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<SyncGenerateResult> {
  const base = baseUrl(providerBase);
  const { signal } = options ?? {};
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 31);
  const startedAt = performance.now();

  const url = `${base}/generate`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options?.apiKey) headers['x-api-key'] = options.apiKey;

  let resp: Response;
  try {
    resp = await abortableFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: request.prompt,
          negative_prompt: request.negative_prompt,
          width: request.width,
          height: request.height,
          seed,
        }),
      },
      signal,
      timeoutMs,
    );
  } catch (err) {
    throw new Error(`image generation failed at POST ${url}: ${describe(err)}`);
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const body = (await resp.json()) as { error?: unknown; message?: unknown; detail?: unknown };
      detail = String(body.error ?? body.message ?? body.detail ?? '');
    } catch {
      // non-JSON error body — fall through to the bare status
    }
    throw new Error(
      `image generation failed at POST ${url}: HTTP ${resp.status}${detail ? ` — ${detail}` : ''}`,
    );
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch (err) {
    throw new Error(`image generation failed at POST ${url}: response was not JSON (${describe(err)})`);
  }

  const dataUrl = await normalizeImageResponse(body, { signal, base });
  return {
    dataUrl,
    elapsedMs: Math.round(performance.now() - startedAt),
    seed,
    backend: typeof body === 'object' && body !== null ? (body as { backend?: string }).backend : undefined,
    model: typeof body === 'object' && body !== null ? (body as { model?: string }).model : undefined,
  };
}

/**
 * Pull a data URL out of the shapes real providers return:
 *   {images: [dataUrl, ...]}          AitherBonsaiImage /v1/generate
 *   {dataUrl} / {image}               single-image convenience shapes
 *   {result: {image|dataUrl|url}}     nested wrappers
 *   {result: {images: [...]}}         media-forge canvas_compat (D-192, live 08-30)
 *   {url}                             a URL the provider wants us to fetch
 *
 * A bare base64 payload (no `data:` prefix — media-forge returns raw bytes)
 * is WRAPPED, never fetched: urlToDataUrl would try to fetch "iVBORw0…" as a
 * URL and fail with a misleading "failed fetching returned URL" error.
 */
export async function normalizeImageResponse(
  body: unknown,
  options?: { signal?: AbortSignal; base?: string },
): Promise<string> {
  if (typeof body !== 'object' || body === null) {
    throw new Error('image generation failed: provider returned an empty response');
  }
  const b = body as {
    success?: unknown;
    error?: unknown;
    message?: unknown;
    images?: unknown;
    image?: unknown;
    dataUrl?: unknown;
    url?: unknown;
    result?: { image?: unknown; dataUrl?: unknown; url?: unknown; images?: unknown };
  };

  if (b.success === false) {
    throw new Error(`image generation failed: ${String(b.error ?? b.message ?? 'provider reported failure')}`);
  }
  if (b.error && b.success === undefined) {
    throw new Error(`image generation failed: ${String(b.error)}`);
  }

  const candidate = firstImage(b);
  if (typeof candidate === 'string' && candidate.length > 0) {
    if (candidate.startsWith('data:')) return candidate;
    if (isBareBase64(candidate)) return `data:image/png;base64,${candidate}`;
    return await urlToDataUrl(candidate, options?.signal);
  }
  if (candidate) {
    // object-shaped image (e.g. {url}) — try the same normalization on it
    return normalizeImageResponse(candidate, options);
  }
  throw new Error('image generation failed: provider returned no image in the response');
}

function firstImage(b: {
  images?: unknown;
  image?: unknown;
  dataUrl?: unknown;
  url?: unknown;
  result?: { image?: unknown; dataUrl?: unknown; url?: unknown; images?: unknown };
}): unknown {
  if (Array.isArray(b.images) && b.images.length > 0) return b.images[0];
  if (typeof b.image === 'string' || (typeof b.image === 'object' && b.image !== null)) return b.image;
  if (typeof b.dataUrl === 'string') return b.dataUrl;
  if (b.result) {
    if (Array.isArray(b.result.images) && b.result.images.length > 0) return b.result.images[0];
    if (typeof b.result.image === 'string' || (typeof b.result.image === 'object' && b.result.image !== null)) {
      return b.result.image;
    }
    if (typeof b.result.dataUrl === 'string') return b.result.dataUrl;
    if (typeof b.result.url === 'string') return b.result.url;
  }
  if (typeof b.url === 'string') return b.url;
  return undefined;
}

/**
 * True for a raw base64 payload that must be wrapped as a data URL, never
 * fetched. Discriminated from a relative URL by construction: a URL path has
 * a '.' (extension) or is short; a real image payload is long, length % 4 == 0,
 * and carries no '.' or ':' (the '/' base64 character IS allowed — a path
 * would also have a '.', which a payload cannot).
 */
function isBareBase64(s: string): boolean {
  return (
    s.length >= 64 &&
    s.length % 4 === 0 &&
    !s.includes(':') &&
    !s.includes('.') &&
    /^[A-Za-z0-9+/=]+$/.test(s)
  );
}

/** Fetch a returned image URL and read it as a data URL (cross-origin ok when CORS allows). */
async function urlToDataUrl(url: string, signal: AbortSignal | undefined): Promise<string> {
  let resp: Response;
  try {
    resp = await abortableFetch(url, { method: 'GET' }, signal);
  } catch (err) {
    throw new Error(`image generation failed fetching returned URL ${url}: ${describe(err)}`);
  }
  if (!resp.ok) {
    throw new Error(`image generation failed fetching returned URL ${url}: HTTP ${resp.status}`);
  }
  try {
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`image generation failed reading blob from ${url}`));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    throw new Error(`image generation failed reading returned URL ${url}: ${describe(err)}`);
  }
}
