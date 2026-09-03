/**
 * The Media-Forge ASYNC lane (2026-09-03): mediaforge-animate submits a WAN
 * i2v render through `/api/studio/animate_async` and polls the job plane;
 * mediaforge-job-status resumes a job whose poll budget ran out.
 *
 * Why async: Cloudflare cuts any request at 100 s (524), and an animate
 * render takes minutes inside the heavy GPU gate. The submit answers
 * `{ok, jid}` immediately; the job is polled at
 *   GET {base}/api/jobs/{jid}  →  {ok: true, job: {status: running|done|error,
 *                                  result: {ok, id, video: "/media/x.mp4", frames, fps}, error}}
 *                              |  {ok: false, error: "unknown job"}     (pruned = terminal)
 * (the route's own docstring names that poll target; `/api/render/jobs/{id}`
 * is the storyboard-scene render plane and is tried as a fallback so a job
 * id from either plane resolves). The poll budget is BOUNDED: when it runs
 * out the tool answers `status: "running"` + `job_id`, and the agent calls
 * mediaforge-job-status later. On completion a `video` element lands
 * beside the source image with the mp4 URL as `src`.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { capturePosterFrame } from '../../canvas/videoPoster';
import { ToolError, argEnum, argNumber, argString, currentBatchSummary } from './helpers';
import { withTimeout } from './image';
import { absoluteMediaUrl, getJson, mediaforgeBase, okOrThrow, postStudio, relayError, uploadSource } from './mediaforgeClient';
import { besideGeometry, currentDocOrThrow, placeVideo, sourceFromArgs } from './mediaforgePlace';

export const ANIMATE_MOTIONS = ['subtle', 'moderate', 'strong'] as const;
export type AnimateMotion = (typeof ANIMATE_MOTIONS)[number];

const SUBMIT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 20_000;

/** Poll cadence + budget; `configureMediaforgePolling` shrinks them in tests. */
const polling = { intervalMs: 5_000, budgetMs: 90_000 };

export function configureMediaforgePolling(next: Partial<typeof polling>): void {
  Object.assign(polling, next);
}

export interface MediaforgeJobRecord {
  job_id: string;
  kind: 'animate';
  sourceElementId: string;
  geometry: { x: number; y: number; width: number; height: number };
  submittedAt: number;
  status: 'running' | 'done' | 'failed';
  placedElementId?: string;
  url?: string;
}

/** Jobs submitted from this tab. Module-level on purpose: a render job is
 * not a design edit, so it does not live in the store. */
const JOBS = new Map<string, MediaforgeJobRecord>();

export function listMediaforgeJobs(): MediaforgeJobRecord[] {
  return [...JOBS.values()];
}

/** For tests. */
export function resetMediaforgeJobs(): void {
  JOBS.clear();
}

/* ── the job plane ───────────────────────────────────────────────────────── */

interface JobBody {
  status?: unknown;
  result?: unknown;
  error?: unknown;
  done?: unknown;
  total?: unknown;
  label?: unknown;
}

export type JobPoll =
  | { state: 'running'; done: number; total: number; label: string }
  | { state: 'done'; result: Record<string, unknown> }
  | { state: 'failed'; error: string }
  | { state: 'unknown' };

function classify(job: JobBody): JobPoll {
  if (job.status === 'done' || job.status === 'completed') {
    const result = job.result && typeof job.result === 'object' ? (job.result as Record<string, unknown>) : {};
    return { state: 'done', result };
  }
  if (job.status === 'error' || job.status === 'failed') {
    return { state: 'failed', error: typeof job.error === 'string' && job.error ? job.error : 'no reason given' };
  }
  return {
    state: 'running',
    done: typeof job.done === 'number' ? job.done : 0,
    total: typeof job.total === 'number' ? job.total : 0,
    label: typeof job.label === 'string' ? job.label : String(job.status ?? 'running'),
  };
}

