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
import { MEDIAFORGE_BASE } from './serviceBases';
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

/** Convert a data URL to a multipart FormData file — the /api/upload
 * contract (field name `file`, measured live 2026-08-31). */
async function dataUrlToFormData(dataUrl: string): Promise<FormData> {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), 'cutout-source.png');
  return fd;
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
      const cutout = (await withTimeout(REMOVE_BG_TIMEOUT_MS, 'background removal', () =>
        withGenerationHeartbeat('removing background (BiRefNet)', async () => {
          // The real contract (measured live 2026-08-31 against media-forge's
          // OpenAPI): THREE hops — upload the image (multipart → {id}), run
          // remove_bg on the id ({media_id} → {image: "/media/x.png"}), then
          // fetch the cutout bytes. The first version posted {image: dataUrl}
          // to /op/remove_bg — the route's answer was "no gallery image for
          // media_id=<the dataUrl>": wrong path, wrong payload, wrong field.
          const uploadRes = await fetch(`${MEDIAFORGE_BASE}/api/upload`, {
            method: 'POST',
            body: await dataUrlToFormData(found.src),
          });
          if (!uploadRes.ok) {
            throw new ToolError(
              `media-forge upload HTTP ${uploadRes.status}${uploadRes.status === 404 ? ' — the media-forge relay is not configured on this origin yet' : ''}`,
            );
          }
          const uploaded = (await uploadRes.json()) as { ok?: boolean; id?: number };
          if (!uploaded.ok || typeof uploaded.id !== 'number') {
            throw new ToolError('media-forge upload returned no media id');
          }
          const bgRes = await fetch(`${MEDIAFORGE_BASE}/api/studio/remove_bg`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_id: uploaded.id }),
          });
          if (!bgRes.ok) {
            throw new ToolError(`media-forge remove_bg HTTP ${bgRes.status}`);
          }
          const bg = (await bgRes.json()) as { ok?: boolean; image?: unknown };
          const cutoutPath = typeof bg.image === 'string' && bg.image.startsWith('/') ? bg.image : null;
          if (!bg.ok || !cutoutPath) {
            throw new ToolError('media-forge remove_bg returned no cutout');
          }
          const imgRes = await fetch(`${MEDIAFORGE_BASE}${cutoutPath}`);
          if (!imgRes.ok) throw new ToolError(`media-forge cutout fetch HTTP ${imgRes.status}`);
          return await blobToDataUrl(await imgRes.blob());
        }),
      )) as string;

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
