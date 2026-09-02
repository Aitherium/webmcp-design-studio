"""Re-shoot the demo beats against the LIVE studio through AitherBrowser.

Drives the studio's WebMCP tools through document.modelContext (the same
surface the agent uses), takes a screenshot at each beat, and composites the
fabric canvas backing store into the frame — this container's headless Chrome
omits the canvas layer from screenshots (measured 2026-08-26), so the export
path is the only honest source of what the canvas shows.

Transport is curl (internal CA via -k): the service drops a python `requests`
socket between actions (RemoteDisconnected on the 2nd POST, measured
2026-09-02) while curl has never failed against it.

Beats written to demo/reshoot/:
  f0-open.png       the studio just loaded, tools registered, empty canvas
  f1-pending.png    design created, texts + spring artwork landed, batch pending
  f2-approved.png   batch approved — the finished flyer on the canvas
  final-design.png  the canvas export alone (used by the close card)
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

H = "https://localhost:8132"
HERE = Path(__file__).resolve().parent
URL = "https://studio.aitherium.com/"


def _curl(path: str, body: dict | None, timeout: int) -> dict:
    args = ["curl", "-sk", "-m", str(timeout), "-X", "POST", f"{H}{path}",
            "-H", "Content-Type: application/json"]
    tmp = None
    if body is not None:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(body, tmp)
        tmp.close()
        args += ["--data-binary", f"@{tmp.name}"]
    try:
        out = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=timeout + 10)
    finally:
        if tmp:
            os.unlink(tmp.name)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"curl {path} failed rc={out.returncode}: {out.stderr[:200]}")
    return json.loads(out.stdout)


def act(sid: str, body: dict, timeout: int = 180) -> dict:
    return _curl(f"/session/{sid}/act", body, timeout)


def sleep_ms(sid: str, ms: int) -> None:
    """The service's `wait` action resets the connection (curl rc=56, measured
    2026-09-02) while eval works — so wait inside the page instead."""
    ev(sid, f"(async function(){{ await new Promise(function(r){{ setTimeout(r, {ms}); }}); return 'slept'; }})()", ms // 1000 + 30)


def ev(sid: str, js: str, timeout: int = 180):
    out = act(sid, {"action": "eval", "value": js}, timeout)
    if not out.get("ok"):
        raise RuntimeError(f"eval failed: {out.get('error')}")
    return out.get("value")


def screenshot(sid: str) -> Image.Image:
    out = act(sid, {"action": "screenshot"}, 120)
    b64 = out.get("screenshot_base64")
    if not b64:
        raise RuntimeError(f"no image in screenshot response: {str(out)[:200]}")
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


RECT_JS = """(function(){
  var lower = document.querySelector('canvas.design-canvas') || document.querySelector('canvas');
  if (!lower) return {ok:false};
  var r = lower.getBoundingClientRect();
  var sc = lower.closest('.canvas-scroll') || lower.parentElement;
  var cr = sc.getBoundingClientRect();
  return {ok:true, x:r.left, y:r.top, w:r.width, h:r.height, cx:cr.left, cy:cr.top, cw:cr.width, ch:cr.height};
})()"""

HOOK_JS = """(function(){
  if (window.__exportHooked) return 'hooked';
  var orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if (this.download && this.href && this.href.indexOf('data:image') === 0) { window.__lastExport = this.href; return; }
    return orig.apply(this, arguments);
  };
  window.__exportHooked = true; return 'hooked';
})()"""


FETCH_HOOK_JS = """(function(){
  if (window.__fetchHooked) return 'hooked';
  var orig = window.fetch;
  window.fetch = async function(input, init){
    var res = await orig.apply(this, arguments);
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (url.indexOf('/api/image/generate') >= 0) {
        var clone = res.clone();
        clone.json().then(function(j){ if (j && j.images && j.images[0]) window.__lastImage = j.images[0]; }).catch(function(){});
      }
    } catch (e) {}
    return res;
  };
  window.__fetchHooked = true; return 'hooked';
})()"""


def export_design(sid: str) -> bytes | None:
    """The studio's own export-design (full-res, viewport-independent). The
    tool hands the PNG to a download anchor; the hook keeps the data URL."""
    ev(sid, HOOK_JS, 30)
    ev(sid, "window.__lastExport = null", 30)
    tool(sid, "export-design", {"format": "png", "scale": 1, "includePending": True}, timeout=120)
    data = ev(sid, "window.__lastExport", 60)
    if not data:
        return None
    return base64.b64decode(data.split(",", 1)[1])


def composite(sid: str, name: str, with_design: bool = True) -> Image.Image:
    shot = screenshot(sid)
    c = ev(sid, RECT_JS, 60)
    raw = None  # the headless export is wrong (half-scale + offset); frames are rendered from state offline
    if raw and c and c.get("ok"):
        png = Image.open(io.BytesIO(raw)).convert("RGBA")
        (HERE / "final-design.png").write_bytes(raw)
        # fit the export to the canvas element's width (aspect kept), clip to the scroll frame
        w = round(c["w"]); h = round(png.height * (w / png.width))
        png = png.resize((w, h), Image.LANCZOS)
        layer = Image.new("RGBA", shot.size, (0, 0, 0, 0))
        layer.paste(png, (round(c["x"]), round(c["y"])), png)
        clip = Image.new("L", shot.size, 0)
        from PIL import ImageDraw as _D
        _D.Draw(clip).rectangle((round(c["cx"]), round(c["cy"]), round(c["cx"] + c["cw"]), round(c["cy"] + c["ch"])), fill=255)
        shot.paste(layer, (0, 0), Image.composite(layer.split()[3], Image.new("L", shot.size, 0), clip))
    shot.save(HERE / f"{name}.png")
    if c and c.get("ok"):
        (HERE / f"{name}.rect.json").write_text(json.dumps(c), encoding="utf-8")
    print("wrote", name, shot.size, "export:", (len(raw) if raw else None), "rect:", {k: c.get(k) for k in ("x", "y", "w", "h", "ch")} if c else None)
    return shot


def tool(sid: str, name: str, args: dict, timeout: int = 170) -> str:
    """Fire the tool in the page and poll: the service resets any single
    request that runs longer than ~10 s (generate-image is 8-20 s)."""
    import time
    start_js = ("(function(){ window.__toolResult = null;"
                " document.modelContext.executeTool(%s, %s).then(function(v){ window.__toolResult = {ok:true, v:String(v)}; },"
                " function(e){ window.__toolResult = {ok:false, e:String(e && e.message || e)}; }); return 'started'; })()"
                ) % (json.dumps(name), json.dumps(json.dumps(args)))
    ev(sid, start_js, 30)
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        r = ev(sid, "window.__toolResult", 30)
        if r:
            out = r.get("v") if r.get("ok") else "ERROR: " + str(r.get("e"))
            print(f"  {name}: {str(out)[:160]}")
            return str(out)
    raise RuntimeError(f"tool {name} timed out after {timeout}s")


def main() -> int:
    sid = _curl("/session/open", {"url": URL, "headless": True}, 90)["session_id"]
    try:
        sleep_ms(sid, 7000)
        n = ev(sid, "(async function(){ var t = await document.modelContext.getTools(); return t.length; })()")
        print("tools registered:", n)
        composite(sid, "f0-open", with_design=False)

        tool(sid, "create-design", {"name": "Spring Yard Sale", "size": "poster", "palette": "paper", "background": "#f6f8f0"})
        ev(sid, FETCH_HOOK_JS, 30)
        tool(sid, "generate-image", {
            "prompt": "spring yard sale flyer illustration, a tidy front lawn with a folding table of books, a bicycle and "
                      "potted tulips, soft morning light, pastel greens and yellows, flat vector poster style, no text, no people",
            "style": "illustration", "size": "tall"}, timeout=240)
        tool(sid, "add-text", {"text": "SPRING YARD SALE", "fontSize": 104, "align": "center", "bold": True,
                               "color": "#1d3b2a", "y": 56})
        tool(sid, "add-text", {"text": "Saturday · 8am–2pm · 14 Orchard Lane", "fontSize": 40, "align": "center",
                               "color": "#2f4a3a", "y": 1262})
        tool(sid, "add-text", {"text": "furniture · bikes · books · plants · toys", "fontSize": 32, "align": "center",
                               "color": "#5a6b5e", "y": 1338})
        sleep_ms(sid, 2500)
        img = ev(sid, "window.__lastImage", 60)
        if img:
            (HERE / "image.png").write_bytes(base64.b64decode(img.split(",", 1)[-1]))
            print("image bytes:", len(img))
        composite(sid, "f1-pending")

        tool(sid, "approve-batch", {})
        sleep_ms(sid, 2500)
        composite(sid, "f2-approved")
        state = ev(sid, "(async function(){ return await document.modelContext.executeTool('get-design-state', '{}'); })()")
        (HERE / "design-state.json").write_text(str(state), encoding="utf-8")
        # the image element's pixels: the store holds them; pull every image src by element id
        srcs = ev(sid, """(function(){ try { var st = null;
          var root = document.getElementById('root');
          var k = Object.keys(root).find(function(x){ return x.indexOf('__reactContainer') === 0; });
          return 'react-only'; } catch(e) { return 'ERR ' + e; } })()""", 30)
        print("state bytes:", len(str(state)))
        return 0
    finally:
        _curl(f"/session/{sid}/close", None, 30)


if __name__ == "__main__":
    sys.exit(main())
