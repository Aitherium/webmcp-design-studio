# WebMCP Design Studio — Devpost submission draft (2026-09-01)

**What it is:** a browser agent co-creates designs with a person through the
WebMCP protocol — 16 tools, every interaction visible, every edit gated on
human approval. And for a week it ran as a real production studio, rendering
the Dark Matters cast through a safety-screened pipeline, every piece logged.

## WebMCP Leverage
- 16 tools over registerTool / getTools / executeTool — a real protocol surface,
  not a demo stub: tools register and unregister mid-session (the roster changes
  15→16→15 as consent state opens and closes), and every call is visible.
- **The ProtocolFeed**: every protocol event — register, toolchange, execute
  with input + elapsed time — streams into a live monospace scrollback. The
  protocol isn't a black box; it's the UI.
- **approve-batch consent**: the agent never acts alone. Edits queue as a
  batch; the human sees exactly what will change and approves or edits first.
  This is the strongest claim in the demo: real consent, not a fake toggle.

## Execution
- The studio ran for a week as a **production studio**: the Dark Matters
  routine rendered the cast daily through the same media-forge pipeline the
  demo's iris lane drives — one pipeline, two doors.
- The production log is a WebMCP tool: ask the agent "what did the studio
  produce?" and it returns the real week's ledger.
- The pipeline is **safety-screened end to end**: every rendered piece is
  rated by a vision model before it may count as produced; anything above
  "safe" is refused and paged. The ceiling is fail-closed — a dead rater
  refuses rather than passes. Measured live: the screen refused two renders
  outright during the week.
- Queue discipline: a wedged render lane refuses submissions instead of
  piling on (the 2026-08-31 wedge class — 40 jobs / 35 errored — is a gate,
  not a memory).

## Potential Impact
- A WebMCP-driven studio that **produces real content autonomously** — not a
  chat demo. The week's exhibit: 6 characters, safety-screened, live on the
  public site.
- The pattern generalizes: any design pipeline (comic pages, film boards,
  product shots) can be driven by the same protocol + consent + safety
  stack. The safety ceiling — an output-side rater on every render — is the
  piece every generative product needs and almost none have.

## Creativity & Ambition
- The DM production lane: a scheduled routine renders the cast daily, asserts
  each piece, and pages on silence (zero successful renders in 24h = a dead
  lane, whatever the healthchecks say).
- The protocol feed + approve-batch consent make the agent's work legible and
  human-gated — the inverse of the autonomous-agent black box.
- The whole thing runs on a real fleet: ComfyUI on a 5090, a DGX vision
  rater, a safety ceiling, and a production log judges can open.

## Links
- Live studio: studio.aitherium.com
- Production log: public/production-log.json (in this repo)
- The safety ceiling: media-forge commit 17ad609 + a68c2cc (fail-closed
  output screen on every recipe head and the single-op lane)
