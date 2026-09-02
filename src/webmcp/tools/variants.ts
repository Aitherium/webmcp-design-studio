/**
 * draft-variants — options instead of one draft, in the time of one.
 *
 * Every other tool here changes the design. This one changes the SHAPE of the
 * collaboration: the agent asks the text lane for N independent takes AT ONCE
 * and hands them back as choices, so the human picks instead of re-prompting.
 *
 * Why N is nearly free — measured 2026-09-02 on the fleet lane with
 * AitherOS/dev/tools/bench_lane_concurrency.py: 16 concurrent 96-token
 * completions finished in 1.6 s wall (~61 tok/s each) against 0.5-1.3 s for
 * one. Serial drafting was leaving that on the floor.
 *
 * 🚨 Each request carries a DISTINCT instruction line. The platform's
 * MicroScheduler coalesces identical concurrent prompts into one cached
 * answer (measured the same day: 200 with 0 completion tokens in 10 ms at
 * N>=4), so a naive fan-out of the same prompt returns N copies of one draft
 * — which reads as "the model has no imagination" rather than "the cache did
 * its job". The variance instruction is load-bearing, not decoration.
 *
 * Read-only: nothing lands on the canvas. The agent (or the human) applies a
 * chosen variant with add-text / restyle-design, which goes through the
 * normal pending batch and approve-batch consent path.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { argEnum, argNumber, argString, ToolError } from './helpers';
import { completeOnce, resolveTextLane } from '../../agent/completeOnce';
import { effectiveDoc } from '../../state/doc';

export const VARIANT_KINDS = ['headline', 'tagline', 'palette', 'concept'] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 6;

/** What each kind asks for, and how long an answer may be. */
const KIND_BRIEF: Record<VariantKind, { ask: string; maxTokens: number }> = {
  headline: { ask: 'ONE punchy headline (max 6 words, no quotes, no explanation)', maxTokens: 80 },
  tagline: { ask: 'ONE supporting line of at most 12 words (no quotes, no explanation)', maxTokens: 90 },
  palette: {
    ask: 'ONE colour direction as `#RRGGBB, #RRGGBB, #RRGGBB — two-word mood`, nothing else',
    maxTokens: 60,
  },
  concept: { ask: 'ONE creative direction in at most 25 words (subject, mood, composition)', maxTokens: 110 },
};

/** The per-request nudge that keeps concurrent drafts distinct — see the
 * coalescing note in this file's header. Exported for the test that pins it. */
export function variantInstruction(kind: VariantKind, index: number, count: number): string {
  const angles = [
    'plain and direct',
    'warm and neighbourly',
    'playful, a little cheeky',
    'urgent, event-driven',
    'quiet and premium',
    'nostalgic',
  ];
  return `Take ${index + 1} of ${count}. Angle: ${angles[index % angles.length]}. Give ${KIND_BRIEF[kind].ask}.`;
}

export interface VariantResult {
  n: number;
  angle: string;
  text?: string;
  error?: string;
}

export const draftVariantsTool: ToolDefinition = {
  name: 'draft-variants',
  title: 'Draft variants',
  description:
    'Ask the text lane for several INDEPENDENT options at once (headline, tagline, palette or concept) and return them as choices for the human — nothing is placed on the canvas. Use this instead of drafting one line and asking "do you like it?": the requests run concurrently, so 3-6 takes cost about as long as one. Apply a chosen variant with add-text or restyle-design (which still goes through the pending batch). kind: headline, tagline, palette, concept. count: 2-6 (default 3).',
  inputSchema: {
    type: 'object',
    properties: {
      brief: { type: 'string', description: 'What the piece is for' },
      kind: { type: 'string', enum: [...VARIANT_KINDS] },
      count: { type: 'number', description: '2-6 (default 3)' },
    },
    required: ['brief'],
  },
  annotations: { readOnlyHint: true },
  available: () => true,
  async execute(args, ctx) {
    try {
      const brief = argString(args, 'brief', { required: true, maxLength: 600 })!;
      const kind = (argEnum(args, 'kind', VARIANT_KINDS) ?? 'headline') as VariantKind;
      const count = argNumber(args, 'count', { integer: true, min: MIN_VARIANTS, max: MAX_VARIANTS }) ?? 3;

      // Design context when there is one — the drafts should fit the piece.
      const state = getStudioStore().getState();
      const doc = state.docs.find((d) => d.id === state.currentDocId) ?? null;
      const eff = doc ? effectiveDoc(doc, state.pendingBatch) : null;
      const context = eff
        ? `The design is "${eff.name}" (${eff.size.width}x${eff.size.height}, palette ${eff.palette}).`
        : 'No design exists yet.';

      const lane = resolveTextLane();
      const system =
        'You are a working graphic designer drafting copy for print. Answer with the requested text ONLY — no preamble, no numbering, no quotes, no explanation.';

      const started = performance.now();
      // The whole point: one round trip's worth of wall time for N takes.
      const settled = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          completeOnce({
            lane,
            system,
            prompt: `${context}\nBrief: ${brief}\n${variantInstruction(kind, i, count)}`,
            maxTokens: KIND_BRIEF[kind].maxTokens,
            signal: ctx?.signal,
          })
            .then((text): VariantResult => ({ n: i + 1, angle: variantInstruction(kind, i, count), text }))
            .catch((err): VariantResult => ({
              n: i + 1,
              angle: variantInstruction(kind, i, count),
              error: err instanceof Error ? err.message : String(err),
            })),
        ),
      );
      const elapsedMs = Math.round(performance.now() - started);
      const good = settled.filter((v) => v.text);
      if (good.length === 0) {
        return fail(
          `every variant failed — first error: ${settled[0]?.error ?? 'unknown'}. Check the text agent row in Settings (fleet, or your own endpoint).`,
        );
      }
      return ok(
        JSON.stringify({
          kind,
          requested: count,
          returned: good.length,
          elapsedMs,
          lane: lane.resolvedFrom,
          variants: good.map((v) => ({ n: v.n, text: v.text })),
          failed: settled.filter((v) => v.error).map((v) => ({ n: v.n, error: v.error })),
          next: 'Show these to the human and apply the chosen one with add-text or restyle-design.',
        }),
      );
    } catch (err) {
      if (err instanceof ToolError) return fail(err.message);
      return fail(`draft-variants failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export const VARIANT_TOOLS: ToolDefinition[] = [draftVariantsTool];
