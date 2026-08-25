/**
 * The approve/undo pair — the heart of the human-in-the-loop story.
 * approve-batch exists ONLY while a batch is pending: the availability
 * predicate flips on commit, so the browser unregisters it and fires
 * `toolchange` — the demo beat where the tool list changes live.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { describeDesign } from '../../state/doc';
import { ToolError, argNumber, snapshot } from './helpers';

export const approveBatchTool: ToolDefinition = {
  name: 'approve-batch',
  title: 'Approve pending batch',
  description:
    'Commit the pending uncommitted batch of edits to the design (creates a new version; undoable with undo). This is the human-approval gate: until it is called, nothing the agent did is committed. Returns the committed design summary.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  available: (s) => Boolean(s.pendingBatch),
  async execute() {
    const committed = getStudioStore().getState().commitBatch();
    if (!committed) return fail('nothing to approve — there is no pending batch');
    return ok(JSON.stringify({ design: describeDesign(committed, null) }));
  },
};

export const undoTool: ToolDefinition = {
  name: 'undo',
  title: 'Undo',
  description:
    'Undo the last committed change (each approved batch is one undo step). steps: how many committed batches to roll back. Returns the design summary after undoing.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: { type: 'number', minimum: 1, description: 'Number of committed batches to undo (default 1)' },
    },
    required: [],
  },
  async execute(args) {
    const { doc } = snapshot();
    if (!doc) return fail('no design exists to undo');
    let steps: number;
    try {
      steps = argNumber(args, 'steps', { integer: true, min: 1 }) ?? 1;
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }

    const store = getStudioStore();
    const state = store.getState();
    if (state.pendingBatch) {
      return fail('a pending uncommitted batch exists — approve it (approve-batch) or discard it before undoing');
    }
    const applied = state.undo(steps);
    if (applied === 0) return fail('nothing to undo — no committed batches for this design yet');
    const after = store.getState().docs.find((d) => d.id === store.getState().currentDocId) ?? null;
    return ok(JSON.stringify({ undone: applied, design: after ? describeDesign(after, null) : null }));
  },
};

export const BATCH_TOOLS: ToolDefinition[] = [approveBatchTool, undoTool];
