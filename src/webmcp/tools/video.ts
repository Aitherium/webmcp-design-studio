/**
 * render-video / video-status (2026-09-03) — the VIDEO lane.
 *
 * The studio's designs become a narrated MP4 through the AitherOS render lane
 * (Remotion for the frames, edge-tts for the voice, the same pipeline every
 * platform blog video runs through). The request is QUEUED on awrun — the
 * platform's priority queue — and answered with a job id; the agent polls
 * `video-status` until `done` and gets a URL. Queueing is the point: N designs
 * render in parallel on whatever workers have claimed the queue (this host
 * today, burst nodes when awrun's capacity hook provisions them), and no
 * browser request ever waits on a render.
 *
 * Slides are built from the EFFECTIVE docs (pending batch applied), the same
 * view the canvas shows — so what the human sees is what gets rendered, and
 * an unapproved edit renders as the human is looking at it.
 *
 * Contract (the backend is written to THIS):
 *   POST {VIDEO_BASE}/render
 *     body  { title, subtitle?, slides, narrate: true, voice, accent_color }
 *     202   { job_id, status_url }
 *   GET  {VIDEO_BASE}/jobs/{job_id}
 *     200   { job_id, status: queued|claimed|running|done|failed,
 *             progress?, url?, message? }
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { getStudioStore } from '../../state/store';
import { effectiveDoc, type DesignDoc, type PendingBatch } from '../../state/doc';
import { argEnum, argString, ToolError } from './helpers';
import { withTimeout } from './image';
import { VIDEO_BASE } from './serviceBases';

export const VIDEO_VOICES = ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer'] as const;
export type VideoVoice = (typeof VIDEO_VOICES)[number];
export const VIDEO_DESIGN_SCOPES = ['current', 'all'] as const;

const SUBMIT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 20_000;
const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 140;
/** House cyan — .ELEMENT/DESIGN.md `aitherium`. */
export const VIDEO_ACCENT = '#2AD7D7';

export interface VideoSlide {
  layout: 'title' | 'image' | 'bullets' | 'closing';
  title: string;
  subtitle?: string;
  bullets?: string[];
  image?: string;
  narration_text: string;
}

export interface RenderVideoRequest {
  title: string;
  subtitle?: string;
  slides: VideoSlide[];
  narrate: true;
  voice: VideoVoice;
  accent_color: string;
}

export interface VideoJobStatus {
  job_id: string;
  status: 'queued' | 'claimed' | 'running' | 'done' | 'failed';
  progress?: number;
  url?: string;
  message?: string;
}

export interface VideoJobRecord {
  job_id: string;
  title: string;
  submittedAt: number;
  status: VideoJobStatus['status'];
  url?: string;
}

/** Jobs submitted from this tab, newest last. Module-level on purpose: the
 * store's state is the DESIGN, and a render job is not a design edit. */
const JOBS = new Map<string, VideoJobRecord>();

export function listVideoJobs(): VideoJobRecord[] {
  return [...JOBS.values()];
}

