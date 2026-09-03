# WebMCP Challenge submission — WebMCP Design Studio

**Live URL:** https://studio.aitherium.com (GitHub Pages; works in ChatGPT's in-app
browser and in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`)

**Repo:** https://github.com/Aitherium/webmcp-design-studio (MIT)

**Demo video:** [YouTube — WebMCP Design Studio walkthrough](https://www.youtube.com/watch?v=9nod3lHdFPo) (0:53, with audio; source `demo/webmcp-demo-2026-09-02.mp4`)

---

## Why this is a strong fit for WebMCP

WebMCP's promise is that a website *declares* what agents can do instead of forcing
agents to guess. The studio is built entirely around that declaration: every capability
of the design tool is registered on `document.modelContext.registerTool()` — **32 tools**
covering the whole creative loop across fourteen families:

- **Designs**: `create-design`, `duplicate-design`, `list-designs`, `get-design-state`
- **Elements**: `add-text`, `edit-element`, `remove-element`
- **Images**: `generate-image` (on-device WebGPU / fleet / BYOK), `iris-generate` (the
  IRIS Visual Artisan — AI prompt-optimization + generation), `mediaforge-remove-bg`
  (BiRefNet background removal, three hops through the platform)
- **Style + export**: `restyle-design`, `export-design` (PNG/JPEG 1x/2x)
- **Consent**: `approve-batch`, `undo`
- **Video**: `render-video`, `video-status` — the designs become a narrated MP4 through
  the platform's render lane (Remotion + TTS). Renders are queued on awrun, the
  platform's priority queue, so many designs render in parallel on burst workers and
  the agent polls for the URL instead of waiting on a request.
- **Media pipeline (ComfyUI behind MediaForge)**: `mediaforge-upscale`, `-enhance`,
  `-restyle` (preset catalog read live), `-relight`, `-outpaint`, `-critique` (read-only
  design critique), `-storyboard` (plans, then renders one shot per request), `-animate`
  (WAN image-to-video, async: the tool polls the job plane so nothing crosses the edge's
  100-second cut) and `-job-status`. Every result lands as a NEW canvas element beside its
  source — the source is never mutated — and `animate` introduces a `video` element type
  whose poster frame is captured in the tab.
- **Demo credits + GPU burst**: `demo-credits` and `gpu-burst`. Every visitor gets a fixed
  allowance (30 hosted turns / $0.50); the hosted chat lane debits a turn BEFORE it sends,
  and when the allowance is gone the refusal names the two free lanes (on-device brain,
  bring-your-own-key). `gpu-burst` rents a cloud GPU for ComfyUI through the platform's
  governor — under the owner's daily cap, at a price ceiling, torn down after twenty idle
  minutes — so a stranger can spin heavy media work up on demand and cannot run up a bill.
- **Memory**: `remember-preference`, `recall-preference`, `search-preferences` (recall by
  meaning with an embedder trained for this studio, running in the tab)
- **Drafting**: `draft-variants` — N independent takes (headline, tagline, palette,
  concept) fanned out CONCURRENTLY through the text lane, so the agent offers the
  human options instead of one draft. Measured on this fleet: 16 concurrent
  completions in 1.6 s wall against 0.5-1.3 s for one, so 3-6 takes cost about as
  much as one. Read-only — a chosen variant is applied with `add-text` and still
  goes through the pending batch.
- **Production**: `production-log` — the studio's week-long production
  ledger, readable by any agent: days, total pieces, last run's health

Two details make it genuine leverage rather than a demo stub:

1. **The human is a first-class tool.** Every agent edit lands as an *uncommitted
   batch*, and committing is itself a WebMCP tool — and **the consent boundary is part
   of the protocol surface itself**: `approve-batch` *exists only while a batch is
   pending*, and `undo` appears with it and stays while there is a committed version
   to roll back (the safety net). A WebMCP `toolchange` event fires as they appear and
   vanish, so any browser agent can see the moment the human's consent is required.
   The agent's last step is a request for human approval — the collaboration is part
   of the protocol, not an afterthought.
2. **The studio's own in-page agent speaks the same protocol.** The built-in agent
   (WebGPU on-device, or the platform fleet, or the visitor's own OpenAI-compatible
   endpoint) drives the studio through the very same
   `getTools()`/`executeTool()` surface a browser agent would — the app eats its own
   dogfood, so the WebMCP surface is exercised by real traffic, not just test calls.
   Every `registerTool`, `toolchange` and `executeTool` is recorded in the in-page
   **protocol feed**, so the protocol is visible working, not just described.

## How it creates a better user experience

Design tools are overloaded with features; agents remove the *interface* without
removing the *control*. A person says "yard sale flyer, spring theme" and the agent
drafts the whole thing — but nothing is committed until the person approves, so the
human stays the art director: approve, nudge with natural language ("make the headline
bigger"), or undo. Images generate **on-device via WebGPU** (a 4B flow-matching image
model in the tab — nothing leaves the machine), via the platform fleet (IRIS + the
media-forge canvas), or via the visitor's own endpoint (BYOK) — and every tool call is
visible in the transcript *and* the protocol feed with its result, so the process is
legible, not magic.

## What people and agents can do together that was hard or impossible before

- **Sketch-speed iteration in natural language** — a non-designer describes a poster,
  an agent lays out typography, imagery and palette in seconds, and the human refines
  with sentences instead of menus.
- **A consent-aware creative agent** — the agent can do *everything* except the one
  thing that should always stay human: the final say. `approve-batch` encodes that
  boundary into the tool surface itself (the tool literally does not exist until
  there is something to approve), so any WebMCP agent inherits it.
- **The same workspace, any agent** — ChatGPT's browser agent, the studio's in-page
  agent, and (via the registry) any future WebMCP agent all drive the identical
  surface, with the design state reconciled live between them.
- **Tools that cross a document boundary** — WebMCP tools are per-document, so an
  agent driving a page that *frames* an app cannot see that app's tools. The studio
  answers a small postMessage protocol (`src/embedBridge.ts`) that lets a host page
  register PROXY tools on its own `document.modelContext` and forward calls into the
  frame — so embedding the studio makes the HOST a richer WebMCP surface, and the
  consent boundary travels with it: `approve-batch` appears and vanishes on the host's
  tool list via forwarded `toolchange`. This is the part that generalises past one app.
  A page can compose its agent surface out of the apps it embeds, instead of every site
  reimplementing every capability. Trust is explicit rather than ambient: only
  allow-listed host origins are answered, replies target `event.origin` and never `*`,
  and standalone mode installs nothing at all.
- **A production studio, not a toy** — `iris-generate` runs the platform's Visual
  Artisan (AI prompt optimization + a real generation pipeline), and
  `mediaforge-remove-bg` chains a BiRefNet cutout onto any generated image: the agent
  can produce finished, composited artwork — a hero image with a transparent cutout —
  in one turn, with the whole chain visible in the protocol feed.
- **The whole media pipeline, governed** — nine `mediaforge-*` tools put ComfyUI
  (upscale, enhance, restyle, relight, outpaint, critique, storyboard, image-to-video)
  one tool call away from any agent, and the demo governor makes that safe to hand to
  strangers: per-visitor credits, a capped on-demand GPU burst, and a refusal that names
  the free lanes instead of a dead button.

## How WebMCP is implemented

- **Dual-surface registry** (`src/webmcp/registry.ts`): one `ToolRegistry` reconciles
  the design state onto `document.modelContext` when present (real WebMCP) or an
  in-page polyfill (`src/webmcp/polyfill.ts`) elsewhere — the consent tools
  appear/disappear as batches pend and commit, with `toolchange` events. The registry
  records every registration and execution into a bounded **protocol feed** shown in
  the UI.
- **Cross-frame bridge** (`src/embedBridge.ts`): a versioned postMessage protocol
  (`list` / `tools` / `execute` / `result` / unsolicited `toolchange`) that projects the
  studio's live tool surface onto a framing page's `document.modelContext`. Origin
  allow-listed in both directions; the same reconciliation that drives the local surface
  drives the remote one, so the two cannot disagree about which tools exist.
- **A working agent loop** (`src/agent/loop.ts`): Hermes-style `<tools>` /
  `<tool_call>` / `<tool_response>` rendering, lenient parsing for small models
  (trailing-comma repair, brace stutter, truncation recovery with a one-shot
  continuation round), a round cap with an honest "ask me to continue" handoff.
- **Real generation**: `generate-image` runs a 4B flow-matching model + VAE on WebGPU
  in the tab (HTTP-Range weight streaming, batched VAE loads) with a session
  circuit-breaker to the fleet lane; `iris-generate` drives the platform's IRIS
  service; `mediaforge-remove-bg` drives the platform's BiRefNet service — all three
  verified live end-to-end.
- **BYOK**: the visitor can plug in their own OpenAI-compatible agent endpoint and
  image backend — the studio works with any agent, not just ours.
- **Persistence**: designs and pending batches survive reloads (localStorage), so the
  work is the product, not the session.

## Demo video script (≈2:30)

1. **0:00–0:15** — Open studio.aitherium.com in WebMCP-enabled Chrome. The protocol
   feed shows the boot registration burst: 15 tools declared on
   `document.modelContext`; the StatusBar shows the live roster.
2. **0:15–0:35** — Tap the "Iris hero cutout" starter chip. The agent streams
   `create-design` → `iris-generate` (the platform's Visual Artisan optimizes the
   prompt, generates, and reports what it decided) → `mediaforge-remove-bg` (the
   cutout) → headline/tagline.
3. **0:35–1:10** — The canvas fills in live: headline, tagline, a hero image with a
   transparent cutout. Every edit sits in the pending batch — and the protocol feed
   shows `approve-batch` *appear* the moment the batch exists.
4. **1:10–1:40** — Hit **Approve**. Say "make the headline bigger" — watch
   `edit-element` stream, approve again. The toolchange events in the feed show the
   consent tools vanishing as each batch commits.
5. **1:40–2:10** — The production story: the studio's `production-log` tool reads the
   week's real run — "N pieces produced this week" — live evidence
   the studio is a working production surface, not a demo.
6. **2:10–2:30** — Close: agents draft, humans decide, WebMCP makes the contract —
   and the contract is visible on screen the whole time.
