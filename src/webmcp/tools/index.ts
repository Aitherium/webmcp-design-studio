/**
 * The ONE source of truth: every tool the studio exposes, with its
 * availability predicate. `ToolRegistry.reconcile()` walks this list after
 * every store change and registers/unregisters on the WebMCP surface.
 *
 * Registration order tells the demo story: 28 tools are live at boot (the
 * 19 of 2026-09-03 + nine mediaforge-* studio tools), and the
 * CONSENT PAIR (approve-batch + undo, P1.3) exists ONLY while a batch
 * is pending — both vanish the moment the human approves, and `toolchange`
 * fires as they appear and disappear. Design-scoped tools stay permanently
 * registered (2026-08-30 lesson: an absent tool is a dead end the agent
 * cannot see); call-time guards answer "no design exists".
 */
import type { StudioStateLike, ToolDefinition } from '../types';
import { DESIGN_TOOLS } from './designs';
import { ELEMENT_TOOLS } from './elements';
import { IMAGE_TOOLS } from './image';
import { IRIS_TOOLS } from './iris';
import { MEDIAFORGE_TOOLS } from './mediaforge';
import { MEDIAFORGE_STUDIO_TOOLS } from './mediaforgeStudio';
import { MEDIAFORGE_JOB_TOOLS } from './mediaforgeJobs';
import { VIDEO_TOOLS } from './video';
import { STYLE_TOOLS } from './style';
import { BATCH_TOOLS } from './batch';
import { EXPORT_TOOLS } from './export';
import { MEMORY_TOOLS } from './memory';
import { PRODUCTION_TOOLS } from './production';
import { VARIANT_TOOLS } from './variants';
import { getStudioStore } from '../../state/store';
import { describeDesign } from '../../state/doc';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Always available — the agent's opening hand.
  ...DESIGN_TOOLS, // list-designs, get-design-state, create-design, duplicate-design
  ...MEMORY_TOOLS, // remember-preference, recall-preference, search-preferences (by meaning, on-device)
  ...PRODUCTION_TOOLS, // production-log (P2.3 — the production exhibit)
  ...VARIANT_TOOLS, // draft-variants — N independent takes in one round trip (2026-09-02)
  ...BATCH_TOOLS, // approve-batch (pending-only), undo

  // Available only while a design exists.
  ...ELEMENT_TOOLS, // add-text, edit-element, remove-element
  ...IMAGE_TOOLS, // generate-image
  ...IRIS_TOOLS, // iris-generate — the autonomous pipeline
  ...MEDIAFORGE_TOOLS, // mediaforge-remove-bg — the cutout
  ...MEDIAFORGE_STUDIO_TOOLS, // upscale/enhance/restyle/relight/outpaint/critique/storyboard — ComfyUI behind media-forge (2026-09-03)
  ...MEDIAFORGE_JOB_TOOLS, // mediaforge-animate (async WAN i2v → video element) + mediaforge-job-status
  ...VIDEO_TOOLS, // render-video, video-status — narrated MP4 through the awrun-queued render lane (2026-09-03)
  ...STYLE_TOOLS, // restyle-design
  ...EXPORT_TOOLS, // export-design
];

/** Agent-readable summary of the whole studio state. */
export function describeState(state: StudioStateLike): {
  design: ReturnType<typeof describeDesign> | null;
  toolCount: number;
} {
  const doc = state.docs.find((d) => d.id === state.currentDocId) ?? null;
  const design = doc ? describeDesign(doc, state.pendingBatch) : null;
  const toolCount = TOOL_DEFINITIONS.filter((t) => !t.available || t.available(state)).length;
  return { design, toolCount };
}

/** Convenience for non-React callers (the scripted judge agent). */
export function currentState(): StudioStateLike {
  return getStudioStore().getState();
}