/** For tests. */
export function resetVideoJobs(): void {
  JOBS.clear();
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function textsOf(doc: DesignDoc): string[] {
  return [...doc.elements]
    .filter((e) => e.type === 'text' && typeof e.text === 'string' && clean(e.text) !== '')
    .sort((a, b) => a.zIndex - b.zIndex || a.y - b.y)
    .map((e) => clean(e.text as string));
}

/** One or two sentences of narration from a design's text. NEVER empty — a
 * slide with no narration renders as silence, which reads as a broken video. */
function narrationFor(doc: DesignDoc, fallback: string): string {
  const texts = textsOf(doc);
  if (texts.length === 0) return fallback;
  const joined = texts
    .slice(0, MAX_BULLETS)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
    .join(' ');
  return joined.length > 600 ? `${joined.slice(0, 597)}...` : joined;
}

/**
 * Build the slide list. Exported for tests: the order (title → per design
 * [image] [bullets] → closing) and the non-empty narration are the contract.
 */
export function buildVideoSlides(
  docs: readonly DesignDoc[],
  pending: PendingBatch | null,
  currentDocId: string | null,
  opts: { title: string; narration?: string },
): VideoSlide[] {
  const effective = docs.map((d) => effectiveDoc(d, d.id === currentDocId ? pending : null));
  const first = effective[0];
  const subtitle = first ? `${first.name} — ${first.size.width}×${first.size.height}` : undefined;
  const slides: VideoSlide[] = [
    {
      layout: 'title',
      title: opts.title,
      subtitle,
      narration_text: opts.narration ? clean(opts.narration) : narrationFor(first ?? ({ elements: [] } as unknown as DesignDoc), opts.title),
    },
  ];
  for (const doc of effective) {
    const image = [...doc.elements].reverse().find((e) => e.type === 'image' && typeof e.src === 'string' && e.src.startsWith('data:'));
    const narration = narrationFor(doc, doc.name);
    if (image) {
      slides.push({ layout: 'image', title: doc.name, image: image.src as string, narration_text: narration });
    }
    const bullets = textsOf(doc)
      .slice(0, MAX_BULLETS)
      .map((t) => (t.length > MAX_BULLET_CHARS ? `${t.slice(0, MAX_BULLET_CHARS - 1)}…` : t));
    if (bullets.length > 0) {
      slides.push({ layout: 'bullets', title: doc.name, bullets, narration_text: narration });
    }
    if (!image && bullets.length === 0) {
      // An empty design still gets a card, so the count on screen matches
      // the count the agent asked for.
      slides.push({ layout: 'bullets', title: doc.name, bullets: ['(empty design)'], narration_text: narration });
    }
  }
  slides.push({
    layout: 'closing',
    title: opts.title,
    subtitle: 'Made in WebMCP Design Studio — studio.aitherium.com',
    narration_text: `${opts.title}. Made with an agent in WebMCP Design Studio.`,
  });
  return slides;
}

function base(): string {
  return VIDEO_BASE.replace(/\/+$/, '');
}

/** Absolute URL for a relay-relative media path. */
export function absoluteVideoUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const b = base();
  if (/^https?:\/\//.test(b)) return `${b}/${url.replace(/^\/+/, '')}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${b}/${url.replace(/^\/+/, '')}`;
}

function relayError(status: number, what: string): ToolError {
  return new ToolError(
    `${what} HTTP ${status}${status === 404 ? ' — the video relay is not configured on this origin yet' : ''}`,
  );
}

export const renderVideoTool: ToolDefinition = {
  name: 'render-video',
  title: 'Render a narrated video of the designs',
  description:
    'Render a narrated MP4 of the designs (Remotion + TTS, queued on awrun). Returns job_id; poll video-status. 2–10 min, uses fleet compute — only when the human asks for a video.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Video title (default: design name)' },
      narration: { type: 'string', description: 'Opening narration paragraph (default: from the design text)' },
      designs: { type: 'string', enum: [...VIDEO_DESIGN_SCOPES], description: 'current (default) or all' },
      voice: { type: 'string', enum: [...VIDEO_VOICES], description: 'TTS voice (default onyx)' },
    },
  },
  // Always registered (registry doctrine: an absent tool is a dead end the agent
  // cannot see); the call-time guard below answers "no design exists".
  available: () => true,
  async execute(args) {
    try {
      const state = getStudioStore().getState();
      const current = state.docs.find((d) => d.id === state.currentDocId) ?? null;
      if (!current) return fail('no design exists — create one with create-design first');

      const title = argString(args, 'title', { maxLength: 120 }) ?? current.name;
      const narration = argString(args, 'narration', { maxLength: 1200 });
      const scope = (argEnum(args, 'designs', VIDEO_DESIGN_SCOPES) ?? 'current') as (typeof VIDEO_DESIGN_SCOPES)[number];
      const voice = (argEnum(args, 'voice', VIDEO_VOICES) ?? 'onyx') as VideoVoice;

      const docs = scope === 'all' ? state.docs : [current];
      const slides = buildVideoSlides(docs, state.pendingBatch, state.currentDocId, { title, narration });
      const body: RenderVideoRequest = {
        title,
        subtitle: slides[0]?.subtitle,
        slides,
        narrate: true,
        voice,
        accent_color: VIDEO_ACCENT,
      };

      const res = await withTimeout(SUBMIT_TIMEOUT_MS, 'video submit', () =>
        fetch(`${base()}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      if (res.status !== 202 && !res.ok) throw relayError(res.status, 'video render submit');
      const data = (await res.json()) as { job_id?: unknown; status_url?: unknown };
      if (typeof data.job_id !== 'string' || data.job_id === '') {
        throw new ToolError('video relay returned no job_id');
      }
      JOBS.set(data.job_id, { job_id: data.job_id, title, submittedAt: Date.now(), status: 'queued' });
      return ok(
        JSON.stringify({
          job_id: data.job_id,
          status: 'queued',
          slides: slides.length,
          designs: docs.length,
          voice,
          hint: 'call video-status with this job_id; renders take 2–10 minutes',
        }),
      );
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const videoStatusTool: ToolDefinition = {
  name: 'video-status',
  title: 'Check a video render job',
  description: 'Poll a render-video job: queued/claimed/running/done/failed; when done, the MP4 URL.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'job_id from render-video' },
    },
    required: ['job_id'],
  },
  available: () => true,
  async execute(args) {
    try {
      const jobId = argString(args, 'job_id', { required: true, maxLength: 80 })!;
      if (!/^[A-Za-z0-9._:-]+$/.test(jobId)) throw new ToolError('"job_id" has an unexpected shape');
      const res = await withTimeout(STATUS_TIMEOUT_MS, 'video status', () =>
        fetch(`${base()}/jobs/${encodeURIComponent(jobId)}`),
      );
      if (!res.ok) throw relayError(res.status, 'video status');
      const data = (await res.json()) as Partial<VideoJobStatus>;
      const status = data.status;
      if (!status || !['queued', 'claimed', 'running', 'done', 'failed'].includes(status)) {
        throw new ToolError(`video relay returned an unknown status: ${String(status)}`);
      }
      const rec = JOBS.get(jobId);
      if (rec) rec.status = status;
      if (status === 'done') {
        if (typeof data.url !== 'string' || data.url === '') {
          throw new ToolError('video job is done but the relay returned no url');
        }
        const url = absoluteVideoUrl(data.url);
        if (rec) rec.url = url;
        try {
          getStudioStore().getState().setAgent({ progressDetail: `video ready: ${url}` });
        } catch {
          /* the status bar is a convenience, never the contract */
        }
        return ok(JSON.stringify({ job_id: jobId, status, url, message: data.message ?? 'render complete' }));
      }
      if (status === 'failed') {
        return fail(`video job ${jobId} failed${data.message ? `: ${data.message}` : ''}`);
      }
      return ok(
        JSON.stringify({
          job_id: jobId,
          status,
          progress: typeof data.progress === 'number' ? data.progress : undefined,
          message: data.message ?? 'still rendering — poll again in ~20 s',
        }),
      );
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
};

export const VIDEO_TOOLS: ToolDefinition[] = [renderVideoTool, videoStatusTool];
