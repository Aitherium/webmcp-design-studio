/**
 * search-preferences' embedder: the aither-code-embed student (Qwen3-Embedding-0.6B
 * distilled, Q4_K_M, 1024-dim, last-token pooling baked into the GGUF) running
 * INSIDE THE TAB through wllama. Nothing leaves the device.
 *
 * The worker is the same pre-built bundle Veil ships (`public/workers/
 * code-embed-wasm-worker.js` + `wllama.wasm`), copied here so the studio stays
 * self-contained: the worker chain must not depend on a CDN. Only the WEIGHTS
 * come from the public mirror, once, then live in Cache Storage.
 *
 * Protocol (owned by the worker, mirrored here):
 *   in : {type:"load", modelId:<weights url>} | {type:"embed", requestId, texts, mode}
 *   out: {type:"progress"|"ready"|"error"} | {type:"embed-result"|"embed-error", requestId}
 *
 * Three rules this module enforces, each a measured lesson:
 *  - NOTHING downloads until the human has granted on-device consent (the same
 *    chip that gates the Bonsai chat model). A 396 MB pull nobody asked for is
 *    the silent-failure class the consent gate exists for. The key is read from
 *    localStorage rather than imported from agent/loader so this stays a leaf
 *    module (tools -> embedder -> loader -> loop -> tools would be a cycle);
 *    `tests/search-preferences.test.ts` pins the key against loader.ts.
 *  - An EMPTY store never loads the model. Searching nothing is a fast empty
 *    answer, not a 396 MB download followed by an empty answer.
 *  - Every wait has a deadline. A worker the browser kills posts nothing, and a
 *    promise that never settles reads as "generating forever".
 */

// aither-studio-embed: Qwen3-Embedding-0.6B fine-tuned on agent-question <-> preference-record
// pairs (recipe: AitherOS config/embedders/aither-studio-embed.yaml). It replaced the
// code-search student, which scored 6/12 top-1 on the studio gold set for every
// inference-time variant. The recipe's query_prefix is EMPTY, so queries go to the worker
// RAW (mode "document") -- train and serve must agree, and the code-search Instruct prefix
// the worker adds in mode "query" would be a mismatch here.
export const CODE_EMBED_WEIGHTS_URL =
  'https://artifact.aitherium.com/aither-studio-embed-v1/aither-studio-embed.q4_k_m.gguf';
export const CODE_EMBED_DIM = 1024;
export const CODE_EMBED_PROVIDER = 'aither-studio-embed';
/** The recipe's query_prefix is "", so both sides embed raw text. */
export const QUERY_EMBED_MODE: EmbedMode = 'document';
export const EMBED_WORKER_URL = '/workers/code-embed-wasm-worker.js';
/** 396 MB cold. Generous on purpose: slow-but-alive must not read as dead. */
export const EMBED_LOAD_TIMEOUT_MS = 300_000;
export const EMBED_REQUEST_TIMEOUT_MS = 120_000;
/** Same key agent/loader.ts writes when the human accepts the on-device chip. */
export const ON_DEVICE_CONSENT_KEY = 'webmcp-studio-consent-v1';

export type EmbedMode = 'query' | 'document';
export type EmbedFn = (texts: string[], mode: EmbedMode) => Promise<number[][]>;

