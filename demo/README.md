# WebMCP Design Studio — demo clip

`webmcp-demo.mp4` — 20.5s, 1600×900, 25 fps, H.264, ~2.8 MB.
Shot against the LIVE product at https://studio-preview.aitherium.com
(the Cloudflare-tunnel-served preview; the same build as the submission URL).

## What it shows (the WebMCP story, in order)

1. Title card — "WebMCP / DESIGN STUDIO — the browser is the tool runtime"
2. The studio loads; the agent's opening hand of tools is registered on the page
   (`list-designs`, `create-design`, `remember-preference`, `recall-preference`,
   `undo`) via `document.modelContext.registerTool`
3. `create-design` — the agent draws a flyer frame on the fabric canvas
4. `add-text` — GRAND OPENING lands on the canvas (pending batch)
5. `add-text` — the details join the composition
6. `edit-element` — a live restyle, no refresh
7. Brand card — studio.aitherium.com · WebMCP Challenge 2026

Every tool call in the clip goes through the REAL surface:
`getTools()` → `executeTool(RegisteredTool, JSON.stringify(args))` (Chrome 152
signature). The tool panel and canvas are the actual running app.

## Reproducing

```bash
# 1. capture the frames (needs the aither-browser service + the preview route live)
node .spike/demo-capture.mjs          # → .spike/demo-frames/f0..f5.jpg

# 2. assemble the clip (needs ffmpeg on the host)
python .spike/demo-assemble.py        # → demo/webmcp-demo.mp4
```

The capture script drives the app with a real browser session (`gpu: true` —
the WebGPU flag set, so the studio's tier detection runs) and waits for the
tool registry to reconcile after each mutation, so a re-capture is stable.

Frames: f0 initial · f1 created · f2 title · f3 subtitle · f4 restyled ·
f5 final. The canvas text renders while the batch is pending (verified: the
canvas `toDataURL` gains the GRAND OPENING pixels before `approve-batch`).
