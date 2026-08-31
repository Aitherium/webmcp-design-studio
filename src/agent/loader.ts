/**
 * On-device agent loader — the gating contract (owner requirement 2026-08-25:
 * "machines that can't run the models must not fuck themselves up; work on
 * desktop GPU/CPU; load ONE model at a time").
 *
 * Tiered capability detection + a single-model slot manager:
 *
 *   Tier A (full on-device): WebGPU adapter present AND not software-only
 *     (SwiftShader/WARP) AND deviceMemory ≥ 6 AND not saveData/2g AND the
 *     weights.aitherium.com Range probe returns 206 → both text (Bonsai LLM)
 *     and image (FLUX.2 Klein) are available.
 *   Tier B (text-only on-device): WebGPU present (software OK — the clean-room
 *     kernels run on a rasteriser, slowly) AND deviceMemory ≥ 4 → on-device
 *     TEXT agent only; generate-image device:'auto' routes to HOSTED.
 *   Tier C (hosted-only): no WebGPU / deviceMemory < 4 / saveData / Range
 *     probe fails → no on-device anything; the panel says "on-device agent
 *     unavailable — use ChatGPT/Chrome"; generate-image → hosted.
 *
 * Single-model slot: `ensureModel('text' | 'image')` — loading one UNLOADS the
 * other first (text worker dispose / image runtime dispose). Never two model
 * sets resident. Guarded by a mutex; progress events; abort propagates;
 * failure at ANY step marks the tier disabled for the session and surfaces
 * LOUD (StatusBar), falling to the next tier — never a crash.
 *
 * Demo safety: no auto-load on page open — models load on first use, gated by
 * an explicit consent flag the agent panel's chip sets.
 *
 * The runtime itself is the CDN bundle (webml-text.esm.js / webml-image.esm.js
 * on weights.aitherium.com, built by build_webml_cdn.mjs in the AitherOS tree).
 * This file is a clean-room reimplementation of the LOADER contract only — no
 * proprietary runtime code is imported; the CDN bundles are loaded by URL.
 */
import type { ModelContextSurface } from '../webmcp/types';
import { setLocalImageGenerator, type LocalImageGenerator } from '../webmcp/tools/image';
import { createHostedChatWorker } from './hostedChat';

/* ── configuration ────────────────────────────────────────────────────────── */

const CDN = 'https://weights.aitherium.com';
/** Text runtime bundle (dynamic import; exports createBonsaiChatWorker + runWebMLWorker). */
export const WEBML_RUNTIME_URL =
  import.meta.env.VITE_WEBML_RUNTIME_URL ?? `${CDN}/webml-text.esm.js`;
/** Image runtime bundle (dynamic import; exports createBonsaiImageRuntime). */
export const WEBML_IMAGE_URL =
  import.meta.env.VITE_WEBML_IMAGE_URL ?? `${CDN}/webml-image.esm.js`;
/**
 * Same-origin module-worker entry that imports the CDN bundle and runs it.
 * The ?v=3 query is a CACHE-BUSTER for the entry file itself: GitHub Pages
 * answers ETag 304s, so a returning visitor's browser can keep serving the
 * OLD entry (pre-runtime-ready handshake, the 0% hang) after a deploy even
 * though the bytes changed. Bump it whenever bonsai-worker-entry.js changes.
 * (The runtime import inside the entry carries its own ?v=2 for the
 * vendored copy of webml-text.esm.js.)
 */
export const BONSAI_WORKER_ENTRY_URL =
  import.meta.env.VITE_BONSAI_WORKER_ENTRY_URL ?? '/workers/bonsai-worker-entry.js?v=3';
/** MMDiT checkpoint + VAE weights on the Range+CORS mirror (verified assets). */
export const IMAGE_WEIGHTS_URL = `${CDN}/bonsai-image-4b.q2_0.gguf`;
export const VAE_WEIGHTS_URL = `${CDN}/vae.safetensors`;

/* ── types ────────────────────────────────────────────────────────────────── */

export type DeviceTier = 'A' | 'B' | 'C';
export type ModelKind = 'text' | 'image';

/** The model catalog the picker offers (weights.aitherium.com, exact asset names). */
export interface ModelInfo {
  id: string;
  label: string;
  params: string;
  sizeMb: number;
  url: string;
  contextWindow: number;
  blurb: string;
}

