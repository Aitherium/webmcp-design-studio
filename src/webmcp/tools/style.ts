/**
 * restyle-design — re-skin the current design as an uncommitted batch:
 * palette, background, and/or the title font (applied to the first text
 * element). The canvas shows the change live; the human still approves.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { effectiveDoc, FONT_FAMILY_IDS, type FontFamilyId } from '../../state/doc';
import { PALETTE_IDS, type PaletteId } from '../../brand/tokens';
import { ToolError, argEnum, argString, currentBatchSummary, snapshot } from './helpers';

export const restyleDesignTool: ToolDefinition = {
  name: 'restyle-design',
  title: 'Restyle design',
  description:
    "Re-skin the current design: palette (neon, paper, ocean, ember), background (CSS color or 'gradient'), and titleFont (sans, serif, mono, display — applied to the first text element). Applied as an UNCOMMITTED batch.",
  inputSchema: {
    type: 'object',
    properties: {
      palette: { type: 'string', enum: [...PALETTE_IDS] },
      background: { type: 'string', description: 'CSS color or "gradient"' },
      titleFont: { type: 'string', enum: [...FONT_FAMILY_IDS], description: 'Font for the title text element' },
    },
    required: [],
  },
  available: (s) => Boolean(s.currentDocId) && s.docs.length > 0,
  async execute(args) {
    const { doc, pending } = snapshot();
    if (!doc) return fail('no design exists — create one with create-design first');

    try {
      const palette = (argEnum(args, 'palette', PALETTE_IDS) ?? undefined) as PaletteId | undefined;
      const background = argString(args, 'background', { maxLength: 64 });
      const titleFont = (argEnum(args, 'titleFont', FONT_FAMILY_IDS) ?? undefined) as FontFamilyId | undefined;

      if (palette === undefined && background === undefined && titleFont === undefined) {
        return fail('provide at least one of palette, background, titleFont');
      }

      const store = getStudioStore().getState();
      const stylePatch: { palette?: PaletteId; background?: string } = {};
      if (palette !== undefined) stylePatch.palette = palette;
      if (background !== undefined) stylePatch.background = background;
      if (Object.keys(stylePatch).length > 0) store.setStyle(stylePatch);

      if (titleFont !== undefined) {
        const title = effectiveDoc(doc, pending).elements.find((e) => e.type === 'text');
        if (title) store.updateElement(title.id, { fontFamily: titleFont });
      }

      return ok(JSON.stringify({ batchSummary: currentBatchSummary() }));
    } catch (err) {
      return fail(err instanceof ToolError ? err.message : String(err));
    }
  },
};

export const STYLE_TOOLS: ToolDefinition[] = [restyleDesignTool];
