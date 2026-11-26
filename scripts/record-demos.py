"""Record the README interaction clips as looping animated WebP (repository tooling, not part of the skill).

Each clip loads a compiled examples/*.html in headless Chromium the way T3 Code's html_render frames
it (theme variables from scripts/t3-theme.json first in <head>, clipboard denied like the sandboxed
iframe), then plays a short script of real mouse and keyboard input. The page clock is virtual:
setTimeout, setInterval, requestAnimationFrame, performance.now, Date.now and CSS transitions advance
exactly one frame per screenshot, so timing is exact however slow the capture is. The cursor and its
click ripple are drawn onto each frame with Pillow, because a page element cannot sit above a modal
<dialog> in the top layer.

  python3 scripts/record-demos.py                          # both clips into docs/images/
  python3 scripts/record-demos.py picker --frames /tmp/f   # one clip, plus every 5th frame as PNG

Needs: pip install playwright pillow && python3 -m playwright install chromium (Pillow with WebP).
"""
import argparse, hashlib, io, json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
THEME = json.loads((Path(__file__).resolve().parent / "t3-theme.json").read_text(encoding="utf-8"))
ORIGIN = "http://inline-brief.test/"
PAGE_W = 728                 # T3 desktop thread width
SCALE = 760 / PAGE_W         # device scale: the page renders straight at 760px, no resampling
PAD, HEAD, FOOT = 20, 34, 18  # thread canvas around the frame, in output px
FONTS = ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/segoeui.ttf"]

SANDBOX = """(() => {
  const deny = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
  try { Object.defineProperty(navigator, "clipboard", { value: { writeText: deny }, configurable: true }); } catch {}
  document.execCommand = () => false;
})();"""

CLOCK = """(() => {
  let vt = performance.now();
  const dateOffset = Date.now() - vt;
  const frames = new Map(); let fid = 1;
  const timers = new Map(); let tid = 1;
  performance.now = () => vt;
  Date.now = () => Math.round(dateOffset + vt);
  window.requestAnimationFrame = (cb) => { frames.set(fid, cb); return fid++; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  const add = (fn, ms, a, every) => { timers.set(tid, { at: vt + Math.max(0, +ms || 0), fn, a, every }); return tid++; };
  window.setTimeout = (fn, ms, ...a) => add(fn, ms, a, 0);
  window.setInterval = (fn, ms, ...a) => add(fn, ms, a, Math.max(1, +ms || 0));
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.__step = (dt) => {
    const end = vt + dt;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      vt = Math.max(vt, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      try { t.fn(...t.a); } catch (e) { console.error(e); }
    }
    vt = end;
    const cbs = [...frames.values()]; frames.clear();
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } }
    for (const an of document.getAnimations()) {
      if (an.__v0 === undefined) { an.__v0 = vt - dt; an.pause(); }
      const t = vt - an.__v0, done = an.effect ? an.effect.getComputedTiming().endTime : 0;
      if (t >= done) an.finish(); else an.currentTime = t;
    }
  };
})();"""


def theme_css(name):
    return ":root{color-scheme:%s;%s}%s" % (name, "".join(f"{k}:{v};" for k, v in THEME[name].items()), THEME["baseCss"])


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ease(k):
    k = min(max(k, 0.0), 1.0)
    return 4 * k * k * k if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2