export const BONSAI_MODELS: ModelInfo[] = [
  {
    id: 'bonsai-1.7b',
    label: 'Bonsai 1.7B',
    params: '1.7B',
    sizeMb: 236,
    url: `${CDN}/Bonsai-1.7B-Q1_0.gguf`,
    contextWindow: 32768,
    blurb: 'The lightest size — 236 MB, runs on phones and older laptops.',
  },
  {
    id: 'bonsai-4b',
    label: 'Bonsai 4B',
    params: '4B',
    sizeMb: 545,
    url: `${CDN}/Bonsai-4B-Q1_0.gguf`,
    contextWindow: 32768,
    blurb: 'Balanced: smarter than 1.7B, quick to download and run.',
  },
  {
    id: 'bonsai-8b',
    label: 'Bonsai 8B',
    params: '8B',
    sizeMb: 1104,
    url: `${CDN}/Bonsai-8B-Q1_0.gguf`,
    contextWindow: 65536,
    blurb: 'Better reasoning, ~1 GB. Desktop GPU recommended.',
  },
];

export function getBonsaiModel(id: string): ModelInfo | undefined {
  return BONSAI_MODELS.find((m) => m.id === id);
}

/**
 * Default model for this device — the suggestion, never a promise: the picker
 * always wins. Errs small (1.7B on weak links / low memory, 4B default) — the
 * 8B's ~1.1 GB load made the studio feel dramatically slower than
 * aitherium.com, which runs the 236 MB 1.7B in the same browser (measured
 * live 2026-08-30, owner: "it's faster at aitherium.com"). The old
 * implementation returned the 8B to every machine with ≥8 GB device memory —
 * i.e. every desktop — contradicting this docstring. The 8B stays in the
 * picker for better reasoning; the few-shot example carries tool-chaining on
 * the smaller sizes.
 */
export function suggestBonsaiModelId(): string {
  if (typeof navigator === 'undefined') return 'bonsai-4b';
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.connection?.saveData) return 'bonsai-1.7b';
  if (nav.connection?.effectiveType && /2g/.test(nav.connection.effectiveType)) return 'bonsai-1.7b';
  const mem = nav.deviceMemory ?? 4;
  if (mem < 8) return 'bonsai-1.7b';
  return 'bonsai-4b';
}

/** The worker wire protocol (the CDN bundle's contract — see its protocol.ts). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}
export type WorkerRequest =
  | { type: 'load'; modelId: string }
  | {
      type: 'generate';
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
      topK?: number;
      topP?: number;
      repetitionPenalty?: number;
      reasoningBudget?: number;
    }
  | { type: 'interrupt' };
export type WorkerResponse =
  | { type: 'progress'; file?: string; progress?: number; loaded?: number; total?: number }
  | { type: 'ready'; modelId: string }
  | { type: 'token'; text: string; channel?: 'thinking' | 'answer' }
  | { type: 'done'; text: string; reasoning?: string; tokensPerSecond?: number }
  | { type: 'tool_action'; actions: Array<{ kind: 'open'; app: string }> }
  | { type: 'status'; phase?: string }
  | { type: 'error'; message: string; fatal?: 'device-lost' };

/** The minimal worker surface the loader holds. `on` may return an
 *  unsubscriber (the loop uses it to stop listening after a round). */
export interface ChatWorkerLike {
  post(msg: WorkerRequest): void;
  on(listener: (msg: WorkerResponse) => void): (() => void) | void;
  interrupt(): void;
  dispose(): void;
}

/** The image runtime surface (the CDN bundle's contract). */
export interface ImageRuntimeLike {
  readonly ready: boolean;
  generate(opts: {
    prompt: string;
    width?: number;
    height?: number;
    seed?: number;
    steps?: number;
    onProgress?: (p: { phase: string; percent: number; detail?: string }) => void;
  }): Promise<Blob>;
  dispose(): void;
}

/** The CDN bundles, structurally — the app never imports them statically. */
export interface WebMLRuntimeModule {
  createBonsaiChatWorker(opts?: { entryUrl?: string }): ChatWorkerLike;
  createBonsaiImageRuntime(init: {
    weightsUrl: string;
    vaeWeightsUrl?: string;
    onProgress?: (p: { phase: string; percent: number; detail?: string }) => void;
  }): Promise<ImageRuntimeLike>;
}

