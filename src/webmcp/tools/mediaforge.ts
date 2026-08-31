/**
 * mediaforge-remove-bg — cut the background out of an existing canvas image
 * (Media-Forge :8200, BiRefNet — verified live D-2227: 74/74 frames). As a
 * WebMCP tool (2026-08-31, the demo): the agent chains iris-generate (or
 * generate-image) → mediaforge-remove-bg → the transparent cutout REPLACES
 * the target element's src (an update op in the pending batch — UNCOMMITTED
 * until approve-batch). The canvas reloads the src (useFabricSync handles
 * src changes).
 *
 * The client contract is the MCP tool's payload shape ({image: <dataUrl>})
 * through the studio's relay; the relay (slice 2) adapts to the upstream's
 * exact route if it differs.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { argString, ToolError, currentBatchSummary } from './helpers';
import { withTimeout, withGenerationHeartbeat } from './image';
import { MEDIAFORGE_BASE, normalizeServiceImage } from './serviceBases';
import { makeThumbnail } from './thumbnail';
import { effectiveDoc } from '../../state/doc';

const REMOVE_BG_TIMEOUT_MS = 180_000;

/** Find the target image element: an explicit id (pending batch included) or
 * 'last-image' — the most recently added image in the effective doc. */
export function resolveImageTarget(
  target: string,
): { elementId: string; src: string } | { error: string } {
  const state = getStudioStore().getState();
  const doc = state.docs.find((d) => d.id === state.currentDocId) ?? null;
  if (!doc) return { error: 'no design exists — create one with create-design first' };
  const eff = effectiveDoc(doc, state.pendingBatch);
  let el = null;
  if (target === 'last-image') {
    el = [...eff.elements].reverse().find((e) => e.type === 'image' && e.src) ?? null;
  } else {
    el = eff.elements.find((e) => e.id === target && e.src) ?? null;
  }
  if (!el) return { error: `no image element found${target === 'last-image' ? '' : ` for '${target}'`} — generate an image first (generate-image or iris-generate)` };
  return { elementId: el.id, src: el.src as string };
}

export function extractRemoveBgImage(body: { success?: boolean; image?: unknown; dataUrl?: unknown; result?: { image?: unknown; dataUrl?: unknown } }): string | null {
  if (body?.success === false) return null;
  for (const candidate of [body?.result?.image, body?.result?.dataUrl, body?.image, body?.dataUrl]) {
    const url = normalizeServiceImage(candidate);
    if (url) return url;
  }
  return null;
}

export const mediaforgeRemoveBgTool: ToolDefinition = {
  name: 'mediaforge-remove-bg',
  title: 'Remove image background (Media-Forge BiRefNet)',
  description:
    'Cut the background out of an existing canvas image (BiRefNet, media-forge). The transparent cutout REPLACES the target element — an element id, or "last-image" for the most recently added image. UNCOMMITTED until approve-batch. Use it to turn a hero photo into a cutout on the design.',
  inputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'The element id to cut out, or "last-image" for the most recent image',
      },
    },
    required: ['target'],
  },
  available: () => true,
  async execute(args) {
    const target = argString(args, 'target', { required: true, maxLength: 200 })!;
    const found = resolveImageTarget(target);
    if ('error' in found) return fail(found.error);

    try {
      const body = (await withTimeout(REMOVE_BG_TIMEOUT_MS, 'background removal', () =>
        withGenerationHeartbeat('removing background (BiRefNet)', async () => {
          const res = await fetch(`${MEDIAFORGE_BASE}/op/remove_bg`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: found.src }),
          });
          if (!res.ok) {
            throw new ToolError(
              `media-forge HTTP ${res.status}${res.status === 404 ? ' — the media-forge relay is not configured on this origin yet' : ''}`,
            );
          }
          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.includes('image/')) {
            const blob = await res.blob();
            return { image: await blobToDataUrl(blob) };
          }
          return (await res.json()) as { success?: boolean; image?: unknown; dataUrl?: unknown; result?: { image?: unknown; dataUrl?: unknown } };
        }),
      )) as { success?: boolean; image?: unknown; dataUrl?: unknown; result?: { image?: unknown; dataUrl?: unknown } };

      const cutout = extractRemoveBgImage(body);
      if (!cutout) return fail('media-forge returned no cutout image');

      const state = getStudioStore().getState();
      const updated = state.updateElement(found.elementId, {
        src: cutout,
        thumbnail: (await makeThumbnail(cutout, 96).catch(() => null)) ?? undefined,
      });
      if (!updated) return fail(`could not update element ${found.elementId}`);
      return ok(
        JSON.stringify({
          elementId: found.elementId,
          device: 'mediaforge',
          batchSummary: currentBatchSummary(),
        }),
      );
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('could not read the cutout response'));
    reader.readAsDataURL(blob);
  });
}

export const MEDIAFORGE_TOOLS: ToolDefinition[] = [mediaforgeRemoveBgTool];