def font(size):
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def cursor_sprite(k=4):
    """Arrow with a white keyline, drawn at k x and downsampled for clean edges; tip at (3, 2)."""
    pts = [(3, 2), (3, 23), (8.6, 17.8), (12.4, 26.6), (16.2, 25), (12.5, 16.4), (20, 16.4)]
    big = Image.new("RGBA", (26 * k, 30 * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.polygon([(x * k, y * k) for x, y in pts], fill=(22, 27, 38, 255), outline=(255, 255, 255, 255), width=int(1.8 * k))
    return big.resize((26, 30), Image.LANCZOS)


class Director:
    """Turns a demo script into frames: each yield is one frame, real input happens between yields."""

    def __init__(self, page, fps):
        self.page, self.fps = page, fps
        self.x, self.y = 600.0, 14.0                            # rest on the title row, off every card
        self.pressed, self.ring_t, self.t = False, -9.0, 0.0
        self.theme, self.fade = "dark", 0

    def frames(self, seconds):
        return max(1, round(seconds * self.fps))

    def rect(self, selector, nth=0):
        box = self.page.locator(selector).nth(nth).bounding_box()
        if not box:
            sys.exit(f"target not visible: {selector} [{nth}]")
        return box

    def wait(self, seconds):
        for _ in range(self.frames(seconds)):
            yield

    def move(self, selector, seconds=0.6, nth=0, at=(0.5, 0.5)):
        box = self.rect(selector, nth)
        x0, y0 = self.x, self.y
        x1, y1 = box["x"] + box["width"] * at[0], box["y"] + box["height"] * at[1]
        n = self.frames(seconds)
        dist = math.hypot(x1 - x0, y1 - y0) or 1.0
        for i in range(1, n + 1):
            k = ease(i / n)
            lift = math.sin(math.pi * k) * 0.05 * dist        # a soft arc, not a ruler line
            self.x = x0 + (x1 - x0) * k - (y1 - y0) / dist * lift
            self.y = y0 + (y1 - y0) * k + (x1 - x0) / dist * lift * 0.5
            self.page.mouse.move(self.x, self.y)
            yield

    def click(self, hold=0.1):
        self.page.mouse.down()
        self.pressed, self.ring_t = True, self.t
        yield from self.wait(hold)
        self.page.mouse.up()
        self.pressed = False
        yield

    def type(self, text, cps=16):
        for ch in text:
            self.page.keyboard.type(ch)
            yield from self.wait(1 / cps)

    def scroll(self, to_y, seconds=0.7):
        y0 = self.page.evaluate("scrollY")
        n = self.frames(seconds)
        for i in range(1, n + 1):
            self.page.evaluate("(y) => scrollTo(0, y)", y0 + (to_y - y0) * ease(i / n))
            yield

    def set_theme(self, name, seconds=0.45):
        self.page.evaluate("(css) => { document.getElementById('t3-theme').textContent = css; }", theme_css(name))
        self.theme, self.fade = name, self.frames(seconds)
        yield


def picker_demo(d):
    page = d.page
    page.evaluate("scrollTo(0, document.querySelector('.ib-picker').getBoundingClientRect().top + scrollY - 6)")
    yield from d.wait(0.3)
    yield from d.move(".ib-pick-pill", 0.45, nth=2)
    yield from d.click()
    yield from d.wait(0.45)
    yield from d.move(".ib-pick-pill", 0.35, nth=0)
    yield from d.click()
    yield from d.move('.ib-opt [data-pick-act="like"]', 0.45, nth=0)
    yield from d.click()
    yield from d.move('.ib-opt [data-pick-act="skip"]', 0.45, nth=1)
    yield from d.click()
    yield from d.wait(0.15)
    yield from d.move(".ib-opt button[data-pick-zoom]", 0.45, nth=0)
    yield from d.click()
    yield from d.wait(0.4)
    yield from d.move("[data-dlg-next]", 0.4)
    yield from d.click()
    yield from d.wait(0.5)
    yield from d.move("[data-dlg-close]", 0.3)
    yield from d.click()
    yield from d.move(".ib-opt [data-pick-note]", 0.45, nth=0, at=(0.3, 0.5))
    yield from d.click()
    yield from d.type("warmer palette", cps=22)
    bar = page.evaluate("document.querySelector('.ib-pick-bar').getBoundingClientRect().bottom + scrollY")
    yield from d.scroll(bar + 70 - page.viewport_size["height"], 0.55)
    yield from d.move("[data-pick-copy]", 0.45)
    yield from d.click()
    yield from d.move("[data-pick-copy]", 0.3, at=(0.1, 2.6))   # step aside so the button label stays readable
    yield from d.wait(1.1)


def stepper_demo(d):
    page = d.page
    page.evaluate("scrollTo(0, document.querySelector('.ib-flow-svg').closest('.ib-card').getBoundingClientRect().top + scrollY - 6)")
    yield from d.wait(0.2)
    yield from d.move('[data-act="next"]', 0.45)
    yield from d.click()
    yield from d.wait(0.3)
    yield from d.move('[data-act="play"]', 0.35)
    yield from d.click()
    yield from d.wait(2.3)                                     # Play advances every 2.2 s
    yield from d.click()                                       # pause
    yield from d.move('g.ib-node[data-focus="db"]', 0.5)
    yield from d.wait(0.8)
    yield from d.move(".ib-stepper .ib-stage-title", 0.4)
    yield from d.set_theme("light")
    yield from d.wait(0.8)
    yield from d.move('[data-act="reset"]', 0.4)
    yield from d.click()
    yield from d.wait(0.5)


DEMOS = {
    "picker": ("visual-direction-picker.html", "picker-demo.webp", 560, picker_demo),
    "stepper": ("cache-read-path.html", "stepper-flow-demo.webp", 720, stepper_demo),
}


def compose(shot, d, label, cursor, sprites):
    """Thread canvas + framed page + header + drawn cursor, all in the current theme."""
    v = THEME[d.theme]
    page = Image.open(io.BytesIO(shot)).convert("RGB")
    w, h = page.size
    out = Image.new("RGB", (w + 2 * PAD, h + HEAD + FOOT), rgb(v["--background"]))
    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle((PAD - 6, HEAD - 6, PAD + w + 5, HEAD + h + 5), radius=10, outline=rgb(v["--border"]), width=1)
    out.paste(page, (PAD, HEAD))
    f = sprites["font"]
    draw.text((PAD - 4, HEAD / 2 - 4), "html_render", font=sprites["bold"], fill=rgb(v["--foreground"]), anchor="lm")
    tw = draw.textlength("html_render  ", font=sprites["bold"])
    draw.text((PAD - 4 + tw, HEAD / 2 - 4), label, font=f, fill=rgb(v["--muted-foreground"]), anchor="lm")
    pill = f"T3 theme · {d.theme.capitalize()}"
    pw = draw.textlength(pill, font=f) + 18
    x1 = PAD + w + 4
    draw.rounded_rectangle((x1 - pw, HEAD / 2 - 15, x1, HEAD / 2 + 7), radius=11, fill=rgb(v["--secondary"]), outline=rgb(v["--border"]))
    draw.text((x1 - pw / 2, HEAD / 2 - 4), pill, font=f, fill=rgb(v["--foreground"]), anchor="mm")
    cx, cy = PAD + d.x * SCALE, HEAD + d.y * SCALE
    k = (d.t - d.ring_t) / 0.45
    if 0 <= k <= 1:
        r = 7 + 13 * ease(k)
        ring = Image.new("RGBA", out.size, (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((cx - r, cy - r, cx + r, cy + r), outline=rgb(v["--primary"]) + (int(235 * (1 - k)),), width=3)
        out.paste(ring, (0, 0), ring)
    sprite = sprites["press"] if d.pressed else cursor
    out.paste(sprite, (round(cx - 3), round(cy - 2)), sprite)
    return out


def record(browser, name, fps, frames_dir, out_dir):
    file, out_name, view_h, script = DEMOS[name]
    page = browser.new_page(viewport={"width": PAGE_W, "height": view_h}, device_scale_factor=SCALE)
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console.error: {m.text}"))
    page.add_init_script(SANDBOX)
    page.add_init_script(CLOCK)
    html = (ROOT / "examples" / file).read_text(encoding="utf-8")
    i = html.find("<head>") + 6
    html = html[:i] + f'<style id="t3-theme">{theme_css("dark")}</style>' + html[i:]
    page.route(ORIGIN + "**", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html))
    page.goto(ORIGIN + file, wait_until="load")
    page.evaluate("document.fonts.ready")

    d = Director(page, fps)
    cursor = cursor_sprite()
    sprites = {"press": cursor.resize((23, 26), Image.LANCZOS), "font": font(12), "bold": font(13)}
    dt = 1000 / fps
    images, last = [], None
    page.mouse.move(d.x, d.y)
    for _ in script(d):
        page.evaluate("(dt) => window.__step(dt)", dt)
        shot = page.screenshot(type="png")
        img = compose(shot, d, file, cursor, sprites)
        if d.fade and last is not None:
            img = Image.blend(last, img, 1 / (d.fade + 1))   # theme switch eases over a few frames
            d.fade -= 1
        images.append(img)
        last = img
        d.t += 1 / fps
    page.close()
    if errors:
        sys.exit("page errors while recording:\n" + "\n".join(errors))

    final, first = images[-1], images[0]                       # fade through the canvas colour for a clean loop
    canvas = Image.new("RGB", final.size, rgb(THEME[d.theme]["--background"]))
    images += [Image.blend(final, canvas, k / 3) for k in (1, 2, 3)] + [Image.blend(canvas, first, k / 4) for k in (1, 2, 3)]
    if frames_dir:
        target = Path(frames_dir) / name
        target.mkdir(parents=True, exist_ok=True)
        for n, img in enumerate(images):
            if n % 5 == 0:
                img.save(target / f"f{n:04d}.png")

    frames, durations, prev = [], [], None
    for img in images:                                         # merge identical neighbours into longer frames
        h = hashlib.sha1(img.tobytes()).digest()
        if h == prev:
            durations[-1] += dt
        else:
            frames.append(img)
            durations.append(dt)
            prev = h
    out = Path(out_dir) / out_name
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=[round(x) for x in durations],
                   loop=0, quality=86, method=6, minimize_size=True)
    size = out.stat().st_size
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: {frames[0].size[0]}x{frames[0].size[1]}, "
          f"{len(images)} frames -> {len(frames)} unique, {sum(durations) / 1000:.1f}s, {size / 1048576:.2f} MiB")
    return size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("demos", nargs="*", help=f"any of {', '.join(DEMOS)} (default: all)")
    ap.add_argument("--fps", type=int, default=20)
    ap.add_argument("--frames", default="", help="also write every 5th composed frame as PNG under this folder")
    ap.add_argument("--out", default=str(ROOT / "docs" / "images"))
    args = ap.parse_args()
    unknown = set(args.demos) - set(DEMOS)
    if unknown:
        ap.error(f"unknown demo: {', '.join(sorted(unknown))}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        sizes = [record(browser, name, args.fps, args.frames, args.out) for name in args.demos or DEMOS]
        browser.close()
    if max(sizes) > 1.5 * 1048576:
        sys.exit("a clip is over the 1.5 MiB budget; lower --fps or shorten its script")


if __name__ == "__main__":
    main()