/** What tier detection measured — the reasons are surfaced in the UI. */
export interface DeviceProbe {
  adapter: boolean;
  software: boolean;
  deviceMemory: number;
  saveData: boolean;
  slowLink: boolean;
  range206: boolean;
}
export interface TierVerdict {
  tier: DeviceTier;
  reasons: string[];
  probe: DeviceProbe;
}

/** Errors the loader throws are caught by the UI and surfaced LOUD — never a crash. */
export class LoaderError extends Error {
  readonly kind: ModelKind | 'both';
  readonly tier: DeviceTier | null;

  constructor(message: string, kind: ModelKind | 'both', tier: DeviceTier | null) {
    super(message);
    this.name = 'LoaderError';
    this.kind = kind;
    this.tier = tier;
  }
}

/* ── tier detection ───────────────────────────────────────────────────────── */

export const TIER_A_MEMORY = 6;
export const TIER_B_MEMORY = 4;
/** Range+CORS probe URL — must serve 206 for `bytes=0-0` (asserted on every load). */
export const RANGE_PROBE_URL = `${CDN}/Bonsai-4B-Q1_0.gguf`;

async function range206(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    // Hard timeout: the probe must not hold up tier detection (and with it the
    // whole boot) on a network where the mirror stalls — measured 2026-08-26,
    // a phone-class session sat at a blank page while this fetch hung. Tier C
    // is the correct outcome for "cannot judge in time".
    const res = await fetchImpl(url, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status !== 206) return false;
    return /bytes 0-0\//.test(res.headers.get('content-range') ?? '');
  } catch {
    return false;
  }
}

export interface TierProbeOverrides {
  hasGpu?: boolean;
  adapterInfo?: { isFallbackAdapter?: boolean; vendor?: string } | null;
  deviceMemory?: number;
  saveData?: boolean;
  effectiveType?: string;
  range206?: boolean;
}

/**
 * Detect the device tier. Overrides exist so tests (and the demo) can pin the
 * hardware; production passes none and reads the real navigator.
 */
export async function detectTier(opts?: {
  overrides?: TierProbeOverrides;
  fetchImpl?: typeof fetch;
}): Promise<TierVerdict> {
  const o = opts?.overrides ?? {};
  const reasons: string[] = [];

  let adapter = o.hasGpu === undefined ? null : o.hasGpu;
  let info: { isFallbackAdapter?: boolean; vendor?: string } | null = o.adapterInfo ?? null;
  if (o.hasGpu === undefined) {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: unknown } }).gpu;
    if (gpu?.requestAdapter) {
      try {
        const got = await (gpu.requestAdapter as () => Promise<unknown>).call(gpu);
        adapter = Boolean(got);
        if (got) {
          info = ((got as { info?: unknown }).info ?? null) as typeof info;
        }
      } catch {
        adapter = false;
      }
    } else {
      adapter = false;
    }
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const deviceMemory = o.deviceMemory ?? nav.deviceMemory ?? 4;
  const saveData = o.saveData ?? nav.connection?.saveData ?? false;
  const effectiveType = o.effectiveType ?? nav.connection?.effectiveType ?? '4g';
  const slowLink = /2g/.test(effectiveType);

  const software =
    info?.isFallbackAdapter === true || (info?.vendor ?? '').trim().toLowerCase() === 'microsoft';
  const probe: DeviceProbe = {
    adapter: Boolean(adapter),
    software,
    deviceMemory,
    saveData,
    slowLink,
    range206: false,
  };

  let rangeOk = o.range206;
  if (rangeOk === undefined) {
    // No adapter → Tier C no matter what the mirror does — the probe is
    // pointless (and one less network round-trip at boot on GPU-less
    // devices, where a stalled mirror previously blocked tier detection
    // entirely — measured 2026-08-26 on a phone-class session).
    rangeOk = !probe.adapter ? false : await range206(RANGE_PROBE_URL, opts?.fetchImpl);
  }
  probe.range206 = rangeOk;

  if (!probe.adapter) reasons.push('no WebGPU adapter');
  if (probe.software) reasons.push('software rasteriser only (SwiftShader/WARP)');
  if (probe.deviceMemory < TIER_B_MEMORY) reasons.push(`deviceMemory ${probe.deviceMemory} < ${TIER_B_MEMORY}`);
  if (probe.deviceMemory < TIER_A_MEMORY) reasons.push(`deviceMemory ${probe.deviceMemory} < ${TIER_A_MEMORY}`);
  if (probe.saveData) reasons.push('data saver on');
  if (probe.slowLink) reasons.push(`slow link (${effectiveType})`);
  if (!probe.range206) reasons.push('weight mirror Range probe failed');

  // The gating contract is explicit that saveData / 2g / a failed Range probe
  // mean Tier C — a machine that would thrash through a 545 MB download gets
  // no on-device anything, regardless of its GPU.
  let tier: DeviceTier;
  if (
    probe.adapter &&
    !probe.software &&
    probe.deviceMemory >= TIER_A_MEMORY &&
    !probe.saveData &&
    !probe.slowLink &&
    probe.range206
  ) {
    tier = 'A';
  } else if (
    probe.adapter &&
    probe.deviceMemory >= TIER_B_MEMORY &&
    !probe.saveData &&
    !probe.slowLink &&
    probe.range206
  ) {
    tier = 'B';
  } else {
    tier = 'C';
  }

  return { tier, reasons, probe };
}

