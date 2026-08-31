/**
 * Element editing tools: add-text, edit-element, remove-element.
 * Every edit appends to the pending batch — nothing touches the committed
 * design until the human approves.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { effectiveDoc, findElement, FONT_FAMILY_IDS, ALIGNS, type FontFamilyId, type Align } from '../../state/doc';
import { DESIGN_PALETTES } from '../../brand/tokens';
import { ToolError, argBool, argEnum, argNumber, argString, currentBatchSummary, snapshot } from './helpers';

const TEXT_COUNT_HINT = 3; // cascade offset for successive text adds

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.max(120, Math.min(text.length * fontSize * 0.55, 900));
}

export const addTextTool: ToolDefinition = {
  name: 'add-text',
  title: 'Add text',
  description:
    'Add a text element to the current design. Edits are UNCOMMITTED until approve-batch. fontFamily: sans, serif, mono, display. align: left, center, right. Returns the element id and the pending batch summary.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text content' },
      x: { type: 'number', description: 'Left position in canvas px (default: centered)' },
      y: { type: 'number', description: 'Top position in canvas px (default: cascaded from the top)' },
      fontSize: { type: 'number', minimum: 12, maximum: 240, description: 'Font size in px (default 48)' },
      color: { type: 'string', description: 'Text color (any CSS color)' },
      fontFamily: { type: 'string', enum: [...FONT_FAMILY_IDS], description: 'Font family id' },
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
      align: { type: 'string', enum: [...ALIGNS] },
    },
    required: ['text'],
  },
  available: () => true, // 2026-08-30: an absent tool is a dead end the agent cannot see — call-time guards answer "no design exists"
  async execute(args) {
    const { doc, pending } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    try {
      const text = argString(args, 'text', { required: true, maxLength: 2000 })!;
      const x = argNumber(args, 'x');
      const y = argNumber(args, 'y');
      const fontSize = argNumber(args, 'fontSize', { min: 12, max: 240 }) ?? 48;
      const color = argString(args, 'color', { maxLength: 64 });
      const fontFamily = (argEnum(args, 'fontFamily', FONT_FAMILY_IDS) ?? undefined) as FontFamilyId | undefined;
      const bold = argBool(args, 'bold');
      const italic = argBool(args, 'italic');
      const align = (argEnum(args, 'align', ALIGNS) ?? undefined) as Align | undefined;

      const eff = effectiveDoc(doc, pending);
      const textCount = eff.elements.filter((e) => e.type === 'text').length;
      const palette = DESIGN_PALETTES[doc.palette];
      const width = estimateTextWidth(text, fontSize);
      const left = x ?? Math.max(0, (doc.size.width - width) / 2);
      const top = y ?? Math.max(24, doc.size.height * 0.1 + (textCount % TEXT_COUNT_HINT) * (fontSize + 36));

      const elementId = getStudioStore().getState().addElement({
        type: 'text',
        text,
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(width),
        height: Math.round(fontSize * 1.25),
        rotation: 0,
        opacity: 1,
        fill: color ?? palette.text,
        fontSize,
        fontFamily: fontFamily ?? 'sans',
        fontWeight: bold ? 'bold' : 'normal',
        fontStyle: italic ? 'italic' : 'normal',
        align: align ?? 'left',
      });
      if (!elementId) return fail('could not add the text element');
      return ok(JSON.stringify({ elementId, pending: true, batchSummary: currentBatchSummary() }));
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const editElementTool: ToolDefinition = {
  name: 'edit-element',
  title: 'Edit element',
  description:
    'Edit an existing element by id: text, font size, color, position, rotation, z-index, opacity, alignment, font family, bold, italic. Edits are UNCOMMITTED until approve-batch. Returns the element id and the pending batch summary.',
  inputSchema: {
    type: 'object',
    properties: {
      elementId: { type: 'string', description: 'Element id from get-design-state' },
      text: { type: 'string' },
      fontSize: { type: 'number', minimum: 12, maximum: 240 },
      color: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      rotation: { type: 'number', description: 'Degrees clockwise' },
      zIndex: { type: 'number', description: 'Stacking order (0 = back)' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      align: { type: 'string', enum: [...ALIGNS] },
      fontFamily: { type: 'string', enum: [...FONT_FAMILY_IDS] },
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
    },
    required: ['elementId'],
  },
  available: () => true, // 2026-08-30: an absent tool is a dead end the agent cannot see — call-time guards answer "no design exists"
  async execute(args) {
    const { doc, pending } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    try {
      const elementId = argString(args, 'elementId', { required: true, maxLength: 64 })!;
      const current = findElement(doc, pending, elementId);
      if (!current) return fail(`unknown element id "${elementId}" — use get-design-state to list elements`);

      const text = argString(args, 'text', { maxLength: 2000 });
      const fontSize = argNumber(args, 'fontSize', { min: 12, max: 240 });
      const color = argString(args, 'color', { maxLength: 64 });
      const x = argNumber(args, 'x');
      const y = argNumber(args, 'y');
      const rotation = argNumber(args, 'rotation');
      const zIndex = argNumber(args, 'zIndex', { integer: true, min: 0 });
      const opacity = argNumber(args, 'opacity', { min: 0, max: 1 });
      const align = (argEnum(args, 'align', ALIGNS) ?? undefined) as Align | undefined;
      const fontFamily = (argEnum(args, 'fontFamily', FONT_FAMILY_IDS) ?? undefined) as FontFamilyId | undefined;
      const bold = argBool(args, 'bold');
      const italic = argBool(args, 'italic');

      const patch: Record<string, unknown> = {};
      if (text !== undefined) patch.text = text;
      if (fontSize !== undefined) patch.fontSize = fontSize;
      if (color !== undefined) patch.fill = color;
      if (x !== undefined) patch.x = x;
      if (y !== undefined) patch.y = y;
      if (rotation !== undefined) patch.rotation = rotation;
      if (zIndex !== undefined) patch.zIndex = zIndex;
      if (opacity !== undefined) patch.opacity = opacity;
      if (align !== undefined) patch.align = align;
      if (fontFamily !== undefined) patch.fontFamily = fontFamily;
      if (bold !== undefined) patch.fontWeight = bold ? 'bold' : 'normal';
      if (italic !== undefined) patch.fontStyle = italic ? 'italic' : 'normal';

      if (Object.keys(patch).length === 0) {
        return fail('nothing to edit — provide at least one editable field');
      }
      const updated = getStudioStore().getState().updateElement(elementId, patch);
      if (!updated) return fail(`unknown element id "${elementId}"`);
      return ok(JSON.stringify({ elementId, pending: true, batchSummary: currentBatchSummary() }));
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const removeElementTool: ToolDefinition = {
  name: 'remove-element',
  title: 'Remove element',
  description:
    'Remove an element by id. UNCOMMITTED until approve-batch — the element stays on the canvas until the batch is approved. Returns the element id and the pending batch summary.',
  inputSchema: {
    type: 'object',
    properties: {
      elementId: { type: 'string', description: 'Element id from get-design-state' },
    },
    required: ['elementId'],
  },
  available: () => true, // 2026-08-30: an absent tool is a dead end the agent cannot see — call-time guards answer "no design exists"
  async execute(args) {
    const { doc, pending } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    try {
      const elementId = argString(args, 'elementId', { required: true, maxLength: 64 })!;
      if (!findElement(doc, pending, elementId)) {
        return fail(`unknown element id "${elementId}" — use get-design-state to list elements`);
      }
      const removed = getStudioStore().getState().removeElement(elementId);
      if (!removed) return fail(`unknown element id "${elementId}"`);
      return ok(JSON.stringify({ elementId, pending: true, batchSummary: currentBatchSummary() }));
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const ELEMENT_TOOLS: ToolDefinition[] = [addTextTool, editElementTool, removeElementTool];
