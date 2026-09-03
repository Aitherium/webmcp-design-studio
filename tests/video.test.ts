/**
 * render-video / video-status (2026-09-03) — the VIDEO lane. Pins:
 * 1. argument rejection (bad voice, over-long title) surfaces as fail(),
 * 2. slide building: title → [image] [bullets] → closing, narration NEVER empty,
 *    pending (unapproved) edits are rendered because the canvas shows them,
 * 3. 202 → queued result carrying the job_id; 404 → the relay message,
 * 4. video-status done → an ABSOLUTE url; failed → fail().
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createStudioStore, resetStudioStore, setStudioStore } from '../src/state/store';
import {
  renderVideoTool,
  videoStatusTool,
  buildVideoSlides,
  absoluteVideoUrl,
  listVideoJobs,
  resetVideoJobs,
  VIDEO_TOOLS,
} from '../src/webmcp/tools/video';
import { TOOL_DEFINITIONS } from '../src/webmcp/tools/index';
import { getStudioStore } from '../src/state/store';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function textOf(r: { content: Array<{ type: 'text'; text: string }> }): string {
  return r.content[0].text;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  resetStudioStore();
  resetVideoJobs();
  const store = createStudioStore();
  setStudioStore(store as never);
  const s = store.getState();
  s.createDesign({ name: 'Yard Sale', size: 'square', palette: 'neon', background: 'white' });
  s.addElement({ type: 'text', text: 'Spring Yard Sale', x: 10, y: 10, width: 300, height: 60, rotation: 0, opacity: 1, fontSize: 48 });
  s.addElement({ type: 'text', text: 'Saturday 8am–2pm, 14 Orchard Lane', x: 10, y: 80, width: 300, height: 40, rotation: 0, opacity: 1, fontSize: 24 });
  s.addElement({ type: 'image', src: TINY_PNG, x: 10, y: 130, width: 200, height: 200, rotation: 0, opacity: 1 });
  // The pending batch is deliberately NOT committed: the canvas shows it, so the video must too.
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registration', () => {
  it('both tools are in the registry and the count is 33 (21 + nine mediaforge-* studio tools + demo-credits + gpu-burst + iris-produce, 2026-09-03)', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain('render-video');
    expect(names).toContain('video-status');
    expect(VIDEO_TOOLS).toHaveLength(2);
    expect(TOOL_DEFINITIONS).toHaveLength(33);
  });
});

describe('buildVideoSlides — the slide contract', () => {
  it('orders title → image → bullets → closing and never leaves narration empty', () => {
    const st = getStudioStore().getState();
    const slides = buildVideoSlides(st.docs, st.pendingBatch, st.currentDocId, { title: 'Yard Sale' });
    expect(slides.map((x) => x.layout)).toEqual(['title', 'image', 'bullets', 'closing']);
    expect(slides[1].image).toBe(TINY_PNG);
    expect(slides[2].bullets).toEqual(['Spring Yard Sale', 'Saturday 8am–2pm, 14 Orchard Lane']);
    for (const sl of slides) expect(sl.narration_text.trim().length).toBeGreaterThan(0);
    expect(slides[0].narration_text).toContain('Spring Yard Sale');
    expect(slides[0].subtitle).toContain('Yard Sale');
  });

  it('an explicit narration replaces the opening narration; an empty design still gets a card', () => {
    const st = getStudioStore().getState();
    const slides = buildVideoSlides(st.docs, st.pendingBatch, st.currentDocId, { title: 'T', narration: 'Hello there.' });
    expect(slides[0].narration_text).toBe('Hello there.');
    const empty = buildVideoSlides([{ ...st.docs[0], id: 'e', name: 'Empty', elements: [] }], null, null, { title: 'T' });
    expect(empty.map((x) => x.layout)).toEqual(['title', 'bullets', 'closing']);
    expect(empty[1].bullets).toEqual(['(empty design)']);
    expect(empty[1].narration_text).toBe('Empty');
  });
});

describe('render-video', () => {
  it('rejects a bad voice and an over-long title as fail()', async () => {
    const bad = await renderVideoTool.execute({ voice: 'morgan-freeman' });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/voice.*one of/);
    const long = await renderVideoTool.execute({ title: 'x'.repeat(121) });
    expect(long.isError).toBe(true);
    expect(textOf(long)).toMatch(/at most 120/);
  });

  it('POSTs the contract body and returns queued + job_id on 202', async () => {
    let seen: { url: string; body: unknown } | null = null;
    stubFetch((url, init) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ job_id: 'r-abc123', status_url: '/api/video/jobs/r-abc123' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const r = await renderVideoTool.execute({ voice: 'nova' });
    expect(r.isError).toBe(false);
    const out = JSON.parse(textOf(r));
    expect(out).toMatchObject({ job_id: 'r-abc123', status: 'queued', slides: 4, designs: 1, voice: 'nova' });
    expect(seen).not.toBeNull();
    const body = (seen as unknown as { url: string; body: Record<string, unknown> }).body;
    expect((seen as unknown as { url: string }).url).toMatch(/\/api\/video\/render$/);
    expect(body).toMatchObject({ title: 'Yard Sale', narrate: true, voice: 'nova', accent_color: '#2AD7D7' });
    expect(Array.isArray(body.slides)).toBe(true);
    expect(listVideoJobs().map((j) => j.job_id)).toEqual(['r-abc123']);
  });

  it('404 names the relay; a 202 without job_id is an error, never a silent success', async () => {
    stubFetch(() => new Response('nope', { status: 404 }));
    const r = await renderVideoTool.execute({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/HTTP 404 — the video relay is not configured on this origin yet/);

    stubFetch(() => new Response(JSON.stringify({}), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    const r2 = await renderVideoTool.execute({});
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toMatch(/no job_id/);
  });
});

describe('video-status', () => {
  it('done → absolute url; running → progress; failed → fail()', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ job_id: 'r-1', status: 'done', url: '/media/r-1.mp4' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const done = await videoStatusTool.execute({ job_id: 'r-1' });
    expect(done.isError).toBe(false);
    const d = JSON.parse(textOf(done));
    expect(d.status).toBe('done');
    expect(d.url).toMatch(/^https?:\/\/.+\/api\/video\/media\/r-1\.mp4$/);

    stubFetch(() =>
      new Response(JSON.stringify({ job_id: 'r-1', status: 'running', progress: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const running = await videoStatusTool.execute({ job_id: 'r-1' });
    expect(running.isError).toBe(false);
    expect(JSON.parse(textOf(running))).toMatchObject({ status: 'running', progress: 42 });

    stubFetch(() =>
      new Response(JSON.stringify({ job_id: 'r-1', status: 'failed', message: 'renderer down' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const failed = await videoStatusTool.execute({ job_id: 'r-1' });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toMatch(/failed: renderer down/);
  });

  it('requires job_id and refuses an odd shape', async () => {
    const missing = await videoStatusTool.execute({});
    expect(missing.isError).toBe(true);
    const odd = await videoStatusTool.execute({ job_id: '../etc/passwd' });
    expect(odd.isError).toBe(true);
  });

  it('absoluteVideoUrl keeps absolute urls and prefixes relative ones with the relay base', () => {
    expect(absoluteVideoUrl('https://x/y.mp4')).toBe('https://x/y.mp4');
    expect(absoluteVideoUrl('/media/a.mp4')).toMatch(/\/api\/video\/media\/a\.mp4$/);
  });
});