/* ── the single-model slot manager ────────────────────────────────────────── */

export interface LoaderEvent {
  type: 'tier' | 'phase' | 'progress' | 'slot' | 'consent' | 'error';
  tier?: DeviceTier;
  kind?: ModelKind;
  phase?: string;
  progress?: number;
  detail?: string;
  message?: string;
}

/** Consent is a one-time human decision, remembered across page loads — the
 * consent CHIP still gates the very first use (nothing auto-loads before
 * it), but a returning visitor must not start cold every reload (measured
 * live 2026-08-30, owner: "it should still be faster once the model is
 * downloaded and we preload the model quickly anyway" — the model was NOT
 * preloaded and consent was NOT remembered, so every reload waited for a
 * chip click + a full lazy load). */
const CONSENT_KEY = 'webmcp-studio-consent-v1';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadPersistedConsent(storage?: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistConsent(given: boolean, storage?: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(CONSENT_KEY, given ? '1' : '0');
  } catch {
    /* private mode / no storage — the session still works, it just re-asks */
  }
}

export class AgentLoader {
  private verdict: TierVerdict | null = null;
  private consentGiven = loadPersistedConsent(safeStorage());
  private slot: ModelKind | null = null;
  private chatWorker: ChatWorkerLike | null = null;
  private imageRuntime: ImageRuntimeLike | null = null;
  /** A kind that failed to load is disabled for the session (gating contract). */
  private sessionDisabled = new Set<ModelKind>();
  private mutex: Promise<void> = Promise.resolve();
  private listeners = new Set<(e: LoaderEvent) => void>();
  /** Hosted lane (2026-08-28): force the tunnel-proxied llama.cpp brain for
   *  any device — Tier C (no WebGPU) or `?hosted=1`. No model loads, no
   *  consent; getChatWorker() returns the hosted worker. */
  private hostedMode = false;
  /** Test hook: replaces the CDN dynamic import. */
  private runtimeModules: Partial<Record<ModelKind, WebMLRuntimeModule>> | null = null;
  /** Where the chat worker is created — set by the panel/store wiring. */
  private entryUrl = BONSAI_WORKER_ENTRY_URL;

  constructor() {
    // The gating contract's image hook: the generate-image tool's device:'auto'
    // path consults this adapter, which follows the tier + consent.
    setLocalImageGenerator(this.imageGenerator());
  }

  /* ── public surface ────────────────────────────────────────────────────── */

