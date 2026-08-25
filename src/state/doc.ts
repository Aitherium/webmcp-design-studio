/**
 * Design document model — pure functions, no React/zustand imports.
 *
 * A `DesignDoc` is a versioned element list. Human and agent edits never
 * mutate it directly: they append operations to a `PendingBatch`, and the
 * batch is applied atomically on approval (`commit`). That is the
 * approve/undo contract every tool and the canvas share.
 */
import {
  DESIGN_PALETTES,
  DESIGN_SIZES,
  type DesignPalette,
  type DesignSizeId,
  type PaletteId,
} from '../brand/tokens';

export type ElementType = 'text' | 'image' | 'rect';

/** CSS font-family ids accepted by tools; mapped to real stacks on render. */
export const FONT_FAMILY_IDS = ['sans', 'serif', 'mono', 'display'] as const;
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  sans: "'Inter', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  display: "'Arial Black', 'Avenir Next', system-ui, sans-serif",
};

export const ALIGNS = ['left', 'center', 'right'] as const;
export type Align = (typeof ALIGNS)[number];

export interface DesignElement {
  id: string;
  type: ElementType;
  /** Text content (text elements). */
  text?: string;
  /** Image data URL (image elements) — kept out of agent-facing summaries. */
  src?: string;
  /** 96px preview for image elements. */
  thumbnail?: string;
  /** Generator seed for image elements. */
  seed?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  zIndex: number;
  /** 0..1 */
  opacity: number;
  /** Text/rect fill color. */
  fill?: string;
  fontSize?: number;
  fontFamily?: FontFamilyId;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  align?: Align;
}

export interface DesignDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  size: { width: number; height: number };
  palette: PaletteId;
  /** CSS color, or the literal 'gradient' for a palette gradient. */
  background: string;
  elements: DesignElement[];
}

/** One edit. Batches are ordered op lists. */
export type PatchOp =
  | { kind: 'add'; element: DesignElement }
  | { kind: 'update'; elementId: string; patch: Partial<DesignElement> }
  | { kind: 'remove'; elementId: string }
  | { kind: 'style'; patch: Partial<Pick<DesignDoc, 'palette' | 'background'>> };

export interface PendingBatch {
  id: string;
  ops: PatchOp[];
  createdAt: number;
}

/** Small unique id — no crypto dependency needed for canvas object ids. */
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Background string for a palette: solid color or 'gradient'. */
export function paletteBackground(palette: DesignPalette, background: string): string {
  return background === 'gradient' ? 'gradient' : background || palette.background;
}

export function createDesignDoc(input: {
  name?: string;
  size?: DesignSizeId;
  palette?: PaletteId;
  background?: string;
}): DesignDoc {
  const palette = DESIGN_PALETTES[input.palette ?? 'neon'];
  const size = DESIGN_SIZES[input.size ?? 'square'];
  const now = Date.now();
  return {
    id: uid('doc'),
    name: input.name?.trim() || 'Untitled design',
    createdAt: now,
    updatedAt: now,
    size: { width: size.width, height: size.height },
    palette: palette.id,
    background: paletteBackground(palette, input.background ?? palette.background),
    elements: [],
  };
}

