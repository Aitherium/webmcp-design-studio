/**
 * The judge flow, end to end, through the polyfill surface: every step runs
 * via executeTool (the same path a browser agent uses), the registry
 * reconciles after each step (tools appear/disappear), and the store state
 * is asserted after each step.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPrefs } from '../src/state/memory';
import { createStudioStore, getStudioStore, setStudioStore } from '../src/state/store';
import { ModelContextPolyfill } from '../src/webmcp/polyfill';
import { ToolRegistry } from '../src/webmcp/registry';
import { setLocalImageGenerator } from '../src/webmcp/tools/image';
import { setCanvasExporter } from '../src/canvas/exporter';
import { runJudgeScript, type JudgeStep } from '../src/dev/scriptedAgent';

beforeEach(async () => {
  setStudioStore(createStudioStore());
  await clearPrefs();
  setLocalImageGenerator({
    generate: async (req) => ({
      dataUrl: 'data:image/png;base64,stubImage',
      thumbnail: 'data:image/png;base64,stubThumb',
      elapsedMs: 5,
      seed: req.seed,
    }),
  });
  setCanvasExporter(async (_req) => ({
    dataUrl: 'data:image/png;base64,stubExport',
    width: 2100,
    height: 1485,
  }));
});

interface JudgeRun {
  surface: ModelContextPolyfill;
  store: ReturnType<typeof createStudioStore>;
  report: Awaited<ReturnType<typeof runJudgeScript>>;
}

async function runJudge(onStep?: (step: JudgeStep, index: number) => void): Promise<JudgeRun> {
  const surface = new ModelContextPolyfill();
  const registry = new ToolRegistry(
    () => surface,
    { onStatus: () => {}, onToolsChanged: () => {} },
  );
  const store = getStudioStore();

  const exec = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    // The app reconciles on every store change; replay that here so tool
    // availability tracks the flow (approve-batch appears/disappears).
    await registry.reconcile(store.getState());
    const result = await surface.executeTool(name, args);
    await registry.reconcile(store.getState());
    return result;
  };

  const report = await runJudgeScript({ exec, onStep });
  return { surface, store, report };
}

function step(report: { steps: JudgeStep[] }, label: string): JudgeStep {
  const found = report.steps.find((s) => s.step === label);
  expect(found, `step "${label}" ran`).toBeDefined();
  return found!;
}

/**
 * Unwrap the judge result to the tool payload.
 * The script stores what exec returned: through the polyfill that is the
 * JSON-stringified ToolResult (a string), which the script re-stringified
 * on top. Handle both encodings, then read content[0].text (itself JSON).
 */
function textOf(step: JudgeStep): Record<string, unknown> {
  const first = JSON.parse(step.text) as unknown;
  const toolResult =
    typeof first === 'string'
      ? (JSON.parse(first) as { content: Array<{ type: string; text: string }> })
      : (first as { content: Array<{ type: string; text: string }> });
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

describe('scripted judge flow (through the polyfill)', () => {
  it('every step succeeds', async () => {
    const { report } = await runJudge();
    const failed = report.steps.filter((s) => !s.ok);
    expect(failed).toEqual([]);
    expect(report.steps).toHaveLength(11);
  });

  it('create-design builds the flyer and the design tools appear', async () => {
    const { surface, store, report } = await runJudge();
    const create = textOf(step(report, 'create flyer design')).design as {
      name: string;
      size: { width: number; height: number };
      palette: string;
    };
    expect(create.name).toBe('Grand Opening Flyer');
    expect(create.size).toEqual({ width: 2100, height: 1485 });
    expect(create.palette).toBe('neon');

    expect(store.getState().docs).toHaveLength(1);
    expect(store.getState().pendingBatch).toBeNull();

    const live = (await surface.getTools()).map((t) => t.name);
    expect(live).toContain('get-design-state');
    expect(live).toContain('add-text');
    expect(live).toContain('generate-image');
  });

  it('agent edits accumulate as one pending batch, then approve commits it', async () => {
    let elementCountAtApprove: number | null = null;
    let pendingOpCount = 0;
    const store = getStudioStore();
    const { report } = await runJudge((s) => {
      if (s.step === 'add title text') {
        pendingOpCount = store.getState().pendingBatch?.ops.length ?? 0;
      }
      if (s.step === 'approve batch') {
        elementCountAtApprove = store.getState().docs[0].elements.length;
      }
    });
    const addTitle = textOf(step(report, 'add title text'));
    const addSub = textOf(step(report, 'add subtitle text'));
    const genImage = textOf(step(report, 'generate image'));

    expect(addTitle.elementId).toBeTypeOf('string');
    expect(addSub.elementId).toBeTypeOf('string');
    expect(genImage).toMatchObject({ device: 'local', seed: expect.any(Number) });
    expect(genImage.thumbnail).toContain('data:image/png');

    // Pending accumulated during the flow, committed atomically at approve.
    expect(pendingOpCount).toBe(1);
    const committed = textOf(step(report, 'approve batch')).design as { elementCount: number };
    expect(committed.elementCount).toBe(3); // 2 texts + 1 image
    expect(elementCountAtApprove).toBe(3);
    expect(store.getState().pendingBatch).toBeNull();
  });

  it('approve-batch disappears from the tool list after commit', async () => {
    const { surface, report } = await runJudge();
    const during = (await surface.getTools()).map((t) => t.name);
    // The registry reconciled after the last step (recall-preference) —
    // the batch was committed mid-flow, so approve-batch is gone.
    expect(during).not.toContain('approve-batch');
    void report;
  });

  it('export-design returns a filename and preview', async () => {
    const { report } = await runJudge();
    const exported = textOf(step(report, 'export design'));
    expect(exported.filename).toMatch(/^webmcp-grand-opening-flyer-\d+\.png$/);
    expect(exported.format).toBe('png');
    expect(exported.width).toBe(2100);
    expect(exported.height).toBe(1485);
    expect(exported.preview).toContain('data:image/png');
  });

  it('undo rolls the approved batch back to the empty design (P1.3: available via canUndo after the commit)', async () => {
    const { store, report } = await runJudge();
    const undone = textOf(step(report, 'undo last commit'));
    expect(undone.undone).toBe(1);
    expect(store.getState().docs[0].elements).toHaveLength(0);
    expect(store.getState().pendingBatch).toBeNull();
    // The only version was consumed — undo's availability drops back.
    expect(store.getState().canUndo).toBe(false);
  });

  it('preferences round-trip through IndexedDB', async () => {
    const { report } = await runJudge();
    const saved = textOf(step(report, 'remember preference'));
    expect(saved).toMatchObject({ saved: true, key: 'brand_color' });
    const recalled = textOf(step(report, 'recall preference'));
    expect(recalled).toMatchObject({ key: 'brand_color', value: '#2AD7D7' });
  });

  it('the edit-element step targets a real element id and coalesces its patch', async () => {
    const { report } = await runJudge();
    const edited = textOf(step(report, 'edit title element'));
    expect(edited.elementId).toBeTypeOf('string');
    expect(edited.pending).toBe(true);
  });

  it('the judge script is replayable against a fresh store', async () => {
    const first = await runJudge();
    setStudioStore(createStudioStore());
    const second = await runJudge();
    expect(first.report.steps.map((s) => s.step)).toEqual(second.report.steps.map((s) => s.step));
  });
});
