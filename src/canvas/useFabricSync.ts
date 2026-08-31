/**
 * Fabric canvas ⇄ store sync.
 *
 * Direction 1 (store → canvas): every store change re-syncs the object
 * graph — elements become fabric objects, removed elements are dropped,
 * z-index is reapplied. Changes are applied under an `applying` guard so
 * fabric's own events cannot echo back into the store (infinite loop).
 *
 * Direction 2 (canvas → store): human edits (move/scale/rotate, text
 * changes, opacity) become pending patches through `updateElement` — the
 * same batch model the agent's tools use. Nothing a human does touches the
 * committed doc until approve.
 *
 * `toDataURL` powers export-design through the exporter hook.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { Canvas, FabricImage, Gradient, Rect, Textbox, type FabricObject, type IText } from 'fabric';
import { getStudioStore } from '../state/store';
import { DESIGN_PALETTES } from '../brand/tokens';
import { effectiveDoc, FONT_FAMILY_CSS, type DesignDoc, type DesignElement } from '../state/doc';
import { setCanvasExporter, type ExportRequest, type ExportResult } from './exporter';

function findElementId(objects: ReadonlyMap<string, FabricObject>, target: FabricObject): string | null {
  for (const [id, obj] of objects) {
    if (obj === target) return id;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveBackground(doc: DesignDoc) {
  const palette = DESIGN_PALETTES[doc.palette];
  if (doc.background === 'gradient') {
    return new Gradient<'linear', 'linear'>({
      type: 'linear',
      coords: { x1: 0, y1: 0, x2: doc.size.width, y2: doc.size.height },
      colorStops: [
        { offset: 0, color: palette.gradient[0] },
        { offset: 1, color: palette.gradient[1] },
      ],
    });
  }
  return doc.background;
}

async function createFabricObject(el: DesignElement): Promise<FabricObject> {
  if (el.type === 'text') {
    return new Textbox(el.text ?? '', {
      left: el.x,
      top: el.y,
      width: el.width,
      fontSize: el.fontSize ?? 48,
      fontFamily: FONT_FAMILY_CSS[el.fontFamily ?? 'sans'],
      fontWeight: el.fontWeight ?? 'normal',
      fontStyle: el.fontStyle ?? 'normal',
      fill: el.fill ?? '#EEEEEE',
      textAlign: el.align ?? 'left',
      angle: el.rotation,
      opacity: el.opacity,
    });
  }
  if (el.type === 'image' && el.src) {
    const img = await FabricImage.fromURL(el.src);
    img.set({ left: el.x, top: el.y, angle: el.rotation, opacity: el.opacity });
    img.set({ scaleX: el.width / img.width, scaleY: el.height / img.height });
    return img;
  }
  return new Rect({
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    fill: el.fill ?? '#2AD7D7',
    angle: el.rotation,
    opacity: el.opacity,
  });
}

function applyProps(obj: FabricObject, el: DesignElement, applying: { current: boolean }): void {
  applying.current = true;
  try {
    obj.set({ left: el.x, top: el.y, angle: el.rotation, opacity: el.opacity });
    if (obj instanceof Textbox) {
      obj.set({
        text: el.text ?? '',
        fontSize: el.fontSize ?? 48,
        fontFamily: FONT_FAMILY_CSS[el.fontFamily ?? 'sans'],
        fontWeight: el.fontWeight ?? 'normal',
        fontStyle: el.fontStyle ?? 'normal',
        fill: typeof el.fill === 'string' ? el.fill : '#EEEEEE',
        textAlign: el.align ?? 'left',
        width: Math.max(el.width, 10),
        scaleX: 1,
        scaleY: 1,
      });
    } else if (obj instanceof Rect) {
      obj.set({
        width: el.width,
        height: el.height,
        fill: typeof el.fill === 'string' ? el.fill : '#2AD7D7',
        scaleX: 1,
        scaleY: 1,
      });
    } else if (obj instanceof FabricImage) {
      const currentSrc = obj.getSrc() as string;
      if (el.src && el.src !== currentSrc) {
        // A tool REPLACED the element's src (mediaforge-remove-bg cutout,
        // 2026-08-31): fabric must reload the image — setSrc is async, and
        // the scale must be recomputed against the NEW natural size once the
        // image lands, or the cutout renders at the old image's scale.
        obj.setSrc(el.src, () => {
          obj.set({
            scaleX: el.width / Math.max(obj.width, 1),
            scaleY: el.height / Math.max(obj.height, 1),
          });
          obj.setCoords();
          canvas.requestRenderAll();
        });
      } else {
        obj.set({ scaleX: el.width / Math.max(obj.width, 1), scaleY: el.height / Math.max(obj.height, 1) });
      }
    }
    obj.setCoords();
  } finally {
    applying.current = false;
  }
}

export function useFabricSync(canvasElRef: RefObject<HTMLCanvasElement | null>): void {
  const canvasRef = useRef<Canvas | null>(null);
  const applyingRef = useRef(false);
  const docIdRef = useRef<string | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    const canvas = new Canvas(el, { enableRetinaScaling: false });
    // Owned by this effect: sync, handlers and cleanup all close over it.
    const objects = new Map<string, FabricObject>();
    canvasRef.current = canvas;
    disposedRef.current = false;

    // The sync body is async (FabricImage.fromURL awaits the image decode) and
    // the store subscribes fire on EVERY change — the token stream during a
    // generation fires them constantly. Without serialization, two passes
    // could interleave on a new image element: both see it missing from
    // `objects`, both create a FabricImage, and the map overwrite leaves one
    // object orphaned on the canvas at the wrong z-order (measured live
    // 2026-08-30 while chasing "still no image": the element existed in the
    // pending batch and the src decoded fine — the render path is where an
    // interleaved pass could visibly misplace it). The queue makes passes
    // strictly sequential: the second pass sees the object the first created.
    let syncQueue: Promise<void> = Promise.resolve();
    const sync = (): Promise<void> => {
      syncQueue = syncQueue.then(async () => {
        try {
        if (disposedRef.current) return;
      const state = getStudioStore().getState();
      const doc = state.docs.find((d) => d.id === state.currentDocId) ?? null;
      const eff = doc ? effectiveDoc(doc, state.pendingBatch) : null;

      // Canvas size + background only when the design (or its size) changed.
      if (docIdRef.current !== (doc?.id ?? null)) {
        docIdRef.current = doc?.id ?? null;
        // A fresh session has no doc — a 0x0 canvas renders literally
        // NOTHING (measured live 2026-08-30, the "I SEE NOTHING" report).
        // Default to a standard poster frame so the canvas + the empty
        // hint are visible until the agent creates the design.
        const w = eff?.size.width ?? 1080;
        const h = eff?.size.height ?? 1440;
        canvas.setDimensions({ width: w, height: h });
        canvas.backgroundColor = eff ? resolveBackground(eff) : '#000103';
        canvas.requestRenderAll();
      } else if (eff && (eff.background !== doc?.background || eff.palette !== doc?.palette)) {
        canvas.backgroundColor = resolveBackground(eff);
        canvas.requestRenderAll();
      }

      // Objects: add missing, update existing, drop stale.
      const wanted = new Set<string>();
      for (const el of eff?.elements ?? []) {
        wanted.add(el.id);
        const obj = objects.get(el.id);
        if (obj) {
          applyProps(obj, el, applyingRef);
        } else {
          try {
            const created = await createFabricObject(el);
            if (disposedRef.current) return;
            objects.set(el.id, created);
            applyingRef.current = true;
            canvas.add(created);
            applyingRef.current = false;
          } catch (err) {
            console.error('[fabric-sync] createFabricObject failed', el.type, el.id, err);
          }
        }
      }
      for (const [id, obj] of [...objects]) {
        if (!wanted.has(id)) {
          canvas.remove(obj);
          objects.delete(id);
        }
      }

      // Z-order by element.zIndex.
      const sorted = [...(eff?.elements ?? [])].sort((a, b) => a.zIndex - b.zIndex);
      sorted.forEach((el, i) => {
        const obj = objects.get(el.id);
        if (obj) canvas.moveObjectTo(obj, i);
      });

      canvas.requestRenderAll();
        } catch (err) {
          // ONE failing pass must not kill the queue: the next sync would
          // chain onto a rejected promise and the canvas would never update
          // again (the queue makes a single throw fatal to rendering).
          console.error('[fabric-sync] sync pass failed', err);
        }
      });
      return syncQueue;
    };

    // Human edits → pending patches.
    const offModified = canvas.on('object:modified', (e) => {
      if (applyingRef.current) return;
      const target = e.target;
      if (!target) return;
      const elementId = findElementId(objects, target);
      if (!elementId) return;

      const patch: Record<string, unknown> = {
        x: Math.round(target.left ?? 0),
        y: Math.round(target.top ?? 0),
        rotation: Math.round(target.angle ?? 0),
        opacity: round2(target.opacity ?? 1),
      };
      if (target instanceof Textbox) {
        let fontSize = target.fontSize ?? 48;
        const sx = target.scaleX ?? 1;
        if (sx !== 1) {
          fontSize = Math.round(fontSize * sx);
          target.set({ scaleX: 1, scaleY: 1 });
          target.setCoords();
        }
        patch.fontSize = clamp(fontSize, 12, 240);
        patch.text = target.text;
        patch.width = Math.round(target.width);
        patch.align = target.textAlign;
        if (typeof target.fill === 'string') patch.fill = target.fill;
        patch.fontWeight = target.fontWeight;
        patch.fontStyle = target.fontStyle;
      } else {
        patch.width = Math.round((target.width ?? 0) * (target.scaleX ?? 1));
        patch.height = Math.round((target.height ?? 0) * (target.scaleY ?? 1));
        if (target instanceof Rect && typeof target.fill === 'string') patch.fill = target.fill;
        if ((target.scaleX ?? 1) !== 1 || (target.scaleY ?? 1) !== 1) {
          target.set({ scaleX: 1, scaleY: 1 });
          target.setCoords();
        }
      }
      for (const key of Object.keys(patch)) {
        if (patch[key] === undefined) delete patch[key];
      }
      if (Object.keys(patch).length === 0) return;
      getStudioStore().getState().updateElement(elementId, patch);
    });

    const offTextChanged = canvas.on('text:changed', (e: { target: IText }) => {
      if (applyingRef.current) return;
      const elementId = findElementId(objects, e.target as FabricObject);
      if (!elementId) return;
      getStudioStore().getState().updateElement(elementId, { text: e.target.text });
    });

    const unsubscribe = getStudioStore().subscribe(() => {
      void sync();
    });
    void sync();

    // Export-design renders through this canvas.
    setCanvasExporter(async (req: ExportRequest): Promise<ExportResult> => {
      const dataUrl = canvas.toDataURL({
        format: req.format,
        multiplier: req.scale,
        enableRetinaScaling: false,
      });
      return { dataUrl, width: canvas.getWidth(), height: canvas.getHeight() };
    });

    return () => {
      disposedRef.current = true;
      unsubscribe();
      offModified();
      offTextChanged();
      setCanvasExporter(null);
      canvasRef.current = null;
      objects.clear();
      void canvas.dispose();
    };
  }, [canvasElRef]);
}
