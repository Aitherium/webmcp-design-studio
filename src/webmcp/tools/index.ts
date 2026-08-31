/**
 * The ONE source of truth: every tool the studio exposes, with its
 * availability predicate. `ToolRegistry.reconcile()` walks this list after
 * every store change and registers/unregisters on the WebMCP surface.
 *
 * Registration order tells the demo story: the agent starts with 5 always-on
 * tools, creating a design unlocks 8 more, and approve-batch exists ONLY
 * while a batch is pending — it vanishes the moment the human approves.
 */
import type { StudioStateLike, ToolDefinition } from '../types';
import { DESIGN_TOOLS } from './designs';
import { ELEMENT_TOOLS } from './elements';
import { IMAGE_TOOLS } from './image';
import { IRIS_TOOLS } from './iris';
import { MEDIAFORGE_TOOLS } from './mediaforge';
import { STYLE_TOOLS } from './style';
import { BATCH_TOOLS } from './batch';
import { EXPORT_TOOLS } from './export';
import { MEMORY_TOOLS } from './memory';
import { getStudioStore } from '../../state/store';
import { describeDesign } from '../../state/doc';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Always available — the agent's opening hand.
  ...DESIGN_TOOLS, // list-designs, get-design-state, create-design, duplicate-design
  ...MEMORY_TOOLS, // remember-preference, recall-preference
  ...BATCH_TOOLS, // approve-batch (pending-only), undo

  // Available only while a design exists.
  ...ELEMENT_TOOLS, // add-text, edit-element, remove-element
  ...IMAGE_TOOLS, // generate-image
  ...IRIS_TOOLS, // iris-generate — the autonomous pipeline
  ...MEDIAFORGE_TOOLS, // mediaforge-remove-bg — the cutout
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
