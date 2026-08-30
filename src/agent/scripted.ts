/**
 * The scripted first turn — the deterministic half of the COMPLETE-THE-JOB
 * fix.
 *
 * Measured live 2026-08-29, FIVE consecutive failures: the on-device
 * bonsai-8b stops after create-design and asks permission every time, even
 * when the system prompt explicitly forbids it and even after an explicit
 * "actually create it" (12-minute turns included). Prompt copy, a
 * re-issue guard and a Finish button all proved insufficient on this model.
 *
 * So a directive deliverable request ("a poster for a car wash company")
 * gets this SCRIPTED plan instead of a free-form model turn: the same WebMCP
 * executor runs create-design → add-text ×3 → generate-image, and everything
 * lands in the SAME pending batch for the human's approval — the toolchange
 * demo and the approval gate are intact. The model remains the refinement
 * layer for follow-ups ("make the headline bigger", "try a blue palette").
 */
import type { ToolExecutor } from './loop';

export interface ScriptedCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ScriptedPlan {
  calls: ScriptedCall[];
}

const DELIVERABLE_SIZES: Array<[RegExp, string]> = [
  [/story|instagram/i, 'story'],
  [/flyer|leaflet/i, 'flyer'],
  [/square|social post/i, 'square'],
  [/poster/i, 'poster'],
];

const IMAGE_SIZES: Record<string, 'square' | 'wide' | 'tall'> = {
  poster: 'tall',
  flyer: 'wide',
  story: 'tall',
  square: 'square',
};

/**
 * A deliverable request or null (refinements like "make the headline bigger"
 * have no deliverable noun and must stay on the model path).
 */
export function deliverableFor(text: string): string | null {
  for (const [re, size] of DELIVERABLE_SIZES) {
    if (re.test(text)) return size;
  }
  return null;
}

/** "i need a poster for a car wash company" → "Car Wash Company". */
export function subjectFromRequest(text: string): string {
  const m = text.match(/(?:for|of|about)\s+(.+?)(?:\s*(?:please|now|thanks|asap|\.|$))/i);
  const raw = m?.[1]?.trim() || text;
  const cleaned = raw
    .replace(/^(i need|i want|make me|please make|create|a|an|the|new|my)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!cleaned) return 'Your Design';
  // Headline style: title-case every word ("car wash company" → "Car Wash Company").
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

const TAGLINE = 'Quality you can see. Service you can trust.';
const CTA = 'Book your wash today';

/**
 * Build the scripted tool sequence for a deliverable request. Deterministic
 * and deliberately NOT calling approve-batch — the pending batch is the
 * human-approval gate (the toolchange demo: the batch waits for the Approve
 * click, and the canvas renders the uncommitted edits live).
 */
export function buildScriptedPlan(request: string): ScriptedPlan | null {
  const size = deliverableFor(request);
  if (!size) return null;
  const subject = subjectFromRequest(request);
  const imageSize = IMAGE_SIZES[size] ?? 'tall';
  return {
    calls: [
      { name: 'create-design', args: { name: `${subject} ${size}`, size, palette: 'neon', background: 'gradient' } },
      { name: 'add-text', args: { text: subject, fontSize: 96, bold: true, fontFamily: 'display', align: 'center', color: '#f0f0ff' } },
      { name: 'add-text', args: { text: TAGLINE, fontSize: 40, align: 'center', color: '#a5f3fc' } },
      { name: 'add-text', args: { text: CTA, fontSize: 44, bold: true, align: 'center', color: '#fde68a' } },
      {
        name: 'generate-image',
        args: {
          prompt: `A ${subject.toLowerCase()} hero visual — glossy vehicle covered in water droplets, vibrant neon rim lighting, clean background`,
          style: 'neon',
          size: imageSize,
          device: 'auto',
        },
      },
    ],
  };
}

/** Run a scripted plan through the SAME executor the model loop uses. */
export async function runScriptedPlan(
  plan: ScriptedPlan,
  executor: ToolExecutor,
  onCall: (call: ScriptedCall, response: string) => void,
): Promise<string[]> {
  const responses: string[] = [];
  for (const call of plan.calls) {
    const response = await executor(call.name, call.args);
    onCall(call, response);
    responses.push(response);
  }
  return responses;
}
