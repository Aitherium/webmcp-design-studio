# WebMCP Challenge submission — WebMCP Design Studio

**Live URL:** https://studio.aitherium.com (GitHub Pages; works in ChatGPT's in-app
browser and in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`)

**Repo:** https://github.com/Aitherium/webmcp-design-studio (MIT)

**Demo video:** [YouTube — WebMCP Design Studio walkthrough](https://www.youtube.com/…) (0:53, with audio; source `demo/webmcp-demo-2026-09-02.mp4`)

---

## Why this is a strong fit for WebMCP

WebMCP's promise is that a website *declares* what agents can do instead of forcing
agents to guess. The studio is built entirely around that declaration: every capability
of the design tool is registered on `document.modelContext.registerTool()` — **18 tools**
covering the whole creative loop across eleven families:

- **Designs**: `create-design`, `duplicate-design`, `list-designs`, `get-design-state`
- **Elements**: `add-text`, `edit-element`, `remove-element`
- **Images**: `generate-image` (on-device WebGPU / fleet / BYOK), `iris-generate` (the
  IRIS Visual Artisan — AI prompt-optimization + generation), `mediaforge-remove-bg`
  (BiRefNet background removal, three hops through the platform)
- **Style + export**: `restyle-design`, `export-design` (PNG/JPEG 1x/2x)
- **Consent**: `approve-batch`, `undo`
- **Memory**: `remember-preference`, `recall-preference`
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
- **A production studio, not a toy** — `iris-generate` runs the platform's Visual
  Artisan (AI prompt optimization + a real generation pipeline), and
  `mediaforge-remove-bg` chains a BiRefNet cutout onto any generated image: the agent
  can produce finished, composited artwork — a hero image with a transparent cutout —
  in one turn, with the whole chain visible in the protocol feed.

## How WebMCP is implemented

- **Dual-surface registry** (`src/webmcp/registry.ts`): one `ToolRegistry` reconciles
  the design state onto `document.modelContext` when present (real WebMCP) or an
  in-page polyfill (`src/webmcp/polyfill.ts`) elsewhere — the consent tools
  appear/disappear as batches pend and commit, with `toolchange` events. The registry
  records every registration and execution into a bounded **protocol feed** shown in
  the UI.
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
