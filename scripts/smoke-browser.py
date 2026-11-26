"""Browser smoke test for the compiled example pages (repository tooling, not part of the skill).

Loads every examples/*.html in headless Chromium the way T3 Code's html_render frames it
(theme variables from scripts/t3-theme.json injected at the top of <head>, clipboard denied like
the sandboxed iframe), clicks the real controls and checks that the DOM state changes:

  <ib-stepper>  Next / Prev / dots / Play / All, linked highlight on flow nodes and lane steps
  <ib-picker>   group filter, Shortlist / Skip, short note, zoom dialog and paging, copy fallback
  hover         a flow node lights its peers in other figures and clears on leave

Every run also fails on any pageerror or console.error, and at 390px on document-level
horizontal overflow (<ib-flow> scrolls inside its own card, which is allowed).

  python3 scripts/smoke-browser.py                      # examples/, 728 dark + 728 light + 390 dark
  python3 scripts/smoke-browser.py --examples /path/dir # another folder of compiled pages

Needs: pip install playwright && python3 -m playwright install chromium. Exit code 1 on any failure.
"""
import argparse, json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
THEME = json.loads((Path(__file__).resolve().parent / "t3-theme.json").read_text(encoding="utf-8"))
ORIGIN = "http://inline-brief.test/"
CONFIGS = [(728, 900, "dark"), (728, 900, "light"), (390, 844, "dark")]

# html_render iframes cannot write the clipboard; make the page take its plain-text fallback
SANDBOX = """(() => {
  const deny = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
  try { Object.defineProperty(navigator, "clipboard", { value: { writeText: deny }, configurable: true }); } catch {}
  document.execCommand = () => false;
})();"""


def theme_css(name):
    vars_ = "".join(f"{k}:{v};" for k, v in THEME[name].items())
    return f":root{{color-scheme:{name};{vars_}}}{THEME['baseCss']}"


def framed(html, appearance):
    """Insert the theme style first in <head>, as html_render's bootstrap does."""
    style = f'<style id="t3-theme">{theme_css(appearance)}</style>'
    i = html.find("<head>")
    return html[: i + 6] + style + html[i + 6 :] if i >= 0 else style + html


def open_page(browser, path, width, height, appearance):
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console.error: {m.text}"))
    page.add_init_script(SANDBOX)
    html = framed(path.read_text(encoding="utf-8"), appearance)
    page.route(ORIGIN + "**", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html))
    page.goto(ORIGIN + path.name, wait_until="load")
    return page, errors


class Checks:
    def __init__(self):
        self.failed = []

    def __call__(self, name, ok, detail=""):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}{'  ' + detail if detail else ''}", flush=True)
        if not ok:
            self.failed.append(name)


def lit(page, selector):
    return page.eval_on_selector_all(selector, "els => els.map(e => e.dataset.focus + (e.classList.contains('ib-lit') ? '+' : e.classList.contains('ib-dim') ? '-' : '='))")


def check_hover(page, check):
    nodes = page.locator("g.ib-node[data-focus]")
    if not nodes.count():
        return
    node = nodes.nth(nodes.count() - 1)
    key = node.get_attribute("data-focus")
    node.hover()
    page.wait_for_timeout(200)
    others = page.locator(f"[data-focus]:not(g.ib-node)").evaluate_all(
        "(els, k) => els.filter(e => e.dataset.focus.split(',').map(s => s.trim()).includes(k)).map(e => e.classList.contains('ib-lit'))", key)
    dimmed = page.locator("g.ib-node.ib-dim").count()
    check(f"hover node '{key}' lights peers", bool(others) and all(others) and dimmed > 0, f"{sum(others)}/{len(others)} peers lit, {dimmed} nodes dimmed")
    page.mouse.move(1, 1)
    page.wait_for_timeout(200)
    check("leaving the node clears highlight", page.locator(".ib-lit, .ib-dim").count() == 0)


def check_stepper(page, check):
    root = page.locator(".ib-stepper").first
    if not root.count():
        return
    title = root.locator(".ib-stage-title")
    total = root.locator(".ib-dot").count()
    check("stepper starts at step 1", title.inner_text().startswith(f"1/{total}"), title.inner_text())
    root.locator('[data-act="next"]').click()
    want = root.locator(".ib-stage-data").nth(1).get_attribute("data-stage-focus").split(",")
    check("Next goes to step 2", title.inner_text().startswith(f"2/{total}"), title.inner_text())
    nodes = lit(page, "g.ib-node[data-focus]")
    on = sorted(n[:-1] for n in nodes if n.endswith("+"))
    check("Next lights the stage's flow nodes", on == sorted(k for k in want if any(n[:-1] == k for n in nodes)), f"lit {on}, stage {want}")
    check("Next lights lane steps", page.locator(".ib-step.ib-lit").count() > 0 and page.locator(".ib-step.ib-dim").count() > 0)
    root.locator('[data-act="prev"]').click()
    check("Prev goes back to step 1", title.inner_text().startswith(f"1/{total}"), title.inner_text())
    root.locator(".ib-dot").nth(total - 1).click()
    check("dot jumps to the last step", title.inner_text().startswith(f"{total}/{total}"), title.inner_text())
    play = root.locator('[data-act="play"]')
    play.click()
    check("Play starts", play.get_attribute("aria-pressed") == "true", play.inner_text())
    page.wait_for_timeout(2500)
    check("Play advances on its own", title.inner_text().startswith(f"1/{total}"), title.inner_text())
    play.click()
    check("second click pauses", play.get_attribute("aria-pressed") == "false", play.inner_text())
    root.locator('[data-act="reset"]').click()
    check("All clears highlight and returns to step 1", page.locator(".ib-lit, .ib-dim").count() == 0 and title.inner_text().startswith(f"1/{total}"))


