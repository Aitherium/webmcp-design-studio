/**
 * The Media-Forge ASYNC lane (2026-09-03): mediaforge-animate submits
 * through animate_async and polls the job plane with a BOUNDED budget;
 * mediaforge-job-status resumes. Pins:
 * 1. the submit body uses the route's field names; the job is polled at
 *    /api/jobs/{jid} (the route's own poll target);
 * 2. completed → a NEW `video` element beside the source, src = the mp4
 *    URL through the relay, source untouched;
 * 3. budget exhaustion → status "running" + job_id, no element;
 * 4. failed → isError naming the job's own reason;
 * 5. job-status resumes a budget-exhausted job and lands the video ONCE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioStore, getStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import { effectiveDoc } from '../src/state/doc';
import {
  configureMediaforgePolling,
  listMediaforgeJobs,
  mediaforgeAnimateTool,
  mediaforgeJobStatusTool,
  resetMediaforgeJobs,
} from '../src/webmcp/tools/mediaforgeJobs';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SIGNAL = { signal: new AbortController().signal };

function textOf(r: unknown): string {
  return (r as { content: Array<{ text: string }> }).content[0].text;
}
function isError(r: unknown): boolean {
  return Boolean((r as { isError?: boolean }).isError);
}

interface Call {
  url: string;
  json?: Record<string, unknown>;
}

type JobAnswer = { status: 'running' | 'done' | 'error'; result?: unknown; error?: string; done?: number; total?: number; label?: string };

/** A fake relay whose job answers are consumed in order (the last repeats). */
function stubRelay(jobAnswers: JobAnswer[], submit: unknown = { ok: true, jid: 'job-1' }) {
  const calls: Call[] = [];
  let polls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const call: Call = { url: u };
      if (typeof init?.body === 'string') call.json = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(call);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('/api/upload')) return json({ ok: true, id: 321 });
      if (u.includes('/api/studio/animate_async')) return json(submit);
      if (u.includes('/api/jobs/')) {
        const answer = jobAnswers[Math.min(polls++, jobAnswers.length - 1)];
        if (!answer) return json({ ok: false, error: 'unknown job' });
        return json({ ok: true, job: { id: 'job-1', kind: 'animate', ...answer } });
      }
      if (u.includes('/api/render/jobs/')) return json({ detail: 'Not Found' }, 404);
      return json({ detail: 'Not Found' }, 404);
    }),
  );
  return { calls, polls: () => polls };
}

let sourceId = '';

