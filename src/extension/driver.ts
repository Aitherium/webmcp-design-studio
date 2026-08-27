/**
 * Self-contained design driver for the WebMCP extension bundle.
 *
 * Deliberately NO React/store/zustand imports: the adapter bundles to a
 * single IIFE (public/webmcp-adapter.js) that must work on ANY page — the
 * gobbonet Extensions panel, a WebMCP host, or a bare HTML file. The full
 * studio's design engine lives in the React app; this is the small,
 * dependency-free subset the extension registers: create-design / add-text /
 * undo / approve-batch / list-designs / get-canvas.
 *
 * State model mirrors the studio: edits land in a PENDING batch and only
 * become real when the agent calls approve-batch — the same co-creation
 * contract, drawn with a dashed border until committed.
 */

export interface ExtElement {
  id: string;
  type: 'text' | 'image';
  text?: string;
  src?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface ExtDesign {
  id: string;
  title: string;
  size: { width: number; height: number };
  /** committed elements — what approve-batch made real */
  committed: ExtElement[];
  /** pending elements — visible but not yet real */
  pending: ExtElement[];
}

export interface DesignSummary {
  id: string;
  title: string;
  size: { width: number; height: number };
  elementCount: number;
  pendingCount: number;
}

export class DesignDriver {
  private designs = new Map<string, ExtDesign>();
  private currentId: string | null = null;
  private canvas: HTMLCanvasElement | null;
  private counter = 0;

  constructor(canvas?: HTMLCanvasElement | null) {
    this.canvas = canvas ?? null;
  }

  /** Attach a canvas (the demo page calls this after DOM ready). */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.draw();
  }

  current(): ExtDesign | null {
    return this.currentId ? this.designs.get(this.currentId) ?? null : null;
  }

  createDesign(title: string, width = 1024, height = 768): ExtDesign {
    const id = `design-${++this.counter}`;
    const design: ExtDesign = {
      id,
      title: title || `Design ${this.counter}`,
      size: { width, height },
      committed: [],
      pending: [],
    };
    this.designs.set(id, design);
    this.currentId = id;
    this.draw();
    return design;
  }

  /** Add a text element to the PENDING batch. Returns the element. */
  addText(text: string, x?: number, y?: number, fontSize = 48): ExtElement {
    const design = this.requireCurrent();
    const width = Math.min(Math.max(Math.ceil(text.length * fontSize * 0.55), fontSize * 2), design.size.width - 40);
    const el: ExtElement = {
      id: `el-${++this.counter}`,
      type: 'text',
      text,
      x: x ?? Math.round((design.size.width - width) / 2),
      y: y ?? Math.round((design.size.height - fontSize) / 2),
      width,
      height: Math.ceil(fontSize * 1.4),
      rotation: 0,
      opacity: 1,
    };
    design.pending.push(el);
    this.draw();
    return el;
  }

  /** Remove the most recent pending element. Returns true if anything was undone. */
  undo(): boolean {
    const design = this.requireCurrent();
    if (design.pending.length === 0) return false;
    design.pending.pop();
    this.draw();
    return true;
  }

  /** Commit the pending batch — the elements become real. */
  approveBatch(): { committed: number; designId: string } {
    const design = this.requireCurrent();
    const count = design.pending.length;
    design.committed.push(...design.pending);
    design.pending = [];
    this.draw();
    return { committed: count, designId: design.id };
  }

  listDesigns(): DesignSummary[] {
    return Array.from(this.designs.values()).map((d) => ({
      id: d.id,
      title: d.title,
      size: { ...d.size },
      elementCount: d.committed.length,
      pendingCount: d.pending.length,
    }));
  }

  /** Render the current design (committed + pending) and return a data URL. */
  getCanvas(): string {
    const design = this.requireCurrent();
    const c = this.ensureCanvas(design);
    this.drawInto(c, design);
    return c.toDataURL('image/png');
  }

  /** Paint the current design into the attached canvas. */
  draw(): void {
    const design = this.current();
    if (!design || !this.canvas) return;
    this.drawInto(this.canvas, design);
  }

  private requireCurrent(): ExtDesign {
    const design = this.current();
    if (!design) {
      throw new Error('no design exists — call create-design first');
    }
    return design;
  }

  private ensureCanvas(design: ExtDesign): HTMLCanvasElement {
    if (this.canvas) return this.canvas;
    const c = document.createElement('canvas');
    c.width = design.size.width;
    c.height = design.size.height;
    return c;
  }

  private drawInto(c: HTMLCanvasElement, design: ExtDesign): void {
    const { width, height } = design.size;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    for (const el of design.committed) this.paintElement(ctx, el, false);
    for (const el of design.pending) this.paintElement(ctx, el, true);
  }

  private paintElement(ctx: CanvasRenderingContext2D, el: ExtElement, pending: boolean): void {
    ctx.save();
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.globalAlpha = el.opacity;
    if (pending) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.strokeRect(-el.width / 2, -el.height / 2, el.width, el.height);
      ctx.setLineDash([]);
    }
    if (el.type === 'text' && el.text) {
      const fontSize = Math.round(el.height / 1.4);
      ctx.fillStyle = '#111827';
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'top';
      this.wrapText(ctx, el.text, -el.width / 2 + 8, -el.height / 2 + 6, el.width - 16, fontSize * 1.25);
    } else if (el.type === 'image' && el.src) {
      const img = new Image();
      img.onload = () => {
        if (ctx) {
          ctx.drawImage(img, -el.width / 2, -el.height / 2, el.width, el.height);
        }
      };
      img.src = el.src;
    }
    ctx.restore();
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): void {
    const words = text.split(/\s+/);
    let line = '';
    let cursor = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cursor);
        line = word;
        cursor += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cursor);
  }
}