def check_picker(page, check):
    root = page.locator(".ib-picker").first
    if not root.count():
        return
    cards = root.locator(".ib-opt")
    n = cards.count()
    visible = lambda: root.locator(".ib-opt:not([hidden])").count()
    pills = root.locator(".ib-pick-pill")
    if pills.count() > 1:
        pills.nth(pills.count() - 1).click()
        grp = pills.nth(pills.count() - 1).get_attribute("data-pick-filter")
        want = root.locator(f'.ib-opt[data-opt-group="{grp}"]').count()
        check(f"filter '{grp}' shows its group only", visible() == want and want < n, f"{visible()}/{n} visible")
        pills.first.click()
        check("filter All shows every card", visible() == n, f"{visible()}/{n}")
    summary = root.locator(".ib-pick-summary")
    first, second = cards.nth(0), cards.nth(1)
    first.locator('[data-pick-act="like"]').click()
    check("Shortlist marks the card", "is-liked" in first.get_attribute("class"))
    second.locator('[data-pick-act="skip"]').click()
    check("Skip marks the card", "is-skipped" in second.get_attribute("class"))
    id1, id2 = first.get_attribute("data-opt-id"), second.get_attribute("data-opt-id")
    text = summary.inner_text()
    check("summary lists shortlist and skip", id1 in text and id2 in text and "|" in text, text)
    note = cards.nth(2).locator("[data-pick-note]")
    note.click()
    note.press_sequentially("tighter copy")
    check("card note reaches the summary", "tighter copy" in summary.inner_text(), summary.inner_text())

    dialog = root.locator(".ib-pick-dialog")
    first.locator("button[data-pick-zoom]").click()
    check("zoom opens the dialog", dialog.evaluate("d => d.open"))
    box = dialog.bounding_box()
    vw, vh = page.viewport_size["width"], page.viewport_size["height"]
    check("dialog fits the viewport", box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= vw and box["y"] + box["height"] <= vh, str(box))
    check("dialog shows the first card", dialog.locator(".ib-pick-dlg-id").inner_text() == id1)
    dialog.locator("[data-dlg-next]").click()
    check("dialog Next pages to the next card", dialog.locator(".ib-pick-dlg-id").inner_text() == id2, dialog.locator(".ib-pick-dlg-pos").inner_text())
    dialog.locator("[data-dlg-close]").click()
    check("close shuts the dialog", not dialog.evaluate("d => d.open"))

    copy = root.locator("[data-pick-copy]")
    copy.click()
    fallback = root.locator(".ib-pick-fallback")
    shown = fallback.is_visible()
    check("copy without clipboard reveals selected plain text", shown and fallback.input_value() == summary.inner_text()
          and fallback.evaluate("e => e.selectionEnd - e.selectionStart") == len(fallback.input_value()), copy.inner_text())
    if root.locator(".ib-opt[data-focus]").count():
        root.locator(".ib-opt[data-focus]").nth(1).locator(".ib-pick-title, .ib-pick-sub").first.hover()
        page.wait_for_timeout(200)
        check("hovering a card lights its linked bar", page.locator(".ib-bar-row.ib-lit").count() == 1)
        page.mouse.move(1, 1)


def run(browser, path, width, height, appearance, check):
    print(f"[{path.name} {width}px {appearance}]", flush=True)
    page, errors = open_page(browser, path, width, height, appearance)
    check("theme variables applied", page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--card').trim()") == THEME[appearance]["--card"])
    check_stepper(page, check)
    check_picker(page, check)
    check_hover(page, check)
    if width < 560:
        sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        check("no document-level horizontal overflow", sw[0] <= sw[1], f"scrollWidth {sw[0]} / clientWidth {sw[1]}")
    check("no page errors", not errors, "; ".join(errors[:3]))
    page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--examples", default=str(ROOT / "examples"), help="folder of compiled .html pages (sources *.src.html are skipped)")
    args = ap.parse_args()
    pages = sorted(p for p in Path(args.examples).glob("*.html") if not p.name.endswith(".src.html"))
    if not pages:
        sys.exit(f"no compiled pages in {args.examples}")
    check = Checks()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for path in pages:
            for width, height, appearance in CONFIGS:
                run(browser, path, width, height, appearance, check)
        browser.close()
    print(f"\n{len(check.failed)} failed: {', '.join(check.failed)}" if check.failed else f"\nall checks passed ({len(pages)} pages x {len(CONFIGS)} views)")
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