export function cloneDesignDoc(doc: DesignDoc, name?: string): DesignDoc {
  const now = Date.now();
  return {
    ...doc,
    id: uid('doc'),
    name: name?.trim() || `${doc.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    elements: doc.elements.map((el) => ({ ...el })),
  };
}

/** Apply an ordered op list to a doc, returning a NEW doc (immutable). */
export function applyOps(doc: DesignDoc, ops: readonly PatchOp[]): DesignDoc {
  let elements = doc.elements;
  let palette = doc.palette;
  let background = doc.background;
  let updatedAt = doc.updatedAt;

  for (const op of ops) {
    switch (op.kind) {
      case 'add': {
        const el = { ...op.element };
        if (el.zIndex == null) {
          el.zIndex = elements.reduce((max, e) => Math.max(max, e.zIndex), -1) + 1;
        }
        elements = [...elements, el];
        break;
      }
      case 'update': {
        const i = elements.findIndex((e) => e.id === op.elementId);
        if (i >= 0) {
          const next = [...elements];
          next[i] = { ...next[i], ...op.patch };
          elements = next;
        }
        break;
      }
      case 'remove':
        elements = elements.filter((e) => e.id !== op.elementId);
        break;
      case 'style':
        if (op.patch.palette !== undefined) palette = op.patch.palette;
        if (op.patch.background !== undefined) background = op.patch.background;
        break;
    }
    updatedAt = Date.now();
  }

  return { ...doc, palette, background, elements, updatedAt };
}

/** The doc as the canvas and tools see it: committed doc + pending ops. */
export function effectiveDoc(doc: DesignDoc, batch: PendingBatch | null): DesignDoc {
  return batch ? applyOps(doc, batch.ops) : doc;
}

export function elementInBatch(batch: PendingBatch | null, elementId: string): boolean {
  if (!batch) return false;
  // Walk ops in order; last op for an id wins.
  let present = false;
  for (const op of batch.ops) {
    if (op.kind === 'add' && op.element.id === elementId) present = true;
    else if (op.kind === 'remove' && op.elementId === elementId) present = false;
  }
  return present;
}

export function findElement(doc: DesignDoc, batch: PendingBatch | null, elementId: string): DesignElement | null {
  const eff = effectiveDoc(doc, batch);
  return eff.elements.find((e) => e.id === elementId) ?? null;
}

export interface ElementSummary {
  id: string;
  type: ElementType;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  fill?: string;
  fontSize?: number;
  fontFamily?: FontFamilyId;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  align?: Align;
  /** True when an image element has an attached image (src never serialized). */
  hasImage?: boolean;
}

/** Agent-facing element view: never includes `src` (full data URLs). */
export function summarizeElement(el: DesignElement): ElementSummary {
  const { src: _src, thumbnail: _thumb, seed: _seed, ...rest } = el;
  return {
    ...rest,
    hasImage: el.type === 'image' ? Boolean(el.src) : undefined,
  };
}

export interface BatchSummary {
  batchId: string;
  opCount: number;
  ops: Array<{
    kind: PatchOp['kind'];
    elementId?: string;
    /** Changed fields for update ops (values included — small). */
    patch?: Record<string, unknown>;
  }>;
}

export function summarizeBatch(batch: PendingBatch | null): BatchSummary | null {
  if (!batch) return null;
  return {
    batchId: batch.id,
    opCount: batch.ops.length,
    ops: batch.ops.map((op) => {
      if (op.kind === 'update') {
        return { kind: op.kind, elementId: op.elementId, patch: op.patch };
      }
      if (op.kind === 'remove') return { kind: op.kind, elementId: op.elementId };
      if (op.kind === 'style') return { kind: op.kind, patch: op.patch };
      return { kind: op.kind, elementId: op.element.id };
    }),
  };
}

export interface DesignSummary {
  id: string;
  name: string;
  size: { width: number; height: number };
  palette: PaletteId;
  background: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
  elements: ElementSummary[];
  pending: BatchSummary | null;
}

/** The agent's eyes: a structured, data-URL-free view of a design. */
export function describeDesign(doc: DesignDoc, batch: PendingBatch | null): DesignSummary {
  const eff = effectiveDoc(doc, batch);
  return {
    id: doc.id,
    name: doc.name,
    size: doc.size,
    palette: doc.palette,
    background: doc.background,
    createdAt: doc.createdAt,
    updatedAt: eff.updatedAt,
    elementCount: eff.elements.length,
    elements: eff.elements.map(summarizeElement),
    pending: summarizeBatch(batch),
  };
}

/** Short summary used by list-designs — element counts only, no data. */
export function listDesignSummaries(docs: readonly DesignDoc[]): Array<{
  id: string;
  name: string;
  size: { width: number; height: number };
  palette: PaletteId;
  elementCount: number;
  updatedAt: number;
}> {
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    size: d.size,
    palette: d.palette,
    elementCount: d.elements.length,
    updatedAt: d.updatedAt,
  }));
}