beforeEach(() => {
  resetStudioStore();
  resetMediaforgeJobs();
  configureMediaforgePolling({ intervalMs: 1, budgetMs: 40 });
  const store = createStudioStore();
  setStudioStore(store as never);
  store.getState().createDesign({ name: 'demo', size: 'square', palette: 'neon', background: 'white' });
  sourceId = store.getState().addElement({ type: 'image', src: TINY_PNG, x: 100, y: 50, width: 300, height: 200, rotation: 0, opacity: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureMediaforgePolling({ intervalMs: 5_000, budgetMs: 90_000 });
});

function elements() {
  const s = getStudioStore().getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId)!;
  return effectiveDoc(doc, s.pendingBatch).elements;
}

const DONE: JobAnswer = { status: 'done', result: { ok: true, id: 322, video: '/media/anim.mp4', frames: 16, fps: 8 } };

describe('mediaforge-animate — the async submit + bounded poll', () => {
  it('validates args before any relay call', async () => {
    const { calls } = stubRelay([DONE]);
    const out = await mediaforgeAnimateTool.execute({ target: 'last-image', motion: 'wild' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('subtle, moderate, strong');
    expect(calls).toHaveLength(0);
  });

  it('completed: posts the route\'s own fields to animate_async, polls /api/jobs/{jid}, lands a video element beside the source', async () => {
    const { calls } = stubRelay([{ status: 'running', done: 1, total: 4, label: 'animate (WAN i2v)' }, DONE]);
    const out = await mediaforgeAnimateTool.execute({ target: sourceId, seconds: 3, fps: 12, motion: 'strong', prompt: 'wind in the hair' }, SIGNAL);
    expect(isError(out)).toBe(false);
    const submit = calls.find((c) => c.url.includes('/api/studio/animate_async'))!;
    expect(submit.json).toEqual({ media_id: 321, seconds: 3, fps: 12, motion: 'strong', prompt: 'wind in the hair' });
    expect(calls.filter((c) => c.url.includes('/api/jobs/job-1')).length).toBeGreaterThanOrEqual(2);

    const parsed = JSON.parse(textOf(out)) as Record<string, unknown>;
    expect(parsed.status).toBe('done');
    expect(parsed.job_id).toBe('job-1');
    expect(parsed.type).toBe('video');
    expect(String(parsed.url)).toMatch(/\/media\/anim\.mp4$/);

    const els = elements();
    expect(els).toHaveLength(2);
    const video = els.find((e) => e.id === parsed.elementId)!;
    expect(video.type).toBe('video');
    expect(video.src).toBe(parsed.url);
    expect({ x: video.x, y: video.y, width: video.width, height: video.height }).toEqual({ x: 100 + 300 + 24, y: 50, width: 300, height: 200 });
    expect(els.find((e) => e.id === sourceId)!.src).toBe(TINY_PNG);
    expect(listMediaforgeJobs()[0]).toMatchObject({ job_id: 'job-1', status: 'done', placedElementId: parsed.elementId });
  });

  it('budget exhausted: answers status "running" + job_id and places nothing', async () => {
    const { polls } = stubRelay([{ status: 'running', done: 0, total: 0, label: 'queued behind the heavy gate' }]);
    const out = await mediaforgeAnimateTool.execute({ target: 'last-image' }, SIGNAL);
    expect(isError(out)).toBe(false);
    const parsed = JSON.parse(textOf(out)) as Record<string, unknown>;
    expect(parsed.status).toBe('running');
    expect(parsed.job_id).toBe('job-1');
    expect(String(parsed.hint)).toContain('mediaforge-job-status');
    expect(polls()).toBeGreaterThan(1);
    expect(elements()).toHaveLength(1);
    expect(listMediaforgeJobs()[0].status).toBe('running');
  });

  it('failed: isError naming the job\'s own reason', async () => {
    stubRelay([{ status: 'error', error: 'WAN i2v: CUDA out of memory' }]);
    const out = await mediaforgeAnimateTool.execute({ target: 'last-image' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('CUDA out of memory');
    expect(elements()).toHaveLength(1);
  });

  it('a submit that returns no jid fails loud', async () => {
    stubRelay([DONE], { ok: false, error: 'no gallery image for media_id=321' });
    const out = await mediaforgeAnimateTool.execute({ target: 'last-image' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('no gallery image');
  });
});

describe('mediaforge-job-status — resuming a budget-exhausted job', () => {
  it('lands the video ONCE when the job finishes, then answers from the record', async () => {
    // The job stays running until the test flips it — the budget exhausts
    // first, then job-status finds it done.
    let finished = false;
    const answers: JobAnswer[] = [];
    const relay = stubRelay(answers);
    answers.push({ status: 'running' });
    const stubbed = fetch;
    vi.stubGlobal('fetch', (url: unknown, init?: RequestInit) => {
      if (finished && String(url).includes('/api/jobs/')) answers.splice(0, answers.length, DONE);
      return (stubbed as typeof fetch)(url as string, init);
    });
    const first = await mediaforgeAnimateTool.execute({ target: 'last-image' }, SIGNAL);
    expect(JSON.parse(textOf(first)).status).toBe('running');
    expect(elements()).toHaveLength(1);
    expect(relay.polls()).toBeGreaterThan(1);

    const still = await mediaforgeJobStatusTool.execute({ job_id: 'job-1' }, SIGNAL);
    expect(JSON.parse(textOf(still)).status).toBe('running');

    finished = true;
    const done = await mediaforgeJobStatusTool.execute({ job_id: 'job-1' }, SIGNAL);
    expect(isError(done)).toBe(false);
    const parsed = JSON.parse(textOf(done)) as Record<string, unknown>;
    expect(parsed.status).toBe('done');
    expect(elements()).toHaveLength(2);
    expect(elements()[1].type).toBe('video');

    const again = await mediaforgeJobStatusTool.execute({ job_id: 'job-1' }, SIGNAL);
    expect(JSON.parse(textOf(again)).elementId).toBe(parsed.elementId);
    expect(elements()).toHaveLength(2); // never a second element
  });

  it('a failed job is an isError with the reason', async () => {
    stubRelay([{ status: 'error', error: 'timeout after 900s' }]);
    const out = await mediaforgeJobStatusTool.execute({ job_id: 'job-1' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('timeout after 900s');
  });

  it('an unknown job (pruned) is an isError that says to resubmit', async () => {
    stubRelay([]);
    const out = await mediaforgeJobStatusTool.execute({ job_id: 'job-gone' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('unknown');
  });

  it('refuses a job_id with an unexpected shape', async () => {
    stubRelay([DONE]);
    const out = await mediaforgeJobStatusTool.execute({ job_id: '../x' }, SIGNAL);
    expect(isError(out)).toBe(true);
    expect(textOf(out)).toContain('job_id');
  });
});
