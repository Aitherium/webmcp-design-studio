# WebMCP Design Studio — demo clip

`webmcp-demo.mp4` — 33.2s, 1920×1080, 25 fps, H.264 + AAC, ~6.6 MB.
Produced by the branded teaser pipeline (teaserforge) — the studio's own frames,
the house accent (#2AD7D7), the brand music bed (outrun-tatami). Live shots are
the REAL studio UI at each beat of the demo session, captured in-fleet and
center-cropped to 16:9.

## What it shows (the WebMCP story, in order)

1. Title — WEBMCP DESIGN STUDIO · "an agent-driven design tool"
2. Whisper — "One page. One agent. A canvas it can draw on."
3. LIVE — the empty studio canvas
4. Whisper — "The tools register. The agent gets a hand."
5. LIVE — the canvas created (`create-design`)
6. LIVE — the title lands on the canvas (`add-text`)
7. LIVE — the details join the composition (`add-text`)
8. Whisper — "Then it restyles — live, on the page."
9. LIVE — a live restyle, no refresh (`edit-element`)
10. LIVE — the finished design
11. Brand — studio.aitherium.com · WebMCP Challenge 2026

Every tool call in the clip goes through the REAL surface:
`getTools()` → `executeTool(RegisteredTool, JSON.stringify(args))` (Chrome 152
`document.modelContext.registerTool`), driven by the WebMCP agent in-session.

Source: `.spike/webmcp-studio.spec.json` + `produce.py` (teaserforge pipeline,
`AitherOS/lib/agents/packs/teaserforge/produce.py`).
