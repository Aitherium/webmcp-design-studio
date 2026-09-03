/**
 * The Media-Forge STUDIO tools (2026-09-03) — ComfyUI pipelines behind
 * media-forge, driven from the canvas: upscale / enhance / restyle /
 * relight / outpaint produce a NEW image beside the source; critique reads
 * an image and answers text; storyboard plans shots and renders each one
 * into a row. Every one runs on the FLEET (never on-device) and every
 * synchronous hop stays under Cloudflare's 100 s edge cut — anything
 * longer (animate) lives in mediaforgeJobs.ts on the async job plane.
 *
 * Field names below are the routes' own (media-forge OpenAPI, read
 * 2026-09-03): `media_id`, `target_scale`, `style_id`, `structure_strength`,
 * `light_prompt`, `background_id`, `left/right/top/bottom`, `focus`,
 * `concept/shots/style/fps`.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { ToolError, argBool, argEnum, argNumber, argString, currentBatchSummary } from './helpers';
import { withGenerationHeartbeat, withTimeout } from './image';
import { fetchMediaAsDataUrl, getJson, imagePaths, okOrThrow, postStudio, uploadSource } from './mediaforgeClient';
import {
  PLACE_GAP,
  currentDocOrThrow,
  placeImageAt,
  placeImageBeside,
  resolveSourceElement,
  sourceFromArgs,
} from './mediaforgePlace';
import type { DesignElement } from '../../state/doc';

/** One synchronous studio hop must finish inside Cloudflare's 100 s cut. */
const SYNC_OP_TIMEOUT_MS = 95_000;
const STYLE_FETCH_TIMEOUT_MS = 15_000;
const MAX_STORYBOARD_SHOTS = 6;

const FLEET_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

const TARGET_PROP = {
  type: 'string',
  description: 'Source image element id, or "last-image" for the most recent image',
} as const;

type StudioImageAnswer = { ok?: boolean; error?: unknown; image?: unknown; images?: unknown };

/* ── catalogs read at call time ──────────────────────────────────────────── */

/** Generation styles (`/api/studio/status`.styles) — the `style` field of
 * txt2img / outpaint / storyboard. */
export async function fetchGenerationStyles(): Promise<string[]> {
  const body = await getJson<{ styles?: unknown }>('api/studio/status', 'status');
  return Array.isArray(body.styles) ? body.styles.filter((s): s is string => typeof s === 'string') : [];
}

/** Restyle presets (`/api/studio/styles`.groups → ids) — the `style_id`
 * field of restyle. This is a DIFFERENT catalog from the generation styles:
 * the route validates `style_id` against the preset catalog, so a
 * generation style name ("anime") is refused there as unknown. */
export async function fetchRestylePresets(): Promise<string[]> {
  const body = await getJson<{ groups?: Record<string, Array<{ id?: unknown }>> }>('api/studio/styles', 'styles');
  const ids: string[] = [];
  for (const group of Object.values(body.groups ?? {})) {
    for (const p of group) if (typeof p.id === 'string') ids.push(p.id);
  }
  return ids;
}

function requireInCatalog(key: string, value: string, catalog: string[], what: string): void {
  if (catalog.length === 0) throw new ToolError(`media-forge reported no ${what} — the service is not ready`);
  if (!catalog.includes(value)) {
    throw new ToolError(`"${key}" '${value}' is not a media-forge ${what.replace(/s$/, '')} — use one of: ${catalog.join(', ')}`);
  }
}

async function validatedStyle(args: Record<string, unknown>, fallback: string): Promise<string> {
  const style = argString(args, 'style', { maxLength: 60 }) ?? fallback;
  const catalog = await withTimeout(STYLE_FETCH_TIMEOUT_MS, 'style catalog', fetchGenerationStyles);
  requireInCatalog('style', style, catalog, 'generation styles');
  return style;
}

/* ── the shared image op ─────────────────────────────────────────────────── */