export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedderUnavailableError';
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function isOnDeviceConsentGiven(storage: Storage | undefined = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(ON_DEVICE_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

/* -- pure ranking ------------------------------------------------------------ */

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RankedPref {
  key: string;
  value: string;
  /** cosine in [-1, 1], rounded to 4 places for the agent. */
  score: number;
}

export function rankByCosine(
  queryVec: ArrayLike<number>,
  items: Array<{ key: string; value: string; vec: ArrayLike<number> }>,
  limit: number,
): RankedPref[] {
  return items
    .map((it) => ({ key: it.key, value: it.value, score: cosine(queryVec, it.vec) }))
    .sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
    .slice(0, Math.max(0, limit))
    .map((r) => ({ ...r, score: Math.round(r.score * 1e4) / 1e4 }));
}

/** The text the document side embeds: key and value together, so a query about
 *  "colours" can land on `brand_color: #ff6600` through either half. */
export function prefDocument(key: string, value: string): string {
  return `${key}: ${value}`;
}

/* -- worker client ----------------------------------------------------------- */

type WorkerMsg =
  | { type: 'progress'; progress?: number; file?: string }
  | { type: 'ready'; modelId?: string }
  | { type: 'error'; message?: string }
  | { type: 'embed-result'; requestId: string; vectors: number[][]; dim?: number }
  | { type: 'embed-error'; requestId: string; error?: string };

export interface EmbedderStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  detail: string | null;
}

interface Pending {
  resolve: (v: number[][]) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PrefEmbedderClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly cache = new Map<string, number[]>();
  private seq = 0;
  status: EmbedderStatus = { phase: 'idle', progress: 0, detail: null };
  private readonly spawn: () => Worker;
  private readonly weightsUrl: string;

  // Explicit fields, not parameter properties: the build runs `tsc -b` with
  // `erasableSyntaxOnly`, which rejects the shorthand (TS1294).
  constructor(spawn?: () => Worker, weightsUrl?: string) {
    this.spawn = spawn ?? (() => new Worker(EMBED_WORKER_URL));
    this.weightsUrl = weightsUrl ?? CODE_EMBED_WEIGHTS_URL;
  }

  /** Idempotent: the first call spawns + loads; later calls await the same promise. */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.status = { phase: 'error', progress: 0, detail: err.message };
          this.ready = null; // a later call may retry
          this.worker?.terminate();
          this.worker = null;
          reject(err);
        } else {
          this.status = { phase: 'ready', progress: 100, detail: null };
          resolve();
        }
      };
      const timer = setTimeout(
        () =>
          done(
            new EmbedderUnavailableError(
              `embedding model did not become ready within ${EMBED_LOAD_TIMEOUT_MS / 1000}s`,
            ),
          ),
        EMBED_LOAD_TIMEOUT_MS,
      );
      let w: Worker;
      try {
        w = this.spawn();
      } catch (err) {
        done(
          new EmbedderUnavailableError(
            `could not start the embedding worker: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }
      this.worker = w;
      this.status = { phase: 'loading', progress: 0, detail: 'starting worker' };
      w.addEventListener('message', (ev: MessageEvent<WorkerMsg>) => {
        const m = ev.data;
        if (!m || typeof m !== 'object') return;
        switch (m.type) {
          case 'progress':
            this.status = {
              phase: 'loading',
              progress: m.progress ?? this.status.progress,
              detail: m.file ?? null,
            };
            return;
          case 'ready':
            done();
            return;
          case 'error': {
            const e = new EmbedderUnavailableError(m.message ?? 'embedding worker error');
            if (!settled) done(e);
            else this.rejectAll(e);
            return;
          }
          case 'embed-result':
          case 'embed-error': {
            const p = this.pending.get(m.requestId);
            if (!p) return;
            this.pending.delete(m.requestId);
            clearTimeout(p.timer);
            if (m.type === 'embed-result') p.resolve(m.vectors);
            else p.reject(new EmbedderUnavailableError(m.error ?? 'embedding failed'));
            return;
          }
        }
      });
      // A worker the browser kills posts nothing: bind BOTH error events.
      w.addEventListener('error', (ev) => {
        const e = new EmbedderUnavailableError(
          `embedding worker failed: ${(ev as ErrorEvent).message || 'module load error'}`,
        );
        if (!settled) done(e);
        else this.rejectAll(e);
      });
      w.addEventListener('messageerror', () => {
        const e = new EmbedderUnavailableError('embedding worker rejected a message');
        if (!settled) done(e);
        else this.rejectAll(e);
      });
      w.postMessage({ type: 'load', modelId: this.weightsUrl });
    });
    return this.ready;
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** Embed texts, serving repeats from an in-memory cache keyed by mode+text. */
  async embed(texts: string[], mode: EmbedMode): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: Array<number[] | null> = texts.map((t) => this.cache.get(mode + ' ' + t) ?? null);
    const missIdx = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (missIdx.length > 0) {
      await this.load();
      const w = this.worker;
      if (!w) throw new EmbedderUnavailableError('embedding worker is not running');
      const requestId = `pe-${++this.seq}`;
      const vectors = await new Promise<number[][]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(
            new EmbedderUnavailableError(
              `embedding request timed out after ${EMBED_REQUEST_TIMEOUT_MS / 1000}s`,
            ),
          );
        }, EMBED_REQUEST_TIMEOUT_MS);
        this.pending.set(requestId, { resolve, reject, timer });
        w.postMessage({ type: 'embed', requestId, texts: missIdx.map((i) => texts[i]), mode });
      });
      if (vectors.length !== missIdx.length) {
        throw new EmbedderUnavailableError(
          `embedder returned ${vectors.length} vectors for ${missIdx.length} texts`,
        );
      }
      missIdx.forEach((i, j) => {
        const v = vectors[j];
        if (!Array.isArray(v) || v.length !== CODE_EMBED_DIM) {
          throw new EmbedderUnavailableError(
            `embedding has ${v?.length ?? 0} dims, expected ${CODE_EMBED_DIM} -- wrong weights loaded?`,
          );
        }
        this.cache.set(mode + ' ' + texts[i], v);
        out[i] = v;
      });
    }
    return out as number[][];
  }

  dispose(): void {
    this.rejectAll(new EmbedderUnavailableError('embedder disposed'));
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.status = { phase: 'idle', progress: 0, detail: null };
  }
}

let shared: PrefEmbedderClient | null = null;
export function sharedPrefEmbedder(): PrefEmbedderClient {
  if (!shared) shared = new PrefEmbedderClient();
  return shared;
}

/* -- the search -------------------------------------------------------------- */

export interface SearchPrefsResult {
  query: string;
  results: RankedPref[];
  /** how many stored preferences were ranked (0 = nothing saved; no model was loaded) */
  searched: number;
  provider: typeof CODE_EMBED_PROVIDER;
  dim: number;
  onDevice: true;
}

export interface SearchPrefsOptions {
  limit?: number;
  /** test seams: production uses the store, the consent flag and the worker */
  list?: () => Promise<Array<{ key: string; value: string }>>;
  consent?: () => boolean;
  embed?: EmbedFn;
}

export const CONSENT_REQUIRED_MESSAGE =
  'on-device models are not enabled: the human must accept the on-device consent chip in the ' +
  'agent panel before the 396 MB embedding model may download. Until then use recall-preference ' +
  'with the exact key.';

export async function searchPrefs(
  query: string,
  opts: SearchPrefsOptions = {},
): Promise<SearchPrefsResult> {
  const limit = opts.limit ?? 5;
  const list = opts.list ?? (await import('../state/memory')).listPrefs;
  const items = await list();
  const base: Omit<SearchPrefsResult, 'results' | 'searched'> = {
    query,
    provider: CODE_EMBED_PROVIDER,
    dim: CODE_EMBED_DIM,
    onDevice: true,
  };
  if (items.length === 0) return { ...base, results: [], searched: 0 };

  const consent = opts.consent ?? isOnDeviceConsentGiven;
  if (!consent()) throw new EmbedderUnavailableError(CONSENT_REQUIRED_MESSAGE);

  const embed: EmbedFn = opts.embed ?? ((t, m) => sharedPrefEmbedder().embed(t, m));
  const [qv] = await embed([query], QUERY_EMBED_MODE);
  const docVecs = await embed(
    items.map((it) => prefDocument(it.key, it.value)),
    'document',
  );
  const ranked = rankByCosine(
    qv,
    items.map((it, i) => ({ key: it.key, value: it.value, vec: docVecs[i] })),
    limit,
  );
  return { ...base, results: ranked, searched: items.length };
}
