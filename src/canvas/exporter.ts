/**
 * Canvas exporter hook — the one seam between the tool layer and the live
 * fabric canvas. FabricCanvas registers itself on mount; the export-design
 * tool calls through it. In headless/test environments a stub can be
 * injected instead.
 */
export interface ExportRequest {
  format: 'png' | 'jpeg';
  scale: 1 | 2;
  includePending: boolean;
}

export interface ExportResult {
  dataUrl: string;
  width: number;
  height: number;
}

export type CanvasExporter = (request: ExportRequest) => Promise<ExportResult>;

let exporter: CanvasExporter | null = null;

export function setCanvasExporter(fn: CanvasExporter | null): void {
  exporter = fn;
}

export function getCanvasExporter(): CanvasExporter | null {
  return exporter;
}