interface ImageOp {
  route: string;
  label: string;
  /** The request body for the uploaded source; may upload more (relight fbc). */
  body: (mediaId: number) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** upload → POST route → fetch the first output → place beside the source. */
async function runImageOp(source: DesignElement, op: ImageOp): Promise<string> {
  const dataUrl = (await withTimeout(SYNC_OP_TIMEOUT_MS, op.label, () =>
    withGenerationHeartbeat(`${op.label} on the fleet`, async () => {
      const mediaId = await uploadSource(source.src as string);
      const answer = okOrThrow(await postStudio<StudioImageAnswer>(op.route, await op.body(mediaId)), op.route);
      const [first] = imagePaths(answer);
      if (!first) throw new ToolError(`media-forge ${op.route} returned no image`);
      return fetchMediaAsDataUrl(first, op.route);
    }),
  )) as string;
  return placeImageBeside(source, dataUrl);
}

function resultJson(source: DesignElement, elementId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sourceElementId: source.id,
    elementId,
    device: 'mediaforge',
    ...extra,
    batchSummary: currentBatchSummary(),
  });
}

function failFrom(err: unknown) {
  return fail(err instanceof Error ? err.message : String(err));
}

/* ── upscale ─────────────────────────────────────────────────────────────── */

export const mediaforgeUpscaleTool: ToolDefinition = {
  name: 'mediaforge-upscale',
  title: 'Upscale image (fleet)',
  description:
    'Upscale a canvas image with an ESRGAN model on the fleet (media-forge, not on-device). Places the result as a NEW element beside the source (same canvas footprint, more pixels); the source is untouched. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      scale: { type: 'number', description: 'Target scale 1–4 (default 2)' },
      model: { type: 'string', description: 'Upscale model file (default 4x-UltraSharp.pth)' },
    },
    required: ['target'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const scale = argNumber(args, 'scale', { min: 1, max: 4 }) ?? 2;
      const model = argString(args, 'model', { maxLength: 120 }) ?? '4x-UltraSharp.pth';
      const id = await runImageOp(source, {
        route: 'upscale',
        label: 'upscaling',
        body: (media_id) => ({ media_id, model, target_scale: scale }),
      });
      return ok(resultJson(source, id, { scale, model }));
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── enhance ─────────────────────────────────────────────────────────────── */

export const mediaforgeEnhanceTool: ToolDefinition = {
  name: 'mediaforge-enhance',
  title: 'Enhance image detail (fleet)',
  description:
    'Quality pass on a canvas image on the fleet (media-forge, not on-device): detail-inject upscale, optional face detail and hand repair. Places the result as a NEW element beside the source. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      detail: { type: 'boolean', description: 'Detail-inject upscale (default true)' },
      face: { type: 'boolean', description: 'Face detail pass (default false)' },
      hands: { type: 'boolean', description: 'Hand repair pass (default false)' },
      scale: { type: 'number', description: 'Upscale factor 1–4 (default 2)' },
      denoise: { type: 'number', description: 'Detail strength 0–1 (default 0.22)' },
    },
    required: ['target'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const body = {
        detail: argBool(args, 'detail') ?? true,
        face: argBool(args, 'face') ?? false,
        hands: argBool(args, 'hands') ?? false,
        scale: argNumber(args, 'scale', { min: 1, max: 4 }) ?? 2,
        denoise: argNumber(args, 'denoise', { min: 0, max: 1 }) ?? 0.22,
      };
      if (!body.detail && !body.face && !body.hands) {
        return fail('nothing to do — enable at least one of detail, face, hands');
      }
      const id = await runImageOp(source, {
        route: 'enhance',
        label: 'enhancing',
        body: (media_id) => ({ media_id, ...body, preserve_face: true }),
      });
      return ok(resultJson(source, id, body));
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── restyle ─────────────────────────────────────────────────────────────── */

export const mediaforgeRestyleTool: ToolDefinition = {
  name: 'mediaforge-restyle',
  title: 'Restyle image (fleet)',
  description:
    'Restyle a canvas image into a media-forge style preset while holding its composition (structure-locked img2img on the fleet, not on-device). style_id is validated against the live preset catalog — a bad id lists the valid ones. Places the result as a NEW element beside the source. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      style_id: { type: 'string', description: 'Preset id from the media-forge style catalog' },
      strength: { type: 'number', description: 'img2img denoise 0–1 (default: the preset default)' },
      structure_strength: { type: 'number', description: 'How hard to pin the source layout 0–1 (default 0.6)' },
    },
    required: ['target', 'style_id'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const styleId = argString(args, 'style_id', { required: true, maxLength: 80 })!;
      const strength = argNumber(args, 'strength', { min: 0, max: 1 });
      const structure = argNumber(args, 'structure_strength', { min: 0, max: 1 }) ?? 0.6;
      const presets = await withTimeout(STYLE_FETCH_TIMEOUT_MS, 'style catalog', fetchRestylePresets);
      requireInCatalog('style_id', styleId, presets, 'style presets');
      const id = await runImageOp(source, {
        route: 'restyle',
        label: `restyling (${styleId})`,
        body: (media_id) => ({ media_id, style_id: styleId, strength: strength ?? null, structure_strength: structure, count: 1 }),
      });
      return ok(resultJson(source, id, { style_id: styleId }));
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── relight ─────────────────────────────────────────────────────────────── */

export const RELIGHT_MODES = ['fc', 'fbc'] as const;

export const mediaforgeRelightTool: ToolDefinition = {
  name: 'mediaforge-relight',
  title: 'Relight image (fleet)',
  description:
    'Relight a canvas image with IC-Light on the fleet (media-forge, not on-device): mode fc harmonises the subject to a described light (light_prompt); mode fbc harmonises it onto a background image element (background). Places the result as a NEW element beside the source. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      light_prompt: { type: 'string', description: 'The light to apply, e.g. "warm sunset from the left"' },
      mode: { type: 'string', enum: [...RELIGHT_MODES], description: 'fc = described light (default); fbc = background plate' },
      background: { type: 'string', description: 'Background image element id (required for fbc)' },
      seed: { type: 'number', description: 'Reproducibility seed' },
    },
    required: ['target', 'light_prompt'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const lightPrompt = argString(args, 'light_prompt', { required: true, maxLength: 500 })!;
      const mode = (argEnum(args, 'mode', RELIGHT_MODES) ?? 'fc') as (typeof RELIGHT_MODES)[number];
      const seed = argNumber(args, 'seed', { integer: true });
      const backgroundArg = argString(args, 'background', { maxLength: 200 });
      if (mode === 'fbc' && !backgroundArg) return fail('mode "fbc" needs "background" — the id of the background image element');
      const background = mode === 'fbc' ? resolveSourceElement(backgroundArg!) : null;
      const id = await runImageOp(source, {
        route: 'relight',
        label: 'relighting',
        body: async (media_id) => ({
          media_id,
          mode,
          light_prompt: lightPrompt,
          seed: seed ?? null,
          background_id: background ? await uploadSource(background.src as string) : null,
        }),
      });
      return ok(resultJson(source, id, { mode, light_prompt: lightPrompt }));
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── outpaint ────────────────────────────────────────────────────────────── */

const OUTPAINT_SIDES = ['left', 'right', 'top', 'bottom'] as const;

export const mediaforgeOutpaintTool: ToolDefinition = {
  name: 'mediaforge-outpaint',
  title: 'Outpaint image (fleet)',
  description:
    'Extend a canvas image beyond its edges on the fleet (media-forge, not on-device): pixels to add on left/right/top/bottom (at least one > 0) and a prompt for what appears there. Places the result as a NEW element beside the source. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      prompt: { type: 'string', description: 'What fills the new area' },
      left: { type: 'number', description: 'Pixels to add on the left (default 0)' },
      right: { type: 'number', description: 'Pixels to add on the right (default 0)' },
      top: { type: 'number', description: 'Pixels to add on top (default 0)' },
      bottom: { type: 'number', description: 'Pixels to add on the bottom (default 0)' },
      style: { type: 'string', description: 'Generation style (default anime; validated live)' },
    },
    required: ['target'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const prompt = argString(args, 'prompt', { maxLength: 1000 }) ?? '';
      const sides: Record<string, number> = {};
      for (const side of OUTPAINT_SIDES) sides[side] = argNumber(args, side, { min: 0, max: 2048, integer: true }) ?? 0;
      if (Object.values(sides).every((v) => v === 0)) return fail('provide at least one of left/right/top/bottom > 0');
      const style = await validatedStyle(args, 'anime');
      const id = await runImageOp(source, {
        route: 'outpaint',
        label: 'outpainting',
        body: (media_id) => ({ media_id, prompt, ...sides, style }),
      });
      return ok(resultJson(source, id, { ...sides, style }));
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── critique (read-only) ────────────────────────────────────────────────── */

export const CRITIQUE_FOCUS = ['general', 'anatomy', 'artifacts', 'seams'] as const;

interface CritiqueAnswer {
  ok?: boolean;
  error?: unknown;
  score?: unknown;
  summary?: unknown;
  issues?: unknown;
}

export const mediaforgeCritiqueTool: ToolDefinition = {
  name: 'mediaforge-critique',
  title: 'Critique image (fleet VLM)',
  description:
    'Ask the fleet vision critic (media-forge, not on-device) to review a canvas image: returns a score, a summary and a list of issues (label, severity, box). Read-only — nothing is placed or changed.',
  inputSchema: {
    type: 'object',
    properties: {
      target: TARGET_PROP,
      focus: { type: 'string', enum: [...CRITIQUE_FOCUS], description: 'What to look at (default general)' },
    },
    required: ['target'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const focus = (argEnum(args, 'focus', CRITIQUE_FOCUS) ?? 'general') as (typeof CRITIQUE_FOCUS)[number];
      const answer = (await withTimeout(SYNC_OP_TIMEOUT_MS, 'critique', async () => {
        const mediaId = await uploadSource(source.src as string);
        return okOrThrow(await postStudio<CritiqueAnswer>('critique', { media_id: mediaId, focus }), 'critique');
      })) as CritiqueAnswer;
      return ok(
        JSON.stringify({
          sourceElementId: source.id,
          focus,
          score: typeof answer.score === 'number' ? answer.score : null,
          summary: typeof answer.summary === 'string' ? answer.summary : '',
          issues: Array.isArray(answer.issues) ? answer.issues : [],
          device: 'mediaforge',
        }),
      );
    } catch (err) {
      return failFrom(err);
    }
  },
};

/* ── storyboard ──────────────────────────────────────────────────────────── */

export interface StoryboardScene {
  name: string;
  prompt: string;
  motion?: string;
  duration?: number;
  transition?: string;
}

interface StoryboardAnswer {
  ok?: boolean;
  error?: unknown;
  title?: unknown;
  scenes?: unknown;
}

function parseScenes(body: StoryboardAnswer): StoryboardScene[] {
  if (!Array.isArray(body.scenes)) return [];
  const out: StoryboardScene[] = [];
  for (const raw of body.scenes) {
    const s = raw as Record<string, unknown>;
    if (typeof s.prompt !== 'string' || !s.prompt) continue;
    out.push({
      name: typeof s.name === 'string' ? s.name : `shot ${out.length + 1}`,
      prompt: s.prompt,
      motion: typeof s.motion === 'string' ? s.motion : undefined,
      duration: typeof s.duration === 'number' ? s.duration : undefined,
      transition: typeof s.transition === 'string' ? s.transition : undefined,
    });
  }
  return out;
}

/** Row geometry for N shots across the design width: equal cells, 3:2. */
export function storyboardRow(docWidth: number, count: number, y = PLACE_GAP): Array<{ x: number; y: number; width: number; height: number }> {
  const width = Math.max(64, Math.floor((docWidth - PLACE_GAP * (count + 1)) / count));
  const height = Math.round((width * 2) / 3);
  return Array.from({ length: count }, (_, i) => ({ x: PLACE_GAP + i * (width + PLACE_GAP), y, width, height }));
}

async function renderShot(scene: StoryboardScene, style: string): Promise<string> {
  const answer = okOrThrow(
    await postStudio<StudioImageAnswer>('txt2img', { prompt: scene.prompt, style, count: 1, width: 768, height: 512, preset: 'fast' }),
    'txt2img',
  );
  const [first] = imagePaths(answer);
  if (!first) throw new ToolError(`media-forge txt2img returned no image for "${scene.name}"`);
  return fetchMediaAsDataUrl(first, 'txt2img');
}

export const mediaforgeStoryboardTool: ToolDefinition = {
  name: 'mediaforge-storyboard',
  title: 'Storyboard a concept (fleet)',
  description:
    'Plan a concept into an ordered shot list on the fleet (media-forge planner, not on-device) and render each shot as an image, placed in a ROW of new elements across the design. shots 1–6 (default 4). render:false returns the plan only. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'The concept or logline to board' },
      shots: { type: 'number', description: 'Number of shots 1–6 (default 4)' },
      style: { type: 'string', description: 'Generation style (default anime; validated live)' },
      render: { type: 'boolean', description: 'Render each shot into the design (default true)' },
    },
    required: ['concept'],
  },
  annotations: { ...FLEET_ANNOTATIONS },
  available: () => true,
  async execute(args) {
    try {
      const doc = currentDocOrThrow();
      const concept = argString(args, 'concept', { required: true, maxLength: 1000 })!;
      const shots = argNumber(args, 'shots', { min: 1, max: MAX_STORYBOARD_SHOTS, integer: true }) ?? 4;
      const render = argBool(args, 'render') ?? true;
      const style = await validatedStyle(args, 'anime');
      const plan = (await withTimeout(SYNC_OP_TIMEOUT_MS, 'storyboard plan', () =>
        postStudio<StoryboardAnswer>('storyboard', { concept, shots, style, fps: 8 }),
      )) as StoryboardAnswer;
      const scenes = parseScenes(okOrThrow(plan, 'storyboard'));
      if (scenes.length === 0) return fail('media-forge storyboard returned no scenes — try a more concrete concept');
      const title = typeof plan.title === 'string' ? plan.title : concept.slice(0, 60);
      if (!render) return ok(JSON.stringify({ title, scenes, rendered: [], device: 'mediaforge' }));

      const cells = storyboardRow(doc.size.width, scenes.length);
      const rendered: Array<{ shot: string; elementId: string }> = [];
      const failed: Array<{ shot: string; error: string }> = [];
      for (const [i, scene] of scenes.entries()) {
        try {
          const dataUrl = (await withTimeout(SYNC_OP_TIMEOUT_MS, `shot ${i + 1}`, () =>
            withGenerationHeartbeat(`rendering shot ${i + 1}/${scenes.length} on the fleet`, () => renderShot(scene, style)),
          )) as string;
          rendered.push({ shot: scene.name, elementId: await placeImageAt(dataUrl, cells[i]) });
        } catch (err) {
          failed.push({ shot: scene.name, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (rendered.length === 0) return fail(`every shot failed to render: ${failed.map((f) => f.error).join('; ')}`);
      return ok(JSON.stringify({ title, scenes, rendered, failed, device: 'mediaforge', batchSummary: currentBatchSummary() }));
    } catch (err) {
      return failFrom(err);
    }
  },
};

export const MEDIAFORGE_STUDIO_TOOLS: ToolDefinition[] = [
  mediaforgeUpscaleTool,
  mediaforgeEnhanceTool,
  mediaforgeRestyleTool,
  mediaforgeRelightTool,
  mediaforgeOutpaintTool,
  mediaforgeCritiqueTool,
  mediaforgeStoryboardTool,
];