  onChange(cb: (e: LoaderEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: LoaderEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Detect the tier at boot. Never loads anything. */
  async init(): Promise<TierVerdict> {
    if (this.verdict) return this.verdict;
    this.verdict = await detectTier();
    this.emit({ type: 'tier', tier: this.verdict.tier });
    return this.verdict;
  }

  getTier(): TierVerdict | null {
    return this.verdict;
  }

  isConsentGiven(): boolean {
    return this.consentGiven;
  }

  /** The consent chip — the ONLY thing that may move the loader out of idle.
   * The decision is persisted so a returning visitor's model can preload at
   * boot (see the CONSENT_KEY note above). */
  setConsent(given: boolean): void {
    this.consentGiven = given;
    persistConsent(given, safeStorage());
    this.emit({ type: 'consent' });
  }

  getSlot(): ModelKind | null {
    return this.slot;
  }

  getChatWorker(): ChatWorkerLike | null {
    if (this.hostedMode) return createHostedChatWorker();
    return this.chatWorker;
  }

  /** Enable/disable the hosted lane (call before the first generation). */
  setHostedMode(on: boolean): void {
    this.hostedMode = on;
    this.emit({ type: 'tier', tier: on ? 'B' : this.verdict?.tier });
  }

  getImageRuntime(): ImageRuntimeLike | null {
    return this.imageRuntime;
  }

  isDisabled(kind: ModelKind): boolean {
    return this.sessionDisabled.has(kind);
  }

  /** Stop a generation (text) — the model stays loaded. */
  interrupt(kind: ModelKind): void {
    if (kind === 'text') this.chatWorker?.interrupt();
  }

  /**
   * Load `kind` into the single slot, unloading the other family FIRST.
   * Mutex-guarded; progress events; failure marks the kind disabled for the
   * session and rethrows as LoaderError (the caller falls to the next tier).
   */
  ensureModel(kind: ModelKind, opts?: { modelId?: string }): Promise<void> {
    const run = this.mutex.then(() => this.ensureModelLocked(kind, opts?.modelId ?? null));
    // Keep the chain alive even when a load fails, so a later ensureModel
    // (the other kind, or a retry after a session-level change) still runs.
    this.mutex = run.catch(() => undefined);
    return run;
  }

  /** Unload the resident kind (frees the slot). */
  unload(kind: ModelKind): Promise<void> {
    const run = this.mutex.then(() => {
      if (this.slot !== kind) return;
      this.teardown(kind);
    });
    this.mutex = run.catch(() => undefined);
    return run;
  }

  /** Test hook — inject stub runtimes instead of the CDN bundles. */
  injectRuntimes(modules: Partial<Record<ModelKind, WebMLRuntimeModule>> | null): void {
    this.runtimeModules = modules;
  }

  /** Test hook — override the worker entry URL. */
  setEntryUrl(url: string): void {
    this.entryUrl = url;
  }

  /**
   * Test hook — pin the tier verdict (the real one is detected from the
   * navigator, which jsdom cannot fake for the singleton). Pass null to
   * re-enable real detection.
   */
  setTierOverride(tier: 'A' | 'B' | 'C' | null): void {
    this.verdict = tier
      ? { tier, reasons: ['(test override)'], probe: { adapter: true, software: false, deviceMemory: 16, saveData: false, slowLink: false, range206: true } }
      : null;
  }

  /** Test hook — full state reset (the singleton persists across tests). */
  reset(): void {
    this.chatWorker?.dispose();
    this.imageRuntime?.dispose();
    this.chatWorker = null;
    this.imageRuntime = null;
    this.slot = null;
    this.sessionDisabled.clear();
    this.consentGiven = false;
    this.verdict = null;
    this.mutex = Promise.resolve();
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private teardown(kind: ModelKind): void {
    if (kind === 'text') {
      this.chatWorker?.dispose();
      this.chatWorker = null;
    } else {
      this.imageRuntime?.dispose();
      this.imageRuntime = null;
    }
    if (this.slot === kind) this.slot = null;
    this.emit({ type: 'slot', kind });
  }

  private requireConsent(kind: ModelKind): void {
    if (!this.consentGiven) {
      throw new LoaderError(
        `on-device ${kind} is not loaded — approve the consent chip in the agent panel first`,
        kind,
        this.verdict?.tier ?? null,
      );
    }
  }

  private async ensureModelLocked(kind: ModelKind, modelId: string | null): Promise<void> {
    if (this.sessionDisabled.has(kind)) {
      throw new LoaderError(
        `on-device ${kind} is disabled for this session (a previous load failed) — `
          + (kind === 'image'
            ? 'the hosted tier is being used instead'
            : 'the design tools below still work'),
        kind,
        this.verdict?.tier ?? null,
      );
    }
    if (this.slot === kind && (kind === 'image' ? this.imageRuntime : this.chatWorker)) {
      return; // already resident
    }

    // The gating contract: ONE model set at a time. Unload the other first.
    if (this.slot && this.slot !== kind) this.teardown(this.slot);

    if (kind === 'text') {
      await this.loadText(modelId);
    } else {
      await this.loadImage();
    }
  }

  private async loadText(modelId: string | null): Promise<void> {
    const verdict = this.verdict ?? (await this.init());
    if (verdict.tier === 'C') {
      throw new LoaderError(
        'on-device agent unavailable on this device (Tier C) — the design tools below still work; '
        + 'the agent brain itself needs a WebGPU browser',
        'text',
        verdict.tier,
      );
    }
    this.requireConsent('text');

    const id = modelId ?? suggestBonsaiModelId();
    const model = getBonsaiModel(id);
    if (!model) throw new LoaderError(`unknown model '${id}'`, 'text', verdict.tier);

    this.emit({ type: 'phase', kind: 'text', phase: 'loading' });
    this.emit({ type: 'progress', kind: 'text', progress: 0, detail: `loading ${model.label} (${model.sizeMb} MB)` });
    await this.reportAdapter('text');

    try {
      const mod = this.runtimeModules?.text ?? ((await import(/* @vite-ignore */ WEBML_RUNTIME_URL)) as WebMLRuntimeModule);
      const worker = mod.createBonsaiChatWorker({ entryUrl: this.entryUrl });
      this.chatWorker = worker;

      // The entry imports the runtime ASYNC and only then installs onmessage —
      // a {type:'load'} posted before that is DROPPED (workers do not buffer),
      // leaving the UI at "loading 0%" forever while the startup heartbeat has
      // already disarmed the no-message timer. Measured 2026-08-28 live:
      // "worker-started" arrives at ~30ms — BEFORE the runtime import resolves —
      // so a heartbeat that accepts ANY status still posts the load into the
      // void. The entry now posts a SECOND status, phase "runtime-ready", AFTER
      // runWebMLWorker has synchronously installed its listener; only that
      // signal (or a real ready/progress/error) may unblock the load.
      await new Promise<void>((resolve, reject) => {
        const heartbeatTimer = setTimeout(
          () => reject(new Error('the on-device worker never started (no runtime-ready heartbeat within 15s)')),
          15_000,
        );
        let unsub: (() => void) | void;
        unsub = worker.on((msg) => {
          const runtimeReady = msg.type === 'status' && msg.phase === 'runtime-ready';
          if (runtimeReady || msg.type === 'ready' || msg.type === 'progress' || msg.type === 'error') {
            clearTimeout(heartbeatTimer);
            unsub?.();
            if (msg.type === 'error') reject(new Error(msg.message));
            else resolve();
          }
        });
      });

      const ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        let sawMessage = false;
        const done = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(noMessageTimer);
          if (err) reject(err);
          else resolve();
        };
        // A module worker that fails to LOAD (stale MIME cache, import error)
        // dies silently — no message ever arrives and `ready` never settles,
        // which used to sit at "loading 0%" forever (measured 2026-08-26).
        // Any message proves the worker is alive; none within the window
        // means it never started. Fail LOUD instead of hanging.
        const noMessageTimer = setTimeout(() => {
          if (!sawMessage) {
            done(
              new Error(
                'the on-device runtime sent no response for 120s — the worker likely failed to start; ' +
                  'reload the page and try again',
              ),
            );
          }
        }, 120_000);
        worker.on((msg) => {
          sawMessage = true;
          if (msg.type === 'progress') {
            this.emit({
              type: 'progress',
              kind: 'text',
              progress: msg.progress,
              detail: msg.file,
            });
          } else if (msg.type === 'ready') {
            done(null);
          } else if (msg.type === 'error') {
            done(new Error(msg.message));
          }
        });
      });

      worker.post({ type: 'load', modelId: id });
      await ready;
      this.slot = 'text';
      this.emit({ type: 'slot', kind: 'text' });
      this.emit({ type: 'phase', kind: 'text', phase: 'ready' });
    } catch (err) {
      this.teardown('text');
      this.sessionDisabled.add('text');
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', kind: 'text', message });
      this.emit({ type: 'phase', kind: 'text', phase: 'error' });
      throw new LoaderError(
        `on-device text agent failed to load: ${message}`,
        'text',
        this.verdict?.tier ?? null,
      );
    }
  }

