"""Cut the demo from the re-shot beats: on-brief cards + live captures + the
original voice-over and music bed. 1920x1080, H.264 + AAC, ~52 s.

Usage: python assemble.py [out.mp4]
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VO = HERE.parent / "vo"
XF = 0.5  # crossfade seconds

# (image, seconds, vo clip or None). VO starts 0.4 s into its beat.
BEATS = [
    ("card-open.png", 6.0, "vo-1.wav"),
    ("f0-open.png", 8.5, "vo-2.wav"),
    ("f1-pending.png", 6.5, "vo-3.wav"),
    ("f2-approved.png", 6.5, "vo-4.wav"),
    ("pieces-grid.png", 4.2, "vo-5.wav"),
    ("card-production.png", 4.3, None),
    ("card-safety.png", 7.0, "vo-6.wav"),
    ("card-close.png", 9.5, "vo-7.wav"),
]


def main(out: Path) -> int:
    for img, _, vo in BEATS:
        assert (HERE / img).exists(), f"missing beat image {img}"
        assert vo is None or (VO / vo).exists(), f"missing {vo}"
    inputs: list[str] = []
    for img, secs, _ in BEATS:
        inputs += ["-loop", "1", "-t", f"{secs + XF:.3f}", "-i", str(HERE / img)]
    vo_inputs = [(i, vo) for i, (_, _, vo) in enumerate(BEATS) if vo]
    for _, vo in vo_inputs:
        inputs += ["-i", str(VO / vo)]
    inputs += ["-i", str(VO / "bed.wav")]
    n = len(BEATS)
    bed_idx = n + len(vo_inputs)

    f: list[str] = []
    # every beat -> 1920x1080: captures are 1366x900 (crop to 16:9 first), cards are native.
    for i in range(n):
        f.append(f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=increase,"
                 f"crop=1920:1080,setsar=1,fps=25,format=yuv420p[v{i}]")
    # xfade chain
    prev = "v0"
    offset = 0.0
    for i in range(1, n):
        offset += BEATS[i - 1][1]
        nxt = f"x{i}" if i < n - 1 else "vout"
        f.append(f"[{prev}][v{i}]xfade=transition=fade:duration={XF}:offset={offset:.3f}[{nxt}]")
        prev = nxt
    total = sum(b[1] for b in BEATS) + XF
    # audio: VO clips delayed to their beat start (+0.4 s), bed under at -20 dB, fade out.
    starts: list[float] = []
    t = 0.0
    for _, secs, _ in BEATS:
        starts.append(t)
        t += secs
    amix_in = []
    for k, (i, _) in enumerate(vo_inputs):
        ms = int((starts[i] + 0.4) * 1000)
        f.append(f"[{n + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={ms}|{ms},volume=1.0[a{k}]")
        amix_in.append(f"[a{k}]")
    f.append(f"[{bed_idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{total:.3f},"
             f"volume=-20dB,afade=t=out:st={total - 3:.3f}:d=3[bed]")
    f.append("".join(amix_in) + f"[bed]amix=inputs={len(amix_in) + 1}:normalize=0:dropout_transition=0[aout]")

    cmd = ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(f),
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
    print("total", round(total, 2), "s; beats:", [(b[0], b[1]) for b in BEATS])
    subprocess.run(cmd, check=True)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "webmcp-demo-2026-09-02.mp4"))
