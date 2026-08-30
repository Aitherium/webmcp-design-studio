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

  return (
    <div className="canvas-frame">
      <div className="canvas-scroll">
        <canvas ref={canvasElRef} className="design-canvas" />
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