/** One lookup: the studio job registry first, the render-jobs plane second. */
export async function pollJobOnce(jobId: string): Promise<JobPoll> {
  const id = encodeURIComponent(jobId);
  const studio = await getJson<{ ok?: boolean; job?: JobBody; error?: unknown }>(`api/jobs/${id}`, 'job status');
  if (studio.ok && studio.job) return classify(studio.job);
  // The render-jobs plane 404s an id it never issued — that is "unknown",
  // not a relay failure (the studio registry already answered above).
  const res = await fetch(`${mediaforgeBase()}/api/render/jobs/${id}`);
  if (res.status === 404) return { state: 'unknown' };
  if (!res.ok) throw relayError(res.status, 'job status');
  const render = (await res.json()) as JobBody;
  return render.status !== undefined ? classify(render) : { state: 'unknown' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Poll until terminal or the budget ends (then the last `running` answer). */
export async function pollJobWithBudget(jobId: string, onTick?: (p: JobPoll) => void): Promise<JobPoll> {
  const deadline = Date.now() + polling.budgetMs;
  let last: JobPoll = await pollJobOnce(jobId);
  while (last.state === 'running' && Date.now() < deadline) {
    onTick?.(last);
    await sleep(polling.intervalMs);
    last = await pollJobOnce(jobId);
  }
  return last;
}

/* ── completion → a video element ────────────────────────────────────────── */

function videoUrlOf(result: Record<string, unknown>): string {
  const video = result.video;
  if (typeof video !== 'string' || !video) throw new ToolError('animate job finished but returned no video path');
  return absoluteMediaUrl(video);
}

/** Place the finished video beside its source (once per job). */
async function landVideo(rec: MediaforgeJobRecord, result: Record<string, unknown>): Promise<string> {
  if (rec.placedElementId) return rec.placedElementId;
  const url = videoUrlOf(result);
  const poster = await capturePosterFrame(url).catch(() => null);
  const elementId = placeVideo(url, rec.geometry, poster);
  rec.placedElementId = elementId;
  rec.url = url;
  rec.status = 'done';
  return elementId;
}

function setProgress(text: string | null): void {
  try {
    getStudioStore().getState().setAgent({ progressDetail: text });
  } catch {
    /* the status bar is a convenience, never the contract */
  }
}

function runningAnswer(jobId: string, p: Extract<JobPoll, { state: 'running' }>): string {
  return JSON.stringify({
    job_id: jobId,
    status: 'running',
    progress: p.total > 0 ? Math.round((p.done / p.total) * 100) : null,
    label: p.label,
    hint: 'call mediaforge-job-status with this job_id; WAN i2v renders take minutes',
  });
}

async function settle(rec: MediaforgeJobRecord, poll: JobPoll) {
  if (poll.state === 'done') {
    const elementId = await landVideo(rec, poll.result);
    setProgress(`animation ready: ${rec.url}`);
    return ok(JSON.stringify({ job_id: rec.job_id, status: 'done', elementId, url: rec.url, sourceElementId: rec.sourceElementId, type: 'video', batchSummary: currentBatchSummary() }));
  }
  if (poll.state === 'failed') {
    rec.status = 'failed';
    return fail(`animate job ${rec.job_id} failed: ${poll.error}`);
  }
  if (poll.state === 'unknown') {
    return fail(`job ${rec.job_id} is unknown to media-forge — finished jobs are pruned; submit again`);
  }
  return ok(runningAnswer(rec.job_id, poll));
}

/* ── mediaforge-animate ──────────────────────────────────────────────────── */

export const mediaforgeAnimateTool: ToolDefinition = {
  name: 'mediaforge-animate',
  title: 'Animate image to video (fleet, async)',
  description:
    'Animate a canvas image into a short clip with WAN image-to-video on the fleet (media-forge, not on-device). Submitted as an async job and polled for up to ~90 s: on completion a NEW video element lands beside the source; if still rendering, returns status "running" + job_id — call mediaforge-job-status later. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Source image element id, or "last-image"' },
      prompt: { type: 'string', description: 'Motion / scene prompt (optional)' },
      seconds: { type: 'number', description: 'Clip length 0.5–6 s (default 2)' },
      fps: { type: 'number', description: 'Frames per second 4–24 (default 8)' },
      motion: { type: 'string', enum: [...ANIMATE_MOTIONS], description: 'Motion magnitude (default moderate)' },
    },
    required: ['target'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  available: () => true,
  async execute(args) {
    try {
      const source = sourceFromArgs(args);
      const prompt = argString(args, 'prompt', { maxLength: 1000 }) ?? '';
      const seconds = argNumber(args, 'seconds', { min: 0.5, max: 6 }) ?? 2;
      const fps = argNumber(args, 'fps', { min: 4, max: 24, integer: true }) ?? 8;
      const motion = (argEnum(args, 'motion', ANIMATE_MOTIONS) ?? 'moderate') as AnimateMotion;

      const jobId = await withTimeout(SUBMIT_TIMEOUT_MS, 'animate submit', async () => {
        const mediaId = await uploadSource(source.src as string);
        const answer = okOrThrow(
          await postStudio<{ ok?: boolean; error?: unknown; jid?: unknown }>('animate_async', { media_id: mediaId, seconds, fps, motion, prompt }),
          'animate_async',
        );
        if (typeof answer.jid !== 'string' || !answer.jid) throw new ToolError('media-forge animate_async returned no job id');
        return answer.jid;
      });
      const rec: MediaforgeJobRecord = {
        job_id: jobId,
        kind: 'animate',
        sourceElementId: source.id,
        geometry: besideGeometry(source),
        submittedAt: Date.now(),
        status: 'running',
      };
      JOBS.set(jobId, rec);
      const poll = await pollJobWithBudget(jobId, (p) => setProgress(`animating on the fleet… ${p.label}`));
      setProgress(null);
      return await settle(rec, poll);
    } catch (err) {
      setProgress(null);
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

/* ── mediaforge-job-status ───────────────────────────────────────────────── */

/** A job submitted by another tab has no record: land it beside the last
 * image, or at the top-left of the design. */
function recordFor(jobId: string): MediaforgeJobRecord {
  const known = JOBS.get(jobId);
  if (known) return known;
  const doc = currentDocOrThrow();
  const last = [...doc.elements].reverse().find((e) => e.type === 'image');
  const size = Math.min(512, Math.max(128, Math.round(doc.size.width * 0.4)));
  const rec: MediaforgeJobRecord = {
    job_id: jobId,
    kind: 'animate',
    sourceElementId: last?.id ?? '',
    geometry: last ? besideGeometry(last) : { x: 24, y: 24, width: size, height: size },
    submittedAt: Date.now(),
    status: 'running',
  };
  JOBS.set(jobId, rec);
  return rec;
}

export const mediaforgeJobStatusTool: ToolDefinition = {
  name: 'mediaforge-job-status',
  title: 'Check a media-forge job',
  description:
    'Poll a media-forge async job (from mediaforge-animate) running on the fleet (not on-device): running / done / failed. When done, the finished video is placed as a NEW video element (once) and its URL returned. UNCOMMITTED until approve-batch.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'job_id from mediaforge-animate' },
    },
    required: ['job_id'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  available: () => true,
  async execute(args) {
    try {
      const jobId = argString(args, 'job_id', { required: true, maxLength: 80 })!;
      if (!/^[A-Za-z0-9._:-]+$/.test(jobId)) throw new ToolError('"job_id" has an unexpected shape');
      const rec = recordFor(jobId);
      if (rec.placedElementId) {
        return ok(JSON.stringify({ job_id: jobId, status: 'done', elementId: rec.placedElementId, url: rec.url, type: 'video' }));
      }
      const poll = (await withTimeout(STATUS_TIMEOUT_MS, 'job status', () => pollJobOnce(jobId))) as JobPoll;
      return await settle(rec, poll);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
};

export const MEDIAFORGE_JOB_TOOLS: ToolDefinition[] = [mediaforgeAnimateTool, mediaforgeJobStatusTool];
