# WebMCP Challenge submission — WebMCP Design Studio

**Live URL:** https://studio.aitherium.com (GitHub Pages; works in ChatGPT's in-app
browser and in Chrome 149+ with WebMCP enabled)

**Repo:** https://github.com/Aitherium/webmcp-design-studio (MIT)

---

## Why this is a strong fit for WebMCP

WebMCP's promise is that a website *declares* what agents can do instead of forcing
agents to guess. The studio is built entirely around that declaration: every capability
of the design tool is registered on `document.modelContext.registerTool()` — 14 tools
covering the whole creative loop (`create-design`, `add-text`, `edit-element`,
`generate-image`, `restyle-design`, `export-design`, `undo`, `recall-preference`,
`remember-preference`, and the one no other app has: `approve-batch`).

Two details make it genuine leverage rather than a demo stub:

1. **The human is a first-class tool.** Every agent edit lands as an *uncommitted
   batch*, and committing is itself a WebMCP tool (`approve-batch`) that only exists
   while a batch is pending. The agent's last step is a request for human consent —
   the collaboration is part of the protocol, not an afterthought.
2. **The studio's own in-page agent speaks the same protocol.** The built-in on-device
   Bonsai agent (WebGPU, private) drives the studio through the very same
   `getTools()`/`executeTool()` surface a browser agent would — the app eats its own
   dogfood, so the WebMCP surface is exercised by real traffic, not just test calls.

## How it creates a better user experience

Design tools are overloaded with features; agents remove the *interface* without
removing the *control*. A person says "yard sale flyer, spring theme" and the agent
drafts the whole thing — but nothing is committed until the person approves, so the
human stays the art director: approve, nudge with natural language ("make the headline
bigger"), or undo. Images generate **on-device via WebGPU** (a 4B image model in the
tab — nothing leaves the machine) or fall back to a hosted service, and every tool call
is visible in the transcript with its result, so the process is legible, not magic.

## What people and agents can do together that was hard or impossible before

- **Sketch-speed iteration in natural language** — a non-designer describes a poster,
  an agent lays out typography, imagery and palette in seconds, and the human refines
  with sentences instead of menus.
- **A consent-aware creative agent** — the agent can do *everything* except the one
  thing that should always stay human: the final say. `approve-batch` encodes that
  boundary into the tool surface itself, so any WebMCP agent inherits it.
- **The same workspace, any agent** — ChatGPT's browser agent, the studio's on-device
  agent, and (via the registry) any future WebMCP agent all drive the identical
  surface, with the design state reconciled live between them.

## How WebMCP is implemented

- **Dual-surface registry** (`src/webmcp/registry.ts`): one `ToolRegistry` reconciles
  the design state onto `document.modelContext` when present (real WebMCP) or an
  in-page polyfill (`src/webmcp/polyfill.ts`) elsewhere — tools appear/disappear as
  the design state changes, with `toolchange` events.
- **A working agent loop** (`src/agent/loop.ts`): Hermes-style `<tools>` /
  `<tool_call>` / `<tool_response>` rendering, lenient parsing for small models,
  a round cap with an honest "ask me to continue" handoff, and a one-shot
  continuation round for truncated calls.
- **Real generation**: `generate-image` runs a 4B flow-matching model + VAE on WebGPU
  in the tab (f32 reference kernels, HTTP-Range weight streaming, batched VAE loads),
  falling back to a fleet service — both verified live.
- **Persistence**: designs and pending batches survive reloads (localStorage), so the
  work is the product, not the session.

## Demo video script (≈2:30)

1. **0:00–0:20** — Open studio.aitherium.com in ChatGPT's in-app browser. The tool list
   panel shows 14 live tools; the transcript is empty.
2. **0:20–0:40** — Click the "Car wash poster" starter chip (or ask in plain language).
   The agent's tool calls stream in: `create-design` → `add-text` → `generate-image`.
3. **0:40–1:10** — The canvas fills in live: headline, tagline, a hero image (generated
   on-device or via the fallback). Every edit shows as an uncommitted batch.
4. **1:10–1:40** — Hit **Approve**. Say "make the headline bigger" — watch the agent
   call `edit-element`, then approve again. Optionally export the final PNG.
5. **1:40–2:20** — The twist: open the same URL with WebMCP off. The built-in on-device
   agent drives the exact same workflow through the polyfill — same tools, same loop.
6. **2:20–2:30** — Close: agents draft, humans decide, WebMCP makes the contract.
