"""Render the demo's title/close/section cards at 1920x1080 from on-brief art.

Usage: python render_cards.py
Reads the background images listed in CARDS, darkens them, and sets the
house type (Segoe UI Semibold from .spike/.fonts) with the accent underline.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FONT_BOLD = ROOT / ".spike" / ".fonts" / "seguisb.ttf"
FONT_REG = ROOT / ".spike" / ".fonts" / "segoeui.ttf"
W, H = 1920, 1080
ACCENT = (42, 215, 215)

CARDS = {
    "card-open": dict(bg="t1.png", title="WebMCP Design Studio",
                      sub="A browser agent that makes things with you, not for you.", dim=0.62),
    "card-production": dict(bg="p3.png", title="A week of real production",
                            sub="6 pieces · flyers and posters · safety-screened", dim=0.66),
    "card-safety": dict(bg="p5.png", title="The safety ceiling",
                        sub="every render rated before it counts — fail-closed", dim=0.72),
    "card-close": dict(bg="image.png", title="A protocol you can watch.",
                       sub="A studio that produces. A ceiling that holds.", dim=0.62),
}


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    r = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
    x = (img.width - w) // 2
    y = (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def render(name: str, spec: dict) -> Path:
    bg_path = HERE / spec["bg"]
    if bg_path.exists():
        bg = cover(Image.open(bg_path).convert("RGB"), W, H).filter(ImageFilter.GaussianBlur(2))
    else:
        bg = Image.new("RGB", (W, H), (10, 12, 18))
    overlay = Image.new("RGB", (W, H), (8, 10, 16))
    bg = Image.blend(bg, overlay, spec["dim"])
    d = ImageDraw.Draw(bg)
    ft = ImageFont.truetype(str(FONT_BOLD), 92)
    fs = ImageFont.truetype(str(FONT_REG), 40)
    tw = d.textlength(spec["title"], font=ft)
    sw = d.textlength(spec["sub"], font=fs)
    ty = H // 2 - 90
    d.text(((W - tw) / 2, ty), spec["title"], font=ft, fill=(245, 247, 250))
    d.rounded_rectangle(((W - 160) / 2, ty + 118, (W + 160) / 2, ty + 124), radius=3, fill=ACCENT)
    d.text(((W - sw) / 2, ty + 150), spec["sub"], font=fs, fill=(196, 202, 214))
    out = HERE / f"{name}.png"
    bg.save(out)
    return out


def pieces_grid(files: list[tuple[str, str]]) -> Path:
    """Five labelled pieces on the dark ground, the same shape as the old grid."""
    canvas = Image.new("RGB", (W, H), (14, 12, 22))
    d = ImageDraw.Draw(canvas)
    fl = ImageFont.truetype(str(FONT_REG), 30)
    n = len(files)
    tile_w, tile_h = 300, 400
    gap = 40
    total = n * tile_w + (n - 1) * gap
    x0 = (W - total) // 2
    y0 = (H - tile_h) // 2 - 30
    for i, (label, fn) in enumerate(files):
        im = cover(Image.open(HERE / fn).convert("RGB"), tile_w, tile_h)
        x = x0 + i * (tile_w + gap)
        canvas.paste(im, (x, y0))
        d.text((x, y0 + tile_h + 14), label, font=fl, fill=(200, 204, 214))
    out = HERE / "pieces-grid.png"
    canvas.save(out)
    return out


if __name__ == "__main__":
    for name, spec in CARDS.items():
        print("wrote", render(name, spec))
    print("wrote", pieces_grid([
        ("grand opening", "p1.png"), ("farmers market", "p2.png"),
        ("summer concert", "p3.png"), ("bake sale", "p4.png"), ("book club", "p5.png"),
    ]))
