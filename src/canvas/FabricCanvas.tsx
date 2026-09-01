/**
 * The live design canvas. Renders the current design doc through fabric.js
 * (see useFabricSync for the two-way sync) and overlays the pending-batch
 * chips — the human's approve / discard gate over whatever the agent just
 * did. Every agent edit is an uncommitted batch until the human approves.
 */
import { useRef } from 'react';
import { useStudio } from '../state/store';
import { useFabricSync } from './useFabricSync';

export function FabricCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  useFabricSync(canvasElRef);

  const pendingBatch = useStudio((s) => s.pendingBatch);
  const doc = useStudio((s) => s.docs.find((d) => d.id === s.currentDocId) ?? null);
  const commit = useStudio((s) => s.commitBatch);
  const discard = useStudio((s) => s.discardBatch);
  // An empty design with a light background is INVISIBLE on a light page —
  // the canvas frame (CSS) gives it a physical edge, and this hint tells the
  // owner the design exists and is waiting for elements. Measured live
  // 2026-08-29: the agent created a white poster and the owner said "wait I
  // dont see it" — the design was current and rendered; it was white-on-white.
  const isEmptyDesign = Boolean(doc) && doc!.elements.length === 0 && !pendingBatch;

  return (
    <div className="canvas-frame">
      <div className="canvas-scroll">
        <canvas ref={canvasElRef} className="design-canvas" />
        {!doc && (
          <div className="canvas-empty" role="status">
            <span className="canvas-empty-title">No design yet</span>
            <span className="canvas-empty-sub">
              Ask the agent for a poster, flyer or story — or tap a starter prompt in the rail — and
              every edit waits for your Approve.
            </span>
          </div>
        )}
        {doc && isEmptyDesign && (
          <div className="canvas-empty" role="status">
            <span className="canvas-empty-title">Empty design — it's real, just blank</span>
            <span className="canvas-empty-sub">
              The {doc.palette} canvas is ready. Ask the agent to add text, images or shapes.
            </span>
          </div>
        )}
      </div>

      {doc && (
        <div className="canvas-meta">
          <span className="canvas-meta-name">{doc.name}</span>
          <span className="canvas-meta-dims">
            {doc.size.width} x {doc.size.height} · {doc.palette}
          </span>
        </div>
      )}

      {pendingBatch && (
        <div className="batch-chips" role="status" aria-label="pending batch">
          <span className="batch-chips-label">
            {pendingBatch.ops.length} agent edit{pendingBatch.ops.length === 1 ? '' : 's'} pending — nothing is
            committed yet
          </span>
          <button className="chip chip-approve" onClick={() => commit()}>
            Approve
          </button>
          <button className="chip chip-discard" onClick={() => discard()}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
