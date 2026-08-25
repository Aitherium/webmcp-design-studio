/**
 * Hosted image generation client (the generate-image cloud tier).
 *
 * Contract (AitherCreate-shaped): `POST {base}/generate` with
 * `{prompt, width, height, seed}` answers `{jobId}`; the job is polled at
 * `GET {base}/jobs/{jobId}` until `status === 'done'`, then a data URL is
 * returned. Every failure names the failing hop (HTTP status, job error,
 * timeout) — never a bare "something went wrong".
 */
export interface GenerateRequest {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
}

export interface GenerateResult {
  dataUrl: string;
  /** 96px preview when the backend provides one. */
  thumbnail?: string;
  elapsedMs: number;
  seed: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 1500;
export const DEFAULT_TIMEOUT_MS = 120_000;

interface JobResponse {
  status?: string;
  dataUrl?: string;
  result?: { dataUrl?: string; image?: string; thumbnail?: string };
  thumbnail?: string;
  error?: string;
  message?: string;
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** fetch that forwards an external AbortSignal to an internal controller. */
async function abortableFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export async function generateHostedImage(
  hostedUrl: string,
  request: GenerateRequest,
  options?: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number },
): Promise<GenerateResult> {
  const base = baseUrl(hostedUrl);
  const { signal } = options ?? {};
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 31);
  const startedAt = performance.now();

  const submitUrl = `${base}/generate`;
  let resp: Response;
  try {
    resp = await abortableFetch(
      submitUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: request.prompt, width: request.width, height: request.height, seed }),
      },
      signal,
    );
  } catch (err) {
    throw new Error(`image generation failed at POST ${submitUrl}: ${describe(err)}`);
  }
  if (!resp.ok) {
    const body = await readJson(resp);
    const detail = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
    throw new Error(
      `image generation failed at POST ${submitUrl}: HTTP ${resp.status}${detail ? ` — ${detail}` : ''}`,
    );
  }
  const submitted = (await readJson(resp)) as { jobId?: string } | null;
  if (!submitted || typeof submitted.jobId !== 'string') {
    throw new Error(`image generation failed at POST ${submitUrl}: response had no jobId`);
  }
  const jobId = submitted.jobId;

  const jobUrl = `${base}/jobs/${encodeURIComponent(jobId)}`;
  const deadline = startedAt + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const now = performance.now();
    if (now >= deadline) {
      throw new Error(`image generation timed out after ${timeoutMs / 1000}s polling ${jobUrl}`);
    }
    let jobResp: Response;
    try {
      jobResp = await abortableFetch(jobUrl, { method: 'GET' }, signal);
    } catch (err) {
      throw new Error(`image generation failed polling ${jobUrl}: ${describe(err)}`);
    }
    if (!jobResp.ok) {
      throw new Error(`image generation failed polling ${jobUrl}: HTTP ${jobResp.status}`);
    }
    const job = (await readJson(jobResp)) as JobResponse | null;
    if (!job) {
      throw new Error(`image generation failed polling ${jobUrl}: empty job response`);
    }
    const status = job.status ?? '';
    if (status === 'done') {
      const dataUrl = job.dataUrl ?? job.result?.dataUrl ?? job.result?.image;
      if (!dataUrl) {
        throw new Error(`image generation failed polling ${jobUrl}: job done but no image in the response`);
      }
      return {
        dataUrl,
        thumbnail: job.thumbnail ?? job.result?.thumbnail,
        elapsedMs: Math.round(performance.now() - startedAt),
        seed,
      };
    }
    if (status === 'error') {
      const detail = job?.error ?? job?.message ?? 'unknown job error';
      throw new Error(`image generation failed polling ${jobUrl}: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
