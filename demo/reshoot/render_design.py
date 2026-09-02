"""Render the captured design state to PNG and composite it into the live
screenshots. The headless container's fabric export comes back half-scale and
offset (measured 2026-09-02), so the frames are drawn from the SAME element
records the tools produced (design-state.json) plus the generated image bytes
the fetch hook captured (image.png). Nothing here invents content.

Outputs: design.png (1080x1440), f1-pending.png / f2-approved.png with the
design composited into the canvas frame, final-design.png (= design.png).
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FONTS = {"normal": ROOT / ".spike" / ".fonts" / "segoeui.ttf", "bold": ROOT / ".spike" / ".fonts" / "seguisb.ttf"}


def load_state() -> dict:
    outer = json.loads((HERE / "design-state.json").read_text(encoding="utf-8"))
    return json.loads(outer["content"][0]["text"])["design"]


def render(design: dict) -> Image.Image:
    w, h = design["size"]["width"], design["size"]["height"]
    canvas = Image.new("RGBA", (w, h), design.get("background") or "#ffffff")
    d = ImageDraw.Draw(canvas)
    for el in sorted(design["elements"], key=lambda e: e.get("zIndex", 0)):
        if el["type"] == "image":
            src = HERE / "image.png"
            if src.exists():
                im = Image.open(src).convert("RGBA").resize((el["width"], el["height"]), Image.LANCZOS)
                canvas.alpha_composite(im, (el["x"], el["y"]))
        elif el["type"] == "text":
            font = ImageFont.truetype(str(FONTS["bold" if el.get("fontWeight") == "bold" else "normal"]), el["fontSize"])
            text = el["text"]
            tw = d.textlength(text, font=font)
            align = el.get("align", "left")
            x = el["x"] + ((el["width"] - tw) / 2 if align == "center" else (el["width"] - tw) if align == "right" else 0)
            d.text((x, el["y"]), text, font=font, fill=el.get("fill") or "#222")
    return canvas


def composite(frame_name: str, design: Image.Image) -> None:
    shot = Image.open(HERE / f"{frame_name}.png").convert("RGB")
    c = json.loads((HERE / f"{frame_name}.rect.json").read_text(encoding="utf-8"))
    w = round(c["w"])
    h = round(design.height * (w / design.width))
    scaled = design.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    layer.paste(scaled, (round(c["x"]), round(c["y"])), scaled)
    clip = Image.new("L", shot.size, 0)
    ImageDraw.Draw(clip).rectangle(
        (round(c["cx"]), round(c["cy"]), round(c["cx"] + c["cw"]), round(c["cy"] + c["ch"])), fill=255)
    shot.paste(layer, (0, 0), Image.composite(layer.split()[3], Image.new("L", shot.size, 0), clip))
    shot.save(HERE / f"{frame_name}.png")
    print("composited", frame_name)


if __name__ == "__main__":
    design = render(load_state())
    design.convert("RGB").save(HERE / "design.png")
    design.convert("RGB").save(HERE / "final-design.png")
    for name in ("f1-pending", "f2-approved"):
        if (HERE / f"{name}.rect.json").exists():
            composite(name, design)
    print("design", design.size)
