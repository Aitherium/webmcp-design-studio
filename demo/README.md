# WebMCP Design Studio — demo clip

`webmcp-demo-2026-09-02.mp4` — 53 s, 1920×1080, 25 fps, H.264 + AAC, ~4.5 MB.
The Devpost submission video. Voice-over (`vo/vo-1..7.wav`) and music bed
(`vo/bed.wav`) are the Sep 1 recording; every picture was re-shot on 2026-09-02
against the LIVE studio at studio.aitherium.com after the Sep 1 cut was found to
carry character art from an unrelated production pack instead of the flyers and
posters the studio exists to make.

## Beats (in order, with the tool that fires)

| t (s) | frame | what it shows |
|---|---|---|
| 0.0 | `reshoot/card-open.png` | title card on the studio's own spring artwork |
| 6.0 | `reshoot/f0-open.png` | the studio just loaded: 15 tools registered on `document.modelContext`, empty canvas |
| 14.5 | `reshoot/f1-pending.png` | `create-design` → `generate-image` (fleet Sana lane, 17 s) → `add-text` ×3; four edits sit in the PENDING BATCH |
| 21.0 | `reshoot/f2-approved.png` | `approve-batch` — the finished Spring Yard Sale flyer, batch empty |
| 27.5 | `reshoot/pieces-grid.png` | five pieces from the week's production log (`/pieces/*.png`, `production-log.json`) |
| 31.7 | `reshoot/card-production.png` | "A week of real production" |
| 36.0 | `reshoot/card-safety.png` | "The safety ceiling" |
| 43.0 | `reshoot/card-close.png` | close on the flyer artwork |

## How it was made (repeatable)

```
python demo/reshoot/capture.py        # drives the live studio's tools through
                                      # document.modelContext, saves f0/f1/f2 + design state + image
python demo/reshoot/render_design.py  # renders the design from that state, composites it into f1/f2
python demo/reshoot/render_cards.py   # title / production / safety / close cards + pieces grid
python demo/reshoot/assemble.py       # ffmpeg: xfade beats + VO on the beat clock + bed at -20 dB
```

Two honesty notes, both measured 2026-09-02:

- Headless Chrome in the AitherBrowser container omits the canvas layer from
  screenshots, and fabric's own export comes back half-scale and offset there.
  So the canvas content in f1/f2 is rendered from the SAME element records
  `get-design-state` returned (positions, text, fills, the generated image bytes
  captured off the `/api/image/generate` response) — nothing is invented, and the
  UI around it is the real page.
- Every tool call in the capture went through the real surface
  (`document.modelContext.executeTool`), the same path the in-page agent uses;
  the image came from the studio's Fleet lane (Sana) exactly as a judge's would.
