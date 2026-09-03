/**
 * Source resolution + result placement shared by the `mediaforge-*` studio
 * tools (2026-09-03). Every image-producing op places its result as a NEW
 * element beside the source (x offset = width + 24) and never mutates the
 * source — the pending batch shows both, and approve-batch is the consent.
 */
import { getStudioStore } from '../../state/store';
import { effectiveDoc, type DesignDoc, type DesignElement } from '../../state/doc';
import { ToolError, argString } from './helpers';
import { makeThumbnail } from './thumbnail';

export const PLACE_GAP = 24;

export function currentDocOrThrow(): DesignDoc {
  const state = getStudioStore().getState();
  const doc = state.docs.find((d) => d.id === state.currentDocId) ?? null;
  if (!doc) throw new ToolError('no design exists — create one with create-design first');
  return doc;
}

/** The source element for an op: an explicit id or 'last-image' (the most
 * recently added image in the effective doc). Throws a ToolError naming
 * the fix when nothing matches. */
export function resolveSourceElement(target: string): DesignElement {
  const state = getStudioStore().getState();
  const doc = currentDocOrThrow();
  const eff = effectiveDoc(doc, state.pendingBatch);
  const el =
    target === 'last-image'
      ? [...eff.elements].reverse().find((e) => e.type === 'image' && e.src)
      : eff.elements.find((e) => e.id === target && e.type === 'image' && e.src);
  if (!el) {
    const which = target === 'last-image' ? '' : ` for '${target}'`;
    throw new ToolError(`no image element found${which} — generate an image first (generate-image or iris-generate)`);
  }
  return el;
}

/** Read + validate the `target` arg and resolve it. */
export function sourceFromArgs(args: Record<string, unknown>): DesignElement {
  return resolveSourceElement(argString(args, 'target', { required: true, maxLength: 200 })!);
}

/** Geometry beside a source element: same footprint, x offset by width + gap. */
export function besideGeometry(
  source: Pick<DesignElement, 'x' | 'y' | 'width' | 'height'>,
  size?: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(source.x + source.width + PLACE_GAP),
    y: Math.round(source.y),
    width: Math.round(size?.width ?? source.width),
    height: Math.round(size?.height ?? source.height),
  };
}

/** Add a NEW image element beside the source (never mutates the source). */
export async function placeImageBeside(source: DesignElement, dataUrl: string): Promise<string> {
  const id = getStudioStore().getState().addElement({
    type: 'image',
    src: dataUrl,
    thumbnail: (await makeThumbnail(dataUrl, 96).catch(() => null)) ?? undefined,
    ...besideGeometry(source),
    rotation: 0,
    opacity: 1,
  });
  if (!id) throw new ToolError('could not place the result in the design');
  return id;
}

/** Add a NEW image element at explicit geometry (storyboard rows). */
export async function placeImageAt(
  dataUrl: string,
  geometry: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const id = getStudioStore().getState().addElement({
    type: 'image',
    src: dataUrl,
    thumbnail: (await makeThumbnail(dataUrl, 96).catch(() => null)) ?? undefined,
    ...geometry,
    rotation: 0,
    opacity: 1,
  });
  if (!id) throw new ToolError('could not place the result in the design');
  return id;
}

/** Add a NEW video element (poster optional — the canvas captures one if it can). */
export function placeVideo(
  src: string,
  geometry: { x: number; y: number; width: number; height: number },
  poster: string | null,
): string {
  const id = getStudioStore().getState().addElement({
    type: 'video',
    src,
    poster: poster ?? undefined,
    ...geometry,
    rotation: 0,
    opacity: 1,
  });
  if (!id) throw new ToolError('could not place the video in the design');
  return id;
}
