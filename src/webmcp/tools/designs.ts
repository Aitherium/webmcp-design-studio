/**
 * Design lifecycle tools: list-designs, get-design-state, create-design,
 * duplicate-design. The agent's session starts with list-designs +
 * create-design; the design-scoped tools appear once a design exists.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { listDesignSummaries, describeDesign } from '../../state/doc';
import { DESIGN_SIZE_IDS, PALETTE_IDS } from '../../brand/tokens';
import { argEnum, argString, snapshot } from './helpers';

export const listDesignsTool: ToolDefinition = {
  name: 'list-designs',
  title: 'List designs',
  description:
    'List saved designs with id, name, size (width x height px), palette, element count and last modified time. No image data is included.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: { readOnlyHint: true },
  async execute() {
    const summaries = listDesignSummaries(getStudioStore().getState().docs);
    return ok(JSON.stringify({ designs: summaries }));
  },
};

export const getDesignStateTool: ToolDefinition = {
  name: 'get-design-state',
  title: 'Get design state',
  description:
    'Get the current design as structured JSON: name, size, palette, background, the full element list (id, type, text, position, size, rotation, z-index, opacity, colors) and any pending uncommitted batch summary. This is your view of the canvas.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: { readOnlyHint: true },
  available: (s) => Boolean(s.currentDocId) && s.docs.length > 0,
  async execute() {
    const { doc, pending } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');
    return ok(JSON.stringify({ design: describeDesign(doc, pending) }));
  },
};

export const createDesignTool: ToolDefinition = {
  name: 'create-design',
  title: 'Create design',
  description:
    'Create a new design and switch to it. size: poster (1080x1440), square (1080x1080), story (1080x1920), flyer (2100x1485). palette: neon, paper, ocean, ember. background: a CSS color or the string "gradient". Committed immediately (no batch). Returns the new design summary.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120, description: 'Design name' },
      size: { type: 'string', enum: [...DESIGN_SIZE_IDS], description: 'Canvas size preset' },
      palette: { type: 'string', enum: [...PALETTE_IDS], description: 'Design palette' },
      background: { type: 'string', description: 'CSS color or "gradient"' },
    },
    required: [],
  },
  async execute(args) {
    const name = argString(args, 'name', { maxLength: 120 });
    const size = (argEnum(args, 'size', DESIGN_SIZE_IDS) ?? undefined) as
      | 'poster'
      | 'square'
      | 'story'
      | 'flyer'
      | undefined;
    const palette = (argEnum(args, 'palette', PALETTE_IDS) ?? undefined) as
      | 'neon'
      | 'paper'
      | 'ocean'
      | 'ember'
      | undefined;
    const background = argString(args, 'background', { maxLength: 64 });

    const store = getStudioStore();
    const s = store.getState();
    if (s.pendingBatch) {
      return fail('a pending uncommitted batch exists — approve it (approve-batch) or discard it before creating a design');
    }
    const doc = store.getState().createDesign({ name, size, palette, background });
    return ok(JSON.stringify({ design: describeDesign(doc, null) }));
  },
};

export const duplicateDesignTool: ToolDefinition = {
  name: 'duplicate-design',
  title: 'Duplicate design',
  description:
    'Duplicate the current design into a new design (id, elements, palette, background copied) and switch to it. Committed immediately. Returns the new design summary.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120, description: 'Name for the copy' },
    },
    required: [],
  },
  available: (s) => Boolean(s.currentDocId) && s.docs.length > 0,
  async execute(args) {
    const name = argString(args, 'name', { maxLength: 120 });
    const store = getStudioStore();
    if (store.getState().pendingBatch) {
      return fail('a pending uncommitted batch exists — approve or discard it before duplicating the design');
    }
    const copy = store.getState().duplicateDesign(name);
    if (!copy) return fail('no design exists to duplicate');
    return ok(JSON.stringify({ design: describeDesign(copy, null) }));
  },
};

export const DESIGN_TOOLS: ToolDefinition[] = [
  listDesignsTool,
  getDesignStateTool,
  createDesignTool,
  duplicateDesignTool,
];
