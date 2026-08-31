/**
 * generate-image — the fallback chain:
 *   1. injected local runtime hook (WebGPU, provided by the agent layer in D3)
 *      → on-device, private, no server;
 *   2. else the provider panel's backend (Settings row): `fleet` = the studio's
 *      nginx proxy → AitherBonsaiImage /v1/generate (sync, one request);
 *      `custom` = any user-named base URL (Sana/ComfyUI/SD) with optional key;
 *   3. else fail with a LOUD error naming which link is missing.
 * `device: 'auto' | 'local' | 'cloud'` forces a tier. The image is placed in
 * the current design as an element — UNCOMMITTED until approve-batch.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import {
  FLEET_DEFAULT_BASE,
  loadProviderConfig,
  syncGenerateImage,
} from '../../cloud/imageProviders';
import { ToolError, argEnum, argNumber, argString, currentBatchSummary, snapshot } from './helpers';
import { makeThumbnail } from './thumbnail';

export const IMAGE_STYLES = ['photographic', 'illustration', 'poster-art', 'neon'] as const;
export const IMAGE_SIZES = ['square', 'wide', 'tall'] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const IMAGE_DIMENSIONS: Record<ImageSize, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  wide: { width: 1280, height: 768 },
  tall: { width: 768, height: 1280 },
};

/** The on-device runtime's per-axis cap (webml-image.esm.js: "sizes above
 * 1024px are not supported on-device" — measured live 2026-08-30, the
 * plan's 'tall' 768×1280 was rejected and the whole turn fell to hosted). */
export const ON_DEVICE_MAX_DIM = 1024;

/**
 * Scale dims to fit the on-device runtime's cap, preserving aspect. A
 * 768×1280 'tall' request becomes 614×1024; a 1024×1024 'square' passes
 * through unchanged. Never upscales (scale = min(1, …)).
 */
export function fitOnDeviceDims(dims: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, ON_DEVICE_MAX_DIM / Math.max(dims.width, dims.height));
  return {
    width: Math.max(64, Math.round(dims.width * scale)),
    height: Math.max(64, Math.round(dims.height * scale)),
  };
}

export interface LocalImageGenerator {
  generate(req: {
    prompt: string;
    width: number;
    height: number;
    seed: number;
    style?: ImageStyle;
  }): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }>;
}

/**
 * Injection point for the D3 on-device runtime. When set, the 'auto' tier
 * prefers it; the UI never touches this module directly.
 */
let localImageGenerator: LocalImageGenerator | null = null;
export function setLocalImageGenerator(gen: LocalImageGenerator | null): void {
  localImageGenerator = gen;
}
export function getLocalImageGenerator(): LocalImageGenerator | null {
  return localImageGenerator;
}

/**
 * Resolve the cloud base URL from the provider panel:
 *   fleet  → the studio's own nginx proxy (same-origin, no CORS)
 *   custom → the user-named base URL (required; a missing one is a loud error)
 *   on-device → no backend — the error names the panel as the fix.
 */
function providerBase(config: { id: string; baseUrl?: string }): string | null {
  if (config.id === 'fleet') return FLEET_DEFAULT_BASE;
  if (config.id === 'custom') {
    if (!config.baseUrl || config.baseUrl.trim() === '') return null;
    return config.baseUrl;
  }
  return null;
}

/**
 * The hosted-tier base URL for a provider config, incl. the D-2291 fleet
 * fallback (CORRECTED 2026-08-30 — see runHosted): a panel 'on-device' choice
 * falls through to the fleet lane whenever the hosted tier is reached, since
 * reaching it means local already failed or is absent. The original gate on
 * `!localImageGenerator` never fired: the loader plugs the generator at
 * construction on EVERY tier, so Tier B/C hit the loud "no image backend is
 * configured" while the fleet lane sat unused (measured live 08-30).
 */
export function resolveHostedBase(config: { id: string; baseUrl?: string }): string | null {
  const explicit = providerBase(config);
  if (explicit) return explicit;
  if (config.id === 'on-device') return FLEET_DEFAULT_BASE;
  return null;
}

/**
 * Live "it's alive" heartbeat during generation — the runtime emits NO
 * progress while the diffusion/VAE cooks (measured live 2026-08-30: the
 * panel showed nothing for minutes after generate-image; the only visible
 * progress was the VAE weight LOAD, not the generation). Ticks
 * agent.progressDetail every 2s so the person sees elapsed seconds and the
 * lane name; cleared when the generation settles either way.
 */
