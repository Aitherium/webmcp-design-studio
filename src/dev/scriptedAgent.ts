/**
 * The judge script — the whole challenge flow, replayable as an async
 * function with no LLM. Exposed as `window.__judgeScript()` for dev/demo
 * and driven by tests through the polyfill.
 *
 * Flow: list-designs → create-design(flyer) → add-text x2 →
 * generate-image (stubbed local) → edit-element → approve-batch →
 * export-design → undo → remember-preference → recall-preference.
 * Every step logs `[judge] step → result` and is recorded in the report.
 */
import { TOOL_DEFINITIONS } from '../webmcp/tools';
import type { ToolResult } from '../webmcp/execute-io';
import { getStudioStore } from '../state/store';
import { effectiveDoc } from '../state/doc';

export type JudgeExec = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface JudgeStep {
  step: string;
  ok: boolean;
  text: string;
}

export interface JudgeReport {
  steps: JudgeStep[];
  toolCount: number;
}

/** Default exec: run the tool definition directly (no browser surface). */
const directExec: JudgeExec = async (name, args) => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!def) throw new Error(`unknown tool "${name}"`);
  return def.execute(args, { signal: new AbortController().signal });
};

function textOf(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as ToolResult).content;
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') {
      return content[0].text;
    }
  }
  return JSON.stringify(result);
}

export async function runJudgeScript(options?: {
  exec?: JudgeExec;
  onStep?: (step: JudgeStep, index: number) => void;
  name?: string;
}): Promise<JudgeReport> {
  const exec = options?.exec ?? directExec;
  const onStep = options?.onStep;
  const steps: JudgeStep[] = [];
  const seen = new Set<string>();

  const run = async (step: string, name: string, args: Record<string, unknown>): Promise<void> => {
    const text = await exec(name, args).then(textOf, (err: unknown) => `ERROR: ${err instanceof Error ? err.message : String(err)}`);
    const record: JudgeStep = { step, ok: !text.startsWith('ERROR:'), text };
    steps.push(record);
    seen.add(name);
    // eslint-disable-next-line no-console
    console.log(`[judge] ${step} → ${text}`);
    onStep?.(record, steps.length - 1);
  };

  await run('list designs', 'list-designs', {});
  await run('create flyer design', 'create-design', {
    name: options?.name ?? 'Grand Opening Flyer',
    size: 'flyer',
    palette: 'neon',
  });
  await run('add title text', 'add-text', {
    text: 'GRAND OPENING',
    fontSize: 96,
    align: 'center',
    bold: true,
  });
  await run('add subtitle text', 'add-text', {
    text: 'Saturday · 10am–4pm · 123 Market St',
    fontSize: 36,
    align: 'center',
  });
  await run('generate image', 'generate-image', {
    prompt: 'a neon shopping bag illustration on a dark background',
    style: 'illustration',
    size: 'square',
  });
  await run('edit title element', 'edit-element', {
    elementId: firstTextElementId(),
    text: 'GRAND OPENING!',
    color: '#2AD7D7',
  });
  await run('approve batch', 'approve-batch', {});
  await run('export design', 'export-design', { format: 'png', scale: 1 });
  // P1.3: undo is available while a batch pends OR the design has committed
  // versions (canUndo) — the "realized the mistake" beat works right after
  // the commit, which is its natural moment.
  await run('undo last commit', 'undo', {});
  await run('remember preference', 'remember-preference', {
    key: 'brand_color',
    value: '#2AD7D7',
  });
  await run('recall preference', 'recall-preference', { key: 'brand_color' });

  return { steps, toolCount: seen.size };
}

/** Element ids are not predictable to the script — read them from state.
 * Uses the effective doc (committed + pending ops) so the script works
 * before the batch is approved. */
function firstTextElementId(): string {
  const s = getStudioStore().getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId);
  const eff = doc ? effectiveDoc(doc, s.pendingBatch) : null;
  const textEl = eff?.elements.find((e) => e.type === 'text') ?? eff?.elements[0];
  if (!textEl) throw new Error('judge script: no element to edit');
  return textEl.id;
}

declare global {
  interface Window {
    __judgeScript?: typeof runJudgeScript;
  }
}

if (typeof window !== 'undefined') {
  window.__judgeScript = runJudgeScript;
}
