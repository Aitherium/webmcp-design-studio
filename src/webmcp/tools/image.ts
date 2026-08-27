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
  available: (s) => Boolean(s.currentDocId) && s.docs.length > 0,
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
      const local = localImageGenerator;

      const runLocal = async (): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }> => {
        if (!local) {
          throw new ToolError(
            'on-device image generation is not available — the WebGPU runtime is not loaded in this session',
          );
        }
        const actualSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
        try {
          return await local.generate({
            prompt,
            width: dims.width,
            height: dims.height,
            seed: actualSeed,
            style,
          });
        } catch (err) {
          throw new ToolError(`local image generation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      const runHosted = async (): Promise<{ dataUrl: string; thumbnail?: string; elapsedMs: number; seed: number }> => {
        const config = loadProviderConfig();
        const url = providerBase(config);
        if (!url) {
          throw new ToolError(
            'no image backend is configured — pick one in the provider panel (Settings → Image backend): fleet (AitherBonsaiImage via the studio proxy) or custom (Sana/ComfyUI/SD URL). The on-device WebGPU runtime is not loaded in this session.',
          );
        }
        const actualSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
        return syncGenerateImage(
          url,
          { prompt, width: dims.width, height: dims.height, seed: actualSeed },
          { apiKey: config.apiKey, signal },
        );
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

      // Place the image element centered, fitted to the canvas.
      const canvas = doc.size;
      const fit = Math.min((canvas.width * 0.8) / dims.width, (canvas.height * 0.8) / dims.height, 1);
      const w = Math.round(dims.width * fit);
      const h = Math.round(dims.height * fit);
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
