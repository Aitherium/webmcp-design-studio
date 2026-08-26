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

/* ── configuration ────────────────────────────────────────────────────────── */

const CDN = 'https://weights.aitherium.com';
/** Text runtime bundle (dynamic import; exports createBonsaiChatWorker + runWebMLWorker). */
export const WEBML_RUNTIME_URL =
  import.meta.env.VITE_WEBML_RUNTIME_URL ?? `${CDN}/webml-text.esm.js`;
/** Image runtime bundle (dynamic import; exports createBonsaiImageRuntime). */
export const WEBML_IMAGE_URL =
  import.meta.env.VITE_WEBML_IMAGE_URL ?? `${CDN}/webml-image.esm.js`;
/** Same-origin module-worker entry that imports the CDN bundle and runs it. */
export const BONSAI_WORKER_ENTRY_URL =
  import.meta.env.VITE_BONSAI_WORKER_ENTRY_URL ?? '/workers/bonsai-worker-entry.js';
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
 * always wins. Errs small (1.7B on weak links / low memory, 4B default).
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
  if (mem >= 8) return 'bonsai-8b';
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
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
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
    rangeOk = await range206(RANGE_PROBE_URL, opts?.fetchImpl);
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

export class AgentLoader {
  private verdict: TierVerdict | null = null;
  private consentGiven = false;
  private slot: ModelKind | null = null;
  private chatWorker: ChatWorkerLike | null = null;
  private imageRuntime: ImageRuntimeLike | null = null;
  /** A kind that failed to load is disabled for the session (gating contract). */
  private sessionDisabled = new Set<ModelKind>();
  private mutex: Promise<void> = Promise.resolve();
  private listeners = new Set<(e: LoaderEvent) => void>();
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

  /** The consent chip — the ONLY thing that may move the loader out of idle. */
  setConsent(given: boolean): void {
    this.consentGiven = given;
    this.emit({ type: 'consent' });
  }

  getSlot(): ModelKind | null {
    return this.slot;
  }

  getChatWorker(): ChatWorkerLike | null {
    return this.chatWorker;
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
        `on-device ${kind} is disabled for this session (a previous load failed) — the hosted tier is being used instead`,
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
        'on-device agent unavailable on this device (Tier C) — use ChatGPT/Chrome or the hosted tier',
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

    try {
      const mod = this.runtimeModules?.text ?? ((await import(/* @vite-ignore */ WEBML_RUNTIME_URL)) as WebMLRuntimeModule);
      const worker = mod.createBonsaiChatWorker({ entryUrl: this.entryUrl });
      this.chatWorker = worker;

      const ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err: Error | null) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        worker.on((msg) => {
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

    try {
      const mod = this.runtimeModules?.image ?? ((await import(/* @vite-ignore */ WEBML_IMAGE_URL)) as WebMLRuntimeModule);
      const rt = await mod.createBonsaiImageRuntime({
        weightsUrl: IMAGE_WEIGHTS_URL,
        vaeWeightsUrl: VAE_WEIGHTS_URL,
        onProgress: (p) =>
          this.emit({ type: 'progress', kind: 'image', progress: p.percent, detail: p.detail }),
      });
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