  private async loadImage(): Promise<void> {
    const verdict = this.verdict ?? (await this.init());
    if (verdict.tier !== 'A') {
      throw new LoaderError(
        verdict.tier === 'B'
          ? 'on-device image generation needs Tier A hardware (a real GPU + 6 GB memory) — the hosted tier is used instead'
          : 'on-device image generation is unavailable on this device (Tier C) — the hosted tier is used instead',
        'image',
        verdict.tier,
      );
    }
    this.requireConsent('image');

    this.emit({ type: 'phase', kind: 'image', phase: 'loading' });
    this.emit({ type: 'progress', kind: 'image', progress: 5, detail: 'acquiring WebGPU device' });
    await this.reportAdapter('image');

    try {
      const mod = this.runtimeModules?.image ?? ((await import(/* @vite-ignore */ WEBML_IMAGE_URL)) as WebMLRuntimeModule);
      // The image LOAD has no natural bound — measured live 2026-08-30: the
      // runtime's VAE load froze at ~20% and the createBonsaiImageRuntime
      // promise never settled, so ensureModel hung and the tool's own
      // timeout burned the full 120s before the fleet fallback. Bound it
      // here (60s is generous for a ~300 MB VAE) so a stuck load fails FAST
      // and the generate-image chain falls to hosted immediately.
      const rt = await Promise.race([
        mod.createBonsaiImageRuntime({
          weightsUrl: IMAGE_WEIGHTS_URL,
          vaeWeightsUrl: VAE_WEIGHTS_URL,
          onProgress: (p) =>
            this.emit({ type: 'progress', kind: 'image', progress: p.percent, detail: p.detail }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'on-device image runtime load timed out after 60s — the VAE weights likely stalled mid-load (measured live 2026-08-30: froze at ~20%); the hosted lane is used instead',
                ),
              ),
            60_000,
          ),
        ),
      ]);
      this.imageRuntime = rt;
      this.slot = 'image';
      this.emit({ type: 'slot', kind: 'image' });
      this.emit({ type: 'phase', kind: 'image', phase: 'ready' });
    } catch (err) {
      this.teardown('image');
      this.sessionDisabled.add('image');
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', kind: 'image', message });
      this.emit({ type: 'phase', kind: 'image', phase: 'error' });
      throw new LoaderError(
        `on-device image generation failed to load: ${message}`,
        'image',
        this.verdict?.tier ?? null,
      );
    }
  }

  /**
   * Name the WebGPU adapter the browser will actually offer — so a
   * software/fallback adapter (which explains single-digit tok/s on the Q2
   * 4B: SwiftShader-class adapters do ~1-6 tok/s while a real GPU does
   * 20+) is VISIBLE in the load progress instead of reading as mysterious
   * slowness (owner ask 2026-08-30: "why is token/s still so slow when
   * using webgpu"). Diagnostic only — the probe is non-fatal and silent on
   * failure; it never decides a lane.
   */
  private async reportAdapter(kind: 'text' | 'image'): Promise<void> {
    try {
      const gpu = (navigator as {
        gpu?: {
          requestAdapter?: (opts?: { powerPreference?: string }) => Promise<{
            info?: { description?: string; vendor?: string };
          } | null>;
        };
      }).gpu;
      const adapter = await gpu?.requestAdapter?.({ powerPreference: 'high-performance' });
      const name = adapter?.info?.description ?? adapter?.info?.vendor;
      if (name) {
        this.emit({ type: 'progress', kind, progress: 5, detail: `WebGPU adapter: ${name}` });
      }
    } catch {
      /* diagnostic only — never fail the load */
    }
  }

  /**
   * The LocalImageGenerator the generate-image tool's chain consults.
   * device:'auto' follows the tier: Tier A + consent → local, else the tool
   * falls through to hosted. A LoaderError here is caught by the tool and
   * routed to the next tier — the failure is never a crash.
   */
  private imageGenerator(): LocalImageGenerator {
    return {
      generate: async (req) => {
        await this.ensureModel('image');
        const rt = this.imageRuntime;
        if (!rt) throw new LoaderError('image runtime not resident', 'image', this.verdict?.tier ?? null);
        const start = performance.now();
        const blob = await rt.generate({
          prompt: req.prompt,
          width: req.width,
          height: req.height,
          seed: req.seed,
          steps: 4,
        });
        const dataUrl = await blobToDataUrl(blob);
        return {
          dataUrl,
          elapsedMs: Math.round(performance.now() - start),
          seed: req.seed,
        };
      },
    };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('could not read the generated image'));
    reader.readAsDataURL(blob);
  });
}

/** The app-wide singleton — the panel and the tool chain share it. */
export const agentLoader = new AgentLoader();

/** Convenience for the panel: is the resident kind in the slot? */
export function slotMatches(kind: ModelKind): boolean {
  return agentLoader.getSlot() === kind;
}

/** Re-export for the loop: the WebMCP surface, if any. */
export function webmcpSurface(): ModelContextSurface | null {
  const doc = (document as { modelContext?: ModelContextSurface }).modelContext;
  if (doc) return doc;
  return (navigator as { modelContext?: ModelContextSurface }).modelContext ?? null;
}