function withGenerationHeartbeat(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  const store = getStudioStore().getState();
  const t0 = Date.now();
  const id = window.setInterval(() => {
    store.setAgent({ progressDetail: `${label}… (${Math.round((Date.now() - t0) / 1000)}s)` });
  }, 2000);
  const done = () => {
    window.clearInterval(id);
    store.setAgent({ progressDetail: null });
  };
  return fn().then(
    (v) => {
      done();
      return v;
    },
    (err) => {
      done();
      throw err;
    },
  );
}

export const generateImageTool: ToolDefinition = {
  name: 'generate-image',
  title: 'Generate image',
  description:
    'Generate an image from a natural-language prompt — on-device (WebGPU, private, no server) when available, or the backend chosen in the provider panel (fleet or custom, e.g. Sana/ComfyUI/SD) otherwise. The image is placed in the current design as an element (UNCOMMITTED until approve-batch). style: photographic, illustration, poster-art, neon. size: square, wide, tall. device: auto, local, cloud.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Natural-language image prompt' },
      style: { type: 'string', enum: [...IMAGE_STYLES] },
      size: { type: 'string', enum: [...IMAGE_SIZES] },
      seed: { type: 'number', description: 'Reproducibility seed' },
      device: { type: 'string', enum: ['auto', 'local', 'cloud'], description: 'Which backend to use' },
    },
    required: ['prompt'],
  },
  // Measured live 2026-08-30: gating REGISTRATION on currentDocId filtered
  // generate-image OUT of the WebMCP surface on a fresh page — the "5 tools
  // live" list had no generate-image, so the agent could never call it no
  // matter how the flow proceeded (the D-2291 correction made a hosted
  // backend unconditionally reachable, so the tool ALWAYS has a working lane
  // once a design exists). The doc requirement is enforced at CALL time below
  // ("no design exists — create one with create-design first"), which is
  // where the agent can react to it; an absent tool is a dead end the agent
  // cannot see.
  available: () => true,
  async execute(args, { signal }) {
    const { doc } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    try {
      const prompt = argString(args, 'prompt', { required: true, maxLength: 2000 })!;
      const style = (argEnum(args, 'style', IMAGE_STYLES) ?? undefined) as ImageStyle | undefined;
      const size = (argEnum(args, 'size', IMAGE_SIZES) ?? 'square') as ImageSize;
      const seed = argNumber(args, 'seed', { integer: true, min: 0 });
      const device = (argEnum(args, 'device', ['auto', 'local', 'cloud']) ?? 'auto') as 'auto' | 'local' | 'cloud';

      const dims = IMAGE_DIMENSIONS[size];
      // BOTH lanes run at the runtime's native cap (≤1024px/axis): the
      // on-device runtime rejects larger sizes, and the hosted Sana sprint is
      // 1024-native (measured 08-30: tall 768×1280 through the tunnel 524'd
      // past Cloudflare's 100s edge). The element box uses these ACTUAL dims.
      const localDims = fitOnDeviceDims(dims);
      const local = localImageGenerator;

      const runLocal = async (): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }> => {
        if (!local) {
          throw new ToolError(
            'on-device image generation is not available — the WebGPU runtime is not loaded in this session',
          );
        }
        const actualSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
        try {
          return (await withGenerationHeartbeat('generating image on-device', () =>
            local.generate({
              prompt,
              // The on-device runtime caps at 1024px per axis (webml-image.esm.js:
              // "sizes above 1024px are not supported on-device" — measured live
              // 2026-08-30: the scripted plan's 'tall' 768×1280 was rejected and
              // the whole turn fell to hosted). fitOnDeviceDims scales to fit,
              // preserving the aspect; the element placement below uses the
              // ACTUAL generated dims so the canvas box is not stretched.
              width: localDims.width,
              height: localDims.height,
              seed: actualSeed,
              style,
            }),
          )) as { dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number };
        } catch (err) {
          throw new ToolError(`local image generation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      const runHosted = async (): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }> => {
        const config = loadProviderConfig();
        // D-2291 + CORRECTION 2026-08-30: the panel defaults to 'on-device',
        // but on a device where the local generator cannot RUN that default
        // must not be a dead end — the agent asked for 'auto', which means
        // "local when available, hosted otherwise". The ORIGINAL gate checked
        // `!localImageGenerator` — measured live 08-30, the loader plugs the
        // generator at CONSTRUCTION on every tier (it throws at use when the
        // tier can't run), so that gate NEVER fired and Tier B/C got the loud
        // "no image backend is configured" while the fleet lane sat unused.
        // Reaching runHosted at all means local already failed or is absent —
        // so a panel 'on-device' choice falls through to the fleet lane
        // unconditionally here. An explicit 'custom' with no URL is still a
        // loud error
        // (the user named a backend and did not configure it).
        const url = resolveHostedBase(config);
        if (!url) {
          throw new ToolError(
            'no image backend is configured — pick one in the provider panel (Settings → Image backend): fleet (AitherSana via the studio proxy) or custom (Sana/ComfyUI/SD URL). The on-device WebGPU runtime is not loaded in this session.',
          );
        }
        const actualSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
        // The hosted lane gets the SAME cap-scaled dims — measured live
        // 2026-08-30 (second verification): the plan's tall 768×1280 through
        // the tunnel returned **524 after 125s** (Cloudflare's 100s edge; the
        // Sana sprint model is 1024-native and the off-native size blew past
        // the window). 1024² is the model's native size and stays well under
        // the edge. The design stays tall; the canvas fit handles the aspect.
        const attempt = (): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }> =>
          withGenerationHeartbeat('generating image on the fleet', () =>
            syncGenerateImage(
              url,
              { prompt, width: localDims.width, height: localDims.height, seed: actualSeed },
              { apiKey: config.apiKey, signal },
            ),
          ) as Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }>;
        try {
          return await attempt();
        } catch (err) {
          // One retry on a NETWORK-type failure, never on an HTTP error
          // response (syncGenerateImage throws "…: HTTP <status>" for
          // non-ok responses; network failures carry the fetch error instead).
          // Measured live 2026-08-30: the aither-create AutoUpdate swap
          // (13:20) left a seconds-long tunnel re-establishment window and
          // the owner's fallback died with "Failed to fetch" — a transient
          // that one retry absorbs.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/HTTP \d{3}/.test(msg) && /failed at POST|failed fetching|response was not JSON/i.test(msg)) {
            await new Promise((r) => setTimeout(r, 1500));
            return await attempt();
          }
          throw err;
        }
      };

      // The chain: local → hosted → loud failure.
      let result: { dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number };
      let usedDevice: 'local' | 'cloud';
      if (device === 'local') {
        result = await runLocal();
        usedDevice = 'local';
      } else if (device === 'cloud') {
        result = await runHosted();
        usedDevice = 'cloud';
      } else if (local) {
        try {
          result = await runLocal();
          usedDevice = 'local';
          } catch (localErr) {
          // Fall through to the hosted tier with a note.
          try {
            result = await runHosted();
            usedDevice = 'cloud';
          } catch (hostedErr) {
            throw new ToolError(
              `${localErr instanceof Error ? localErr.message : String(localErr)}; hosted fallback also failed: ${
                hostedErr instanceof Error ? hostedErr.message : String(hostedErr)
              }`,
            );
          }
        }
      } else {
        result = await runHosted();
        usedDevice = 'cloud';
      }

      // Place the image element centered, fitted to the canvas — using the
      // ACTUAL generated dims (localDims for the local lane), so a clamped
      // on-device image is not stretched into the requested box.
      const canvas = doc.size;
      const fit = Math.min((canvas.width * 0.8) / localDims.width, (canvas.height * 0.8) / localDims.height, 1);
      const w = Math.round(localDims.width * fit);
      const h = Math.round(localDims.height * fit);
      const store = getStudioStore().getState();
      const elementId = store.addElement({
        type: 'image',
        src: result.dataUrl,
        thumbnail: result.thumbnail ?? (await makeThumbnail(result.dataUrl, 96)) ?? undefined,
        seed: result.seed,
        x: Math.round((canvas.width - w) / 2),
        y: Math.round((canvas.height - h) / 2),
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
      });
      if (!elementId) return fail('could not place the generated image in the design');
      return ok(
        JSON.stringify({
          elementId,
          device: usedDevice,
          elapsedMs: result.elapsedMs,
          seed: result.seed,
          thumbnail: result.thumbnail ?? null,
          batchSummary: currentBatchSummary(),
        }),
      );
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const IMAGE_TOOLS: ToolDefinition[] = [generateImageTool];
