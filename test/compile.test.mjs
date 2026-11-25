import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { compileSource, VERSION } from "../skills/inline-brief/scripts/compile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "skills/inline-brief/scripts/compile.mjs");
const DEMOS = ["cache-read-path", "repo-health-audit", "visual-direction-picker"];

const page = (body) => `<ib-page title="T">${body}</ib-page>`;
const trend = (attrs, points) => page(`<ib-trend ${attrs}>${points}</ib-trend>`);
const GOOD_POINTS = `<ib-point label="a" value="1" /><ib-point label="b" value="3" />`;

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "inline-brief-"));
}

for (const name of DEMOS) {
  test(`demo ${name} compiles with zero errors and zero warnings`, () => {
    const res = compileSource(readFileSync(join(ROOT, `examples/${name}.src.html`), "utf8"), {
      baseDir: join(ROOT, "examples"),
    });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings, []);
    assert.ok(res.stats.figures >= 2);
    assert.doesNotMatch(res.html, /https?:\/\//i, "output must stay offline and self-contained");
    assert.match(res.html, /viewBox="0 0 \d+ \d+"/);
  });

  test(`committed ${name}.html matches a fresh compile`, () => {
    const res = compileSource(readFileSync(join(ROOT, `examples/${name}.src.html`), "utf8"), {
      baseDir: join(ROOT, "examples"),
    });
    assert.equal(readFileSync(join(ROOT, `examples/${name}.html`), "utf8"), res.html);
  });
}

test("cache demo has the interactive stepper, a back edge and swimlanes", () => {
  const res = compileSource(readFileSync(join(ROOT, "examples/cache-read-path.src.html"), "utf8"));
  assert.equal(res.stats.interactive, 1);
  assert.match(res.html, /ib-stepper/);
  assert.match(res.html, /ib-lanes/);
  assert.match(res.html, /stroke-dasharray="5,3"/);
});

test("repo demo renders the trend chart with milestone marks", () => {
  const res = compileSource(readFileSync(join(ROOT, "examples/repo-health-audit.src.html"), "utf8"));
  assert.match(res.html, /ib-chart-svg/);
  assert.match(res.html, /v1\.0 release/);
  assert.match(res.html, /CI migrated/);
});

test("trend: valid input renders a themed responsive SVG", () => {
  const res = compileSource(
    trend(
      'title="Stars" note="n" unit="stars" caption="Growth." max="10"',
      `<ib-point label="08-16" value="1" /><ib-point label="08-17" value="4" mark="Reset" tone="info" /><ib-point label="08-18" value="9" />`
    )
  );
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.stats.figures, 1);
  const svg = /<svg class="ib-chart-svg"[\s\S]*?<\/svg>/.exec(res.html)[0];
  assert.match(svg, /viewBox="0 0 560 \d+"/);
  assert.match(svg, /var\(--chart-1\)/);
  assert.match(svg, /var\(--border\)/);
  assert.match(svg, /var\(--muted-foreground\)/);
  assert.match(svg, /var\(--info\)/);
  assert.match(svg, /stroke-dasharray="4,3"/, "milestone line");
  assert.match(svg, />Reset</);
  assert.match(svg, />10</, "explicit max sets the top tick");
  assert.doesNotMatch(svg, /(?:fill|stroke)="#|rgba?\(|hsla?\(/);
  assert.match(res.html, /<span class="ib-unit">stars<\/span>/);
});

test("trend: auto scale picks a nice ceiling above the peak", () => {
  const res = compileSource(trend('title="T" caption="c"', `<ib-point label="a" value="0" /><ib-point label="b" value="31" />`));
  assert.match(res.html, />40</);
  assert.match(res.html, />10</);
});

test("trend: fewer than two points is rejected", () => {
  const res = compileSource(trend('title="T" caption="c"', `<ib-point label="a" value="1" />`));
  assert.ok(res.errors.some((e) => e.includes("<ib-trend>: needs at least 2 <ib-point> (found 1)")));
});

test("trend: negative and non-numeric values are rejected", () => {
  const res = compileSource(trend('title="T" caption="c"', `<ib-point label="a" value="-3" /><ib-point label="b" value="x" />`));
  assert.ok(res.errors.some((e) => e.includes('<ib-point>: value="-3" must be a non-negative number')));
  assert.ok(res.errors.some((e) => e.includes('<ib-point>: value="x" must be a non-negative number')));
});

test("trend: missing value, label and caption are rejected", () => {
  const res = compileSource(trend('title="T"', `<ib-point label="a" /><ib-point value="2" />`));
  assert.ok(res.errors.some((e) => e.includes('value="" must be a non-negative number')));
  assert.ok(res.errors.some((e) => e.includes("<ib-point>: missing label attribute")));
  assert.ok(res.errors.some((e) => e.includes("<ib-trend>: missing required caption attribute")));
});

test("trend: invalid max is rejected", () => {
  const low = compileSource(trend('title="T" caption="c" max="2"', GOOD_POINTS));
  assert.ok(low.errors.some((e) => e.includes('max="2" is below the largest value 3')));
  const zero = compileSource(trend('title="T" caption="c" max="0"', GOOD_POINTS));
  assert.ok(zero.errors.some((e) => e.includes('max="0" must be > 0')));
});

test("trend: overlapping marks raise a warning, not an error", () => {
  const res = compileSource(
    trend(
      'title="T" caption="c"',
      `<ib-point label="a" value="1" mark="Long milestone one" /><ib-point label="b" value="2" mark="Long milestone two" /><ib-point label="c" value="3" /><ib-point label="d" value="4" /><ib-point label="e" value="5" /><ib-point label="f" value="6" /><ib-point label="g" value="7" />`
    )
  );
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => w.includes("may overlap the previous mark")));
});

test("gates 1+2: viewport height units and html/body height:100% are rejected", () => {
  const res = compileSource(page("<style>body { min-height: 100vh; height: 100%; } .a { height: 50dvh; }</style>"));
  assert.ok(res.errors.some((e) => e.includes('viewport height unit "100vh" forbidden')));
  assert.ok(res.errors.some((e) => e.includes('viewport height unit "50dvh" forbidden')));
  assert.ok(res.errors.some((e) => e.includes("height: 100% on html/body forbidden")));
});

test("gate 3: external links, scripts, imports and url() are rejected", () => {
  const res = compileSource(
    page(`<link rel="stylesheet" href="https://fonts.example/css" />
<script src="https://cdn.example/x.js"></script>
<style>@import url("https://fonts.example/a.css"); .x { background: url(https://img.example/a.png); }</style>`)
  );
  for (const msg of ["external <link> URL forbidden", "external <script src> URL forbidden", "external CSS @import URL forbidden", "external CSS url() forbidden"]) {
    assert.ok(res.errors.some((e) => e.includes(msg)), msg);
  }
});

test("gate 4: hardcoded colors in custom <style> are rejected, var() is allowed", () => {
  const bad = compileSource(page("<style>.x { color: #ff00aa; background: rgb(1,2,3); border-color: hsl(10 20% 30%); }</style>"));
  assert.ok(bad.errors.some((e) => e.includes('hardcoded color "#ff00aa"')));
  assert.ok(bad.errors.some((e) => e.includes('hardcoded color "rgb("')));
  assert.ok(bad.errors.some((e) => e.includes('hardcoded color "hsl("')));
  const ok = compileSource(page("<style>.x { color: var(--foreground); }</style>"));
  assert.deepEqual(ok.errors, []);
  assert.match(ok.html, /\.x \{ color: var\(--foreground\); \}/);
});

test("gate 5: raw <svg> without viewBox is rejected", () => {
  const res = compileSource(page('<svg width="10" height="10"><rect width="10" height="10" /></svg>'));
  assert.ok(res.errors.some((e) => e.includes("raw <svg> missing viewBox attribute")));
  assert.deepEqual(compileSource(page('<svg viewBox="0 0 10 10"></svg>')).errors, []);
});

test("gate 6 (bars): invalid bar values and max are rejected", () => {
  const res = compileSource(page('<ib-bars title="B" unit="ms" max="0"><ib-bar label="neg" value="-5"></ib-bar></ib-bars>'));
  assert.ok(res.errors.some((e) => e.includes('<ib-bar>: value="-5" must be a non-negative number')));
  assert.ok(res.errors.some((e) => e.includes('<ib-bars>: max="0" must be > 0')));
});

test("gate 6 (flow): dangling edges, duplicate ids and uncaptioned flows are rejected", () => {
  const res = compileSource(
    page(`<ib-flow title="F">
  <ib-node id="a" col="1" row="1">A</ib-node>
  <ib-node id="a" col="2" row="1">A2</ib-node>
  <ib-edge from="ghost" to="a" label="calls"></ib-edge>
  <ib-edge from="a" to="phantom" label="calls"></ib-edge>
</ib-flow>`)
  );
  assert.ok(res.errors.some((e) => e.includes("<ib-flow>: missing required caption attribute")));
  assert.ok(res.errors.some((e) => e.includes('<ib-node id="a">: duplicate node id')));
  assert.ok(res.errors.some((e) => e.includes('<ib-edge>: unknown from="ghost"')));
  assert.ok(res.errors.some((e) => e.includes('<ib-edge>: unknown to="phantom"')));
});

test("errors carry the source line of the offending block even when blocks repeat", () => {
  const block = `<ib-bars title="B" unit="ms"><ib-bar label="x" value="-1"></ib-bar></ib-bars>`;
  const res = compileSource(`<ib-page title="T">\n${block}\n${block}\n</ib-page>`);
  assert.ok(res.errors.some((e) => e.startsWith("line 2 ")));
  assert.ok(res.errors.some((e) => e.startsWith("line 3 ")));
});

test("warning: edge label wider than the horizontal gap", () => {
  const res = compileSource(
    page(`<ib-flow title="F" caption="c">
  <ib-node id="a" col="1" row="1">A</ib-node>
  <ib-node id="b" col="2" row="1">B</ib-node>
  <ib-edge from="a" to="b" label="a very long edge label"></ib-edge>
</ib-flow>`)
  );
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => w.includes("exceeds horizontal gap")));
});

test("unknown or misplaced <ib-*> tags are rejected", () => {
  const res = compileSource(page(`<ib-kpi label="x" value="1"></ib-kpi>`));
  assert.ok(res.errors.some((e) => e.includes("unknown or misplaced <ib-kpi")));
});

test("quoted attribute values may contain '>'", () => {
  const res = compileSource(page(`<ib-kpis><ib-kpi label="a" value="1" sub="> 7 d"></ib-kpi></ib-kpis>`));
  assert.deepEqual(res.errors, []);
  assert.match(res.html, /&gt; 7 d/);
});

test("CLI --check: exit 0 on a good page without writing output", () => {
  const dir = tmpDir();
  const src = join(dir, "ok.src.html");
  writeFileSync(src, trend('title="T" caption="c"', GOOD_POINTS));
  const r = spawnSync(process.execPath, [CLI, src, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK .*\(check only\)/);
  assert.equal(existsSync(join(dir, "ok.html")), false);
});

test("CLI --check: exit 1 on a bad page and no output is written", () => {
  const dir = tmpDir();
  const src = join(dir, "bad.src.html");
  writeFileSync(src, page("<style>body { height: 100%; }</style>"));
  const r = spawnSync(process.execPath, [CLI, src, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR line \d+: height: 100% on html\/body forbidden/);
  assert.match(r.stderr, /FAIL +1 error\(s\)/);
  const r2 = spawnSync(process.execPath, [CLI, src], { encoding: "utf8" });
  assert.equal(r2.status, 1);
  assert.equal(existsSync(join(dir, "bad.html")), false);
});

test("CLI: compiles to the default output path and honors an explicit one", () => {
  const dir = tmpDir();
  const src = join(dir, "p.src.html");
  writeFileSync(src, trend('title="T" caption="c"', GOOD_POINTS));
  assert.equal(spawnSync(process.execPath, [CLI, src], { encoding: "utf8" }).status, 0);
  assert.match(readFileSync(join(dir, "p.html"), "utf8"), /^<!DOCTYPE html>/);
  const out = join(dir, "nested/out.html");
  assert.equal(spawnSync(process.execPath, [CLI, src, out], { encoding: "utf8" }).status, 0);
  assert.ok(existsSync(out));
});

test("CLI: usage errors exit 2, --help exits 0", () => {
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, join(tmpDir(), "missing.src.html")], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).status, 0);
});

test("compiler entry is executable and the bin points at it", () => {
  assert.ok(statSync(CLI).mode & 0o111, "compile.mjs must be executable");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.bin["inline-brief"], "skills/inline-brief/scripts/compile.mjs");
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test("repository contains no private paths, forbidden names or old DSL prefixes", () => {
  const banned = [
    ["", "Users", ""].join("/"),
    ["visual", "explainer"].join("-"),
    ["<t3", ""].join("-"),
    ["t3v", ""].join("-"),
  ];
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(dir, name);
      statSync(p).isDirectory() ? walk(p) : files.push(p);
    }
  })(ROOT);
  for (const f of files) {
    if (/\.(png|jpg|jpeg|webp|gif|ico)$/i.test(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const b of banned) assert.ok(!text.includes(b), `${f} contains "${b}"`);
  }
});

test("DSL strictness: unknown or misplaced <ib-*> child tags are rejected", () => {
  const badBars = compileSource(page(`<ib-bars title="B"><ib-bar label="a" value="1"></ib-bar><ib-barr label="b" value="2"></ib-barr><ib-point label="p" value="3"/></ib-bars>`));
  assert.ok(badBars.errors.some((e) => e.includes("<ib-bars>: unknown or misplaced <ib-barr>")));
  assert.ok(badBars.errors.some((e) => e.includes("<ib-bars>: unknown or misplaced <ib-point>")));

  const badKpis = compileSource(page(`<ib-kpis><ib-kpi label="a" value="1"></ib-kpi><ib-bar label="b" value="2"></ib-bar></ib-kpis>`));
  assert.ok(badKpis.errors.some((e) => e.includes("<ib-kpis>: unknown or misplaced <ib-bar>")));

  const badFlow = compileSource(page(`<ib-flow title="F" caption="c"><ib-node id="a" col="1" row="1">A</ib-node><ib-nod id="b" col="2" row="1">B</ib-nod></ib-flow>`));
  assert.ok(badFlow.errors.some((e) => e.includes("<ib-flow>: unknown or misplaced <ib-nod>")));

  const badLanes = compileSource(page(`<ib-lanes title="L"><ib-lane name="A"><ib-step>S</ib-step><ib-typo/></ib-lane></ib-lanes>`));
  assert.ok(badLanes.errors.some((e) => e.includes("<ib-lane>: unknown or misplaced <ib-typo>")));

  const multiStray = compileSource(page(`<ib-foo></ib-foo><ib-bar-bad></ib-bar-bad>`));
  assert.ok(multiStray.errors.some((e) => e.includes("unknown or misplaced <ib-foo>")));
  assert.ok(multiStray.errors.some((e) => e.includes("unknown or misplaced <ib-bar-bad>")));
});

test("DSL strictness: content outside <ib-page> fails, comments outside pass", () => {
  const outside = compileSource(`<p>before</p><ib-page title="T"><p>ok</p></ib-page><p>after</p>`);
  assert.equal(outside.errors.filter((e) => e.includes("outside <ib-page>")).length, 2);

  const missingPage = compileSource(`<p>no page wrapper</p>`);
  assert.ok(missingPage.errors.some((e) => e.includes("content outside <ib-page> is forbidden")));

  const commentOnly = compileSource(`<!-- ok --><ib-page title="A > B"><ib-kpis><ib-kpi label="R&amp;D" value="1"/></ib-kpis></ib-page>`);
  assert.deepEqual(commentOnly.errors, []);
  assert.match(commentOnly.html, /<title>A &gt; B<\/title>/);
  assert.match(commentOnly.html, />R&amp;D</);
});

test("DSL strictness: bars reject empty/hex values and max below peak", () => {
  const bad = compileSource(
    page(`<ib-bars title="B" max="10"><ib-bar label="e" value=""></ib-bar><ib-bar label="h" value="0x10"></ib-bar><ib-bar label="big" value="50"></ib-bar></ib-bars>`)
  );
  assert.ok(bad.errors.some((e) => e.includes('<ib-bar>: value="" must be a non-negative number')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-bar>: value="0x10" must be a non-negative number')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-bars>: max="10" is below the largest value 50')));

  const good = compileSource(page(`<ib-bars title="B" max="50"><ib-bar label="a" value="50"></ib-bar></ib-bars>`));
  assert.deepEqual(good.errors, []);
});

test("DSL strictness: unknown tone and kind are rejected, valid values pass", () => {
  const bad = compileSource(
    page(`<ib-kpis><ib-kpi label="a" value="1" tone="purple"/></ib-kpis>
<ib-bars title="B"><ib-bar label="b" value="1" tone="success"/></ib-bars>
<ib-flow title="F" caption="c"><ib-node id="n" col="1" row="1" tone="error">N</ib-node></ib-flow>
<ib-lanes title="L"><ib-lane name="A" tone="bogus"><ib-step kind="bogus">S</ib-step></ib-lane></ib-lanes>`)
  );
  assert.ok(bad.errors.some((e) => e.includes('<ib-kpi>: unknown tone="purple"')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-bar>: unknown tone="success"')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-node>: unknown tone="error"')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-lane>: unknown tone="bogus"')));
  assert.ok(bad.errors.some((e) => e.includes('<ib-step>: unknown kind="bogus"')));

  const good = compileSource(
    page(`<ib-kpis><ib-kpi label="a" value="1" tone="ok"/><ib-kpi label="b" value="2" tone="warn"/></ib-kpis>
<ib-lanes title="L"><ib-lane name="A" tone="info"><ib-step kind="action">S1</ib-step><ib-step kind="gate">S2</ib-step><ib-step kind="break">S3</ib-step></ib-lane></ib-lanes>`)
  );
  assert.deepEqual(good.errors, []);
});

test("DSL strictness: flow cell collision, excessive columns, and empty lane fail", () => {
  const cols13 = Array.from({ length: 13 }, (_, i) => `<ib-node id="n${i}" col="${i + 1}" row="1">N</ib-node>`).join("");
  const badFlow = compileSource(
    page(`<ib-flow title="F" caption="c"><ib-node id="a" col="1" row="1">A</ib-node><ib-node id="b" col="1" row="1">B</ib-node></ib-flow>
<ib-flow title="F2" caption="c">${cols13}</ib-flow>`)
  );
  assert.ok(badFlow.errors.some((e) => e.includes('cell (1, 1) collides with <ib-node id="a">')));
  assert.ok(badFlow.errors.some((e) => e.includes("too many columns (13)")));
  assert.doesNotMatch(badFlow.html, /width="-/);

  const emptyLane = compileSource(page(`<ib-lanes title="L"><ib-lane name="Empty"></ib-lane></ib-lanes>`));
  assert.ok(emptyLane.errors.some((e) => e.includes('<ib-lane name="Empty">: must contain at least one <ib-step>')));
});

test("warning: dangling focus keys in stepper or ib-ref raise warnings, matched keys do not", () => {
  const warnRes = compileSource(
    page(`<ib-kpis><ib-kpi label="a" value="1" focus="k1"/></ib-kpis>
<ib-stepper><ib-stage title="s" focus="nope">See <span class="ib-ref" data-focus="ghost">g</span></ib-stage></ib-stepper>`)
  );
  assert.deepEqual(warnRes.errors, []);
  assert.ok(warnRes.warnings.some((w) => w.includes('<ib-stage>: dangling focus key "nope"')));
  assert.ok(warnRes.warnings.some((w) => w.includes('.ib-ref: dangling focus key "ghost"')));

  const okRes = compileSource(
    page(`<ib-kpis><ib-kpi label="a" value="1" focus="k1"/></ib-kpis>
<ib-stepper><ib-stage title="s" focus="k1">See <span class="ib-ref" data-focus="k1">k1</span></ib-stage></ib-stepper>`)
  );
  assert.deepEqual(okRes.errors, []);
  assert.deepEqual(okRes.warnings, []);
});

test("gates 1+2+4+5: CSS-only scoping eliminates prose, selector, comment and '>' false positives", () => {
  const clean = compileSource(
    page(`<p>Never use 100vh or 0dvh in iframes.</p>
<ib-kpis><ib-kpi label="Unit" value="100vh"/></ib-kpis>
<ib-details summary="s"><pre><code>min-height: 100vh;</code></pre></ib-details>
<svg aria-label="a > b" viewBox="0 0 10 10"><rect fill="none" stroke="currentColor" width="10" height="10"/><path fill="transparent" stroke="inherit" d="M0 0"/></svg>
<style>
  /* html comment #fff */
  .card-body .fill, tbody td { height: 100%; }
  body { min-height: 100%; }
  html { color: var(--foreground); }
  .inner { height: 100%; }
  #facade, #cafe { fill: url(#fade); color: var(--foreground); border-color: transparent; background: currentColor; }
</style>`)
  );
  assert.deepEqual(clean.errors, []);
});

test("gates 1+2+4: catch :root/body height:100%, inline style, SVG paint, oklch and named colors", () => {
  const badRoot = compileSource(page(`<style>:root { height: 100%; } .foo, body { height: 100.0%; }</style>`));
  assert.equal(badRoot.errors.filter((e) => e.includes("height: 100% on html/body forbidden")).length, 2);

  const badInlineAndSvg = compileSource(
    page(`<div style="height: .5vh; color: #ff0000; background: rgb(1,2,3)">x</div>
<svg viewBox="0 0 10 10"><rect fill="#00ff00" stroke="red" width="10" height="10"/></svg>
<style>.a { color: oklch(0.7 0.2 120); background: white; }</style>`)
  );
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('viewport height unit ".5vh"')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "#ff0000" in style attribute')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "rgb(" in style attribute')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "#00ff00" in SVG fill attribute')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "red" in SVG stroke attribute')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "oklch(" in <style>')));
  assert.ok(badInlineAndSvg.errors.some((e) => e.includes('hardcoded color "white" in <style>')));
});

test("CLI robustness: importing compile.mjs via stdin module does not throw on argv[1]", () => {
  const cliUrl = pathToFileURL(CLI).href;
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-"],
    {
      input: `import { compileSource } from ${JSON.stringify(cliUrl)}; const res = compileSource('<ib-page title="T"><p>ok</p></ib-page>'); if (res.errors.length) process.exit(1);`,
      encoding: "utf8",
    }
  );
  assert.equal(r.status, 0, r.stderr);
});

test("kit CSS & runtime: focus highlight styles exist, dynamic .ib-ref works, and multiple steppers isolate timers/state", () => {
  const baseCss = readFileSync(join(ROOT, "skills/inline-brief/kit/base.css"), "utf8");
  for (const sel of [".ib-kpi[data-focus]", ".ib-kpi.ib-lit", ".ib-bar-row[data-focus]", ".ib-bar-row.ib-lit", ".ib-pt[data-focus]", ".ib-pt.ib-lit"]) {
    assert.ok(baseCss.includes(sel), `base.css missing ${sel}`);
  }

  // Minimal DOM stub to execute kit/runtime.js
  class FakeClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...c) { c.forEach((x) => this.set.add(x)); }
    remove(...c) { c.forEach((x) => this.set.delete(x)); }
    toggle(c, force) {
      if (force === undefined) return this.set.has(c) ? (this.set.delete(c), false) : (this.set.add(c), true);
      if (force) this.set.add(c); else this.set.delete(c);
      return force;
    }
    contains(c) { return this.set.has(c); }
  }
  class FakeEl {
    constructor(tag, attrs = {}, parent = null) {
      this.tag = tag;
      this.attrs = { ...attrs };
      this.dataset = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("data-")) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          this.dataset[camel] = v;
        }
      }
      this.parent = parent;
      this.children = [];
      this.classList = new FakeClassList(this);
      if (attrs.class) this.classList.add(...attrs.class.split(/\s+/).filter(Boolean));
      this.listeners = {};
      this.textContent = "";
      this._innerHTML = "";
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) {
      this._innerHTML = v;
      this.children = [];
      for (const m of String(v).matchAll(/<span class="ib-ref" data-focus="([^"]+)">([^<]*)<\/span>/g)) {
        const child = new FakeEl("span", { class: "ib-ref", "data-focus": m[1] }, this);
        child.textContent = m[2];
        this.children.push(child);
      }
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, val) { this.attrs[name] = String(val); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, extra = {}) {
      const ev = { target: this, relatedTarget: null, ...extra };
      for (const fn of this.listeners[type] || []) fn(ev);
      for (const fn of docListeners[type] || []) fn(ev);
    }
    matches(sel) {
      if (sel === "[data-focus]") return this.attrs["data-focus"] !== undefined;
      if (sel === ".ib-stepper-btns") return this.classList.contains("ib-stepper-btns");
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      const attrM = /^\[data-act="([^"]+)"\]$/.exec(sel);
      if (attrM) return this.attrs["data-act"] === attrM[1];
      return false;
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.matches(sel)) return cur;
        cur = cur.parent;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.matches(sel)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  }

  const root = new FakeEl("div");
  const kpiA = new FakeEl("div", { class: "ib-kpi", "data-focus": "a" }, root);
  const kpiB = new FakeEl("div", { class: "ib-kpi", "data-focus": "b" }, root);
  root.children.push(kpiA, kpiB);

  function makeStepper(stage1Focus, stage1Html, stage2Focus) {
    const st = new FakeEl("div", { class: "ib-stepper" }, root);
    const btns = new FakeEl("div", { class: "ib-stepper-btns" }, st);
    const prev = new FakeEl("button", { class: "ib-btn", "data-act": "prev" }, btns);
    const dot0 = new FakeEl("button", { class: "ib-dot is-active" }, btns);
    const dot1 = new FakeEl("button", { class: "ib-dot" }, btns);
    const next = new FakeEl("button", { class: "ib-btn", "data-act": "next" }, btns);
    const play = new FakeEl("button", { class: "ib-btn", "data-act": "play", "aria-pressed": "false" }, btns);
    const reset = new FakeEl("button", { class: "ib-btn", "data-act": "reset" }, btns);
    btns.children.push(prev, dot0, dot1, next, play, reset);
    const title = new FakeEl("div", { class: "ib-stage-title" }, st);
    const body = new FakeEl("div", { class: "ib-stage-body" }, st);
    const d0 = new FakeEl("div", { class: "ib-stage-data", "data-title": "S1", "data-stage-focus": stage1Focus }, st);
    d0._innerHTML = stage1Html;
    const d1 = new FakeEl("div", { class: "ib-stage-data", "data-title": "S2", "data-stage-focus": stage2Focus }, st);
    d1._innerHTML = "Stage 2";
    st.children.push(btns, title, body, d0, d1);
    root.children.push(st);
    return { st, body, dot1, next, play, reset };
  }

  const s1 = makeStepper("a", 'Go <span class="ib-ref" data-focus="b">B</span>', "b");
  const s2 = makeStepper("b", "Step two", "a");
  const docListeners = {};
  const activeTimers = new Map();
  let nextTimerId = 1;

  const runtimeSrc = readFileSync(join(ROOT, "skills/inline-brief/kit/runtime.js"), "utf8");
  vm.runInNewContext(runtimeSrc, {
    document: {
      querySelectorAll: (sel) => root.querySelectorAll(sel),
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    },
    setInterval: (fn) => { const id = nextTimerId++; activeTimers.set(id, fn); return id; },
    clearInterval: (id) => { activeTimers.delete(id); },
  });

  // 1. Initial render: nothing dimmed
  assert.equal(kpiA.classList.contains("ib-dim"), false);
  assert.equal(kpiB.classList.contains("ib-dim"), false);

  // 2. Dynamic .ib-ref inside stepper body works on hover and click via delegation
  const dynRef = s1.body.children[0];
  assert.ok(dynRef && dynRef.getAttribute("data-focus") === "b");
  dynRef.dispatch("mouseover");
  assert.equal(kpiB.classList.contains("ib-lit"), true);
  assert.equal(kpiA.classList.contains("ib-dim"), true);
  dynRef.dispatch("mouseout", { relatedTarget: root });
  assert.equal(kpiA.classList.contains("ib-dim"), false);
  dynRef.dispatch("click");
  assert.equal(kpiB.classList.contains("ib-lit"), true);
  assert.equal(kpiA.classList.contains("ib-dim"), true);

  // 3. Two steppers coordinate play timers and isolate reset state
  s1.play.dispatch("click");
  assert.equal(activeTimers.size, 1);
  assert.equal(s1.play.getAttribute("aria-pressed"), "true");

  s2.play.dispatch("click");
  assert.equal(activeTimers.size, 1, "starting stepper 2 must stop stepper 1's timer");
  assert.equal(s1.play.getAttribute("aria-pressed"), "false");
  assert.equal(s2.play.getAttribute("aria-pressed"), "true");
  assert.equal(kpiB.classList.contains("ib-lit"), true);

  // Resetting stepper 1 must not wipe out stepper 2's active highlight
  s1.reset.dispatch("click");
  assert.equal(kpiB.classList.contains("ib-lit"), true);
  assert.equal(kpiA.classList.contains("ib-dim"), true);

  // Resetting stepper 2 clears active highlight and stops its timer
  s2.reset.dispatch("click");
  assert.equal(activeTimers.size, 0);
  assert.equal(kpiA.classList.contains("ib-dim"), false);
  assert.equal(kpiB.classList.contains("ib-lit"), false);
});

test("gate 3 expanded: external URLs in attributes, unquoted attrs, inline style, embeds and scripts fail; data: and #id pass", () => {
  const badAttrs = compileSource(
    page(`<img src="https://img.example/a.png" />
<img src=//cdn.example/b.png />
<script src=https://cdn.example/x.js></script>
<img srcset="a.png 1x, https://cdn.example/c.png 2x" />
<video poster="//cdn.example/p.jpg"></video>
<form action="https://evil.example/post"><button formaction="//evil.example/btn">Go</button></form>
<svg viewBox="0 0 10 10"><image href="https://img.example/i.png"/><use xlink:href="//cdn.example/sprite.svg#a"/></svg>`)
  );
  for (const tagAttr of ["<img src>", "<script src>", "<img srcset>", "<video poster>", "<form action>", "<button formaction>", "<image href>", "<use xlink:href>"]) {
    assert.ok(badAttrs.errors.some((e) => e.includes(tagAttr)), `missing error for ${tagAttr}`);
  }

  const badInlineStyle = compileSource(
    page(`<div style="background: url(https://cdn.example/bg.png)">x</div>
<div style="background: url('//cdn.example/bg2.png')">y</div>`)
  );
  assert.equal(badInlineStyle.errors.filter((e) => e.includes("external CSS url() forbidden")).length, 2);

  const badEmbeds = compileSource(
    page(`<iframe src="https://example.com"></iframe>
<object data="https://example.com/app"></object>
<embed src="/local.swf" />`)
  );
  assert.ok(badEmbeds.errors.some((e) => e.includes("embedded <iframe> forbidden")));
  assert.ok(badEmbeds.errors.some((e) => e.includes("embedded <object> forbidden")));
  assert.ok(badEmbeds.errors.some((e) => e.includes("<object data>")));
  assert.ok(badEmbeds.errors.some((e) => e.includes("embedded <embed> forbidden")));

  const badScript = compileSource(
    page(`<script>
  fetch("/local");
  const x = new XMLHttpRequest();
  import("./mod.js");
  const u = "https://api.example/v1";
  const p = "//cdn.example/lib.js";
</script>`)
  );
  assert.ok(badScript.errors.some((e) => e.includes('"fetch(" forbidden')));
  assert.ok(badScript.errors.some((e) => e.includes('"XMLHttpRequest" forbidden')));
  assert.ok(badScript.errors.some((e) => e.includes('"import(" forbidden')));
  assert.equal(badScript.errors.filter((e) => e.includes("external URL in <script> string forbidden")).length, 2);

  const allowedLocal = compileSource(
    page(`<a href="#section">Jump</a>
<img src="data:image/png;base64,AAAA" />
<div style="background: url(data:image/svg+xml,%3Csvg/%3E)">ok</div>
<svg viewBox="0 0 10 10"><use href="#icon"/><rect fill="url(#grad)" width="10" height="10"/></svg>
<script>/* fetch("https://commented.example") */ const ok = "#section"; const d = "data:text/plain,ok";</script>`)
  );
  assert.deepEqual(allowedLocal.errors, []);
});

test("distribution manifests share name, version, license, repository, unofficial notice and generator tag", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const rootPlugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const claudePlugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  const marketPlugin = marketplace.plugins[0];

  const normRepo = (r) => (typeof r === "string" ? r : r?.url || "").replace(/^git\+/, "").replace(/\.git$/, "");
  const manifests = [
    ["package.json", pkg],
    ["plugin.json", rootPlugin],
    [".claude-plugin/plugin.json", claudePlugin],
    [".claude-plugin/marketplace.json#plugins[0]", marketPlugin],
  ];

  assert.equal(pkg.version, VERSION, "package.json version must match compile.mjs VERSION");
  assert.equal(marketplace.name, pkg.name);
  assert.match(marketplace.metadata.description, /Unofficial community skill/i);

  for (const [label, m] of manifests) {
    assert.equal(m.name, pkg.name, `${label} name mismatch`);
    assert.equal(m.version, pkg.version, `${label} version mismatch`);
    assert.equal(m.license, pkg.license, `${label} license mismatch`);
    assert.equal(normRepo(m.repository), normRepo(pkg.repository), `${label} repository mismatch`);
    assert.match(m.description, /Unofficial community skill/i, `${label} missing unofficial notice`);
  }

  const compiled = compileSource(page(`<p>hello</p>`));
  assert.match(compiled.html, new RegExp(`<meta name="generator" content="inline-brief ${pkg.version.replace(".", "\\.")}" />`));

  const verOut = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
  assert.equal(verOut.status, 0);
  assert.equal(verOut.stdout.trim(), pkg.version);
});

test("picker: valid triage/multi/single, zh localization, data URI, local raster inlining, and <ib-preview>", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, "imgs"), { recursive: true });
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  writeFileSync(join(dir, "imgs/a.png"), tinyPng);

  const src = `<ib-page title="选型" lang="zh-CN">
  <ib-picker title="挑 1–2 个方向" mode="triage" cols="2">
    <ib-option id="01" title="方案一" group="3D" badge="CC0" tone="ok" src="imgs/a.png" fit="pixel" focus="a">
      <p>本地 PNG 编译期内联</p>
    </ib-option>
    <ib-option id="02" title="方案二" group="UI" badge="推荐" tone="info" focus="b">
      <ib-preview><svg viewBox="0 0 100 60"><rect width="100" height="60" fill="var(--card)" stroke="var(--border)"/></svg></ib-preview>
      <p>内联 SVG 预览</p>
    </ib-option>
    <ib-option id="03" title="方案三" group="UI" src="data:image/png;base64,AAAA" fit="contain">
      <p>Data URI 预览</p>
    </ib-option>
  </ib-picker>
</ib-page>`;

  const res = compileSource(src, { baseDir: dir });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.stats.figures, 1);
  assert.equal(res.stats.interactive, 1);
  assert.match(res.html, /data:image\/png;base64,iVBORw0KGgo/);
  assert.match(res.html, /ib-fit-pixel/);
  assert.match(res.html, /ib-fit-contain/);
  assert.match(res.html, /★ 心仪/);
  assert.match(res.html, /✕ 排除/);
  assert.match(res.html, /复制选择/);
  assert.match(res.html, /data-pick-filter="3D"/);
  assert.match(res.html, /data-pick-filter="UI"/);

  // Single mode without media or groups omits filter bar & media wrapper cleanly
  const singleRes = compileSource(
    page(`<ib-picker mode="single" cols="3">
      <ib-option id="A" title="Keep current">Fastest</ib-option>
      <ib-option id="B" title="Migrate now">Cleaner</ib-option>
    </ib-picker>`)
  );
  assert.deepEqual(singleRes.errors, []);
  assert.doesNotMatch(singleRes.html, /class="ib-pick-filters"/);
  assert.doesNotMatch(singleRes.html, /class="ib-pick-media"/);
  assert.match(singleRes.html, /◉ Choose/);
  assert.match(singleRes.html, /--ib-pick-cols:3/);
});

test("picker: rejects schema errors, stray tags, and unsafe image paths", () => {
  const dir = tmpDir();
  const outside = tmpDir();
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  writeFileSync(join(outside, "secret.png"), tinyPng);
  writeFileSync(join(dir, "note.txt"), "hi");
  writeFileSync(join(dir, "huge.png"), Buffer.alloc(2 * 1024 * 1024 + 16));
  symlinkSync(join(outside, "secret.png"), join(dir, "escape.png"));

  const badSchema = compileSource(
    page(`<ib-picker mode="bogus" cols="4">
      <ib-option id="01" title="A" fit="stretch" tone="nope" src="https://evil.example/a.png">
        <ib-preview><svg viewBox="0 0 10 10"></svg></ib-preview>
      </ib-option>
      <ib-option id="01" title="">x</ib-option>
      <ib-bar label="stray" value="1"></ib-bar>
    </ib-picker>`)
  );
  assert.ok(badSchema.errors.some((e) => e.includes('unknown mode="bogus"')));
  assert.ok(badSchema.errors.some((e) => e.includes('unsupported cols="4"')));
  assert.ok(badSchema.errors.some((e) => e.includes('unknown fit="stretch"')));
  assert.ok(badSchema.errors.some((e) => e.includes('unknown tone="nope"')));
  assert.ok(badSchema.errors.some((e) => e.includes("external <ib-option src> URL forbidden")));
  assert.ok(badSchema.errors.some((e) => e.includes("specify either src or <ib-preview>, not both")));
  assert.ok(badSchema.errors.some((e) => e.includes('duplicate option id')));
  assert.ok(badSchema.errors.some((e) => e.includes("missing required title attribute")));
  assert.ok(badSchema.errors.some((e) => e.includes("<ib-picker>: unknown or misplaced <ib-bar>")));

  const tooFew = compileSource(page(`<ib-picker><ib-option id="01" title="Only one">x</ib-option></ib-picker>`));
  assert.ok(tooFew.errors.some((e) => e.includes("needs at least 2 <ib-option> (found 1)")));

  const badPaths = compileSource(
    page(`<ib-picker>
      <ib-option id="1" title="Abs" src="/etc/hosts">x</ib-option>
      <ib-option id="2" title="Trav" src="../secret.png">x</ib-option>
      <ib-option id="3" title="Ext" src="note.txt">x</ib-option>
      <ib-option id="4" title="Sym" src="escape.png">x</ib-option>
      <ib-option id="5" title="Miss" src="missing.png">x</ib-option>
      <ib-option id="6" title="Huge" src="huge.png">x</ib-option>
      <ib-option id="7" title="BadData" src="data:text/plain,abc">x</ib-option>
    </ib-picker>`),
    { baseDir: dir }
  );
  assert.ok(badPaths.errors.some((e) => e.includes("no absolute paths")));
  assert.ok(badPaths.errors.some((e) => e.includes('".." forbidden')));
  assert.ok(badPaths.errors.some((e) => e.includes("unsupported local image extension")));
  assert.ok(badPaths.errors.some((e) => e.includes("resolves outside the source directory")));
  assert.ok(badPaths.errors.some((e) => e.includes("not found relative to source directory")));
  assert.ok(badPaths.errors.some((e) => e.includes("max 2 MiB")));
  assert.ok(badPaths.errors.some((e) => e.includes("src data URI must be an image")));
});

test("kit runtime: picker filtering, triage/single states, live summary, clear, and clipboard copy", async () => {
  class FakeClassList {
    constructor() { this.set = new Set(); }
    add(...c) { c.forEach((x) => this.set.add(x)); }
    remove(...c) { c.forEach((x) => this.set.delete(x)); }
    toggle(c, force) {
      if (force === undefined) return this.set.has(c) ? (this.set.delete(c), false) : (this.set.add(c), true);
      if (force) this.set.add(c); else this.set.delete(c);
      return force;
    }
    contains(c) { return this.set.has(c); }
  }
  class FakeEl {
    constructor(tag, attrs = {}, parent = null) {
      this.tag = tag;
      this.attrs = { ...attrs };
      this.dataset = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("data-")) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          this.dataset[camel] = v;
        }
      }
      this.parent = parent;
      this.children = [];
      this.classList = new FakeClassList();
      if (attrs.class) this.classList.add(...attrs.class.split(/\s+/).filter(Boolean));
      this.listeners = {};
      this.textContent = attrs.text || "";
      this.hidden = Boolean(attrs.hidden);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, val) { this.attrs[name] = String(val); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    async dispatch(type) {
      for (const fn of this.listeners[type] || []) await fn({ target: this });
    }
    matches(sel) {
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      const m = /^\[([a-z-]+)\]$/.exec(sel);
      if (m) return this.attrs[m[1]] !== undefined;
      return false;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.matches(sel)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  }

  const root = new FakeEl("div");
  function makePicker(mode) {
    const p = new FakeEl("section", {
      class: "ib-picker",
      "data-mode": mode,
      "data-empty-text": "Empty",
      "data-like-prefix": "Shortlist: ",
      "data-skip-prefix": "Skip: ",
      "data-select-prefix": "Selected: ",
      "data-item-sep": ", ",
      "data-group-sep": " | ",
      "data-copied-label": "Copied",
    }, root);
    const pillAll = new FakeEl("button", { class: "ib-pick-pill is-active", "data-pick-filter": "__all__" }, p);
    const pillA = new FakeEl("button", { class: "ib-pick-pill", "data-pick-filter": "G1" }, p);
    const c1 = new FakeEl("article", { class: "ib-opt", "data-opt-id": "01", "data-opt-title": "Alpha", "data-opt-group": "G1" }, p);
    const c2 = new FakeEl("article", { class: "ib-opt", "data-opt-id": "02", "data-opt-title": "Beta", "data-opt-group": "G2" }, p);
    if (mode === "triage") {
      c1.children.push(
        new FakeEl("button", { "data-pick-act": "like" }, c1),
        new FakeEl("button", { "data-pick-act": "skip" }, c1)
      );
      c2.children.push(
        new FakeEl("button", { "data-pick-act": "like" }, c2),
        new FakeEl("button", { "data-pick-act": "skip" }, c2)
      );
    } else {
      c1.children.push(new FakeEl("button", { "data-pick-act": "select" }, c1));
      c2.children.push(new FakeEl("button", { "data-pick-act": "select" }, c2));
    }
    const sum = new FakeEl("div", { class: "ib-pick-summary" }, p);
    const clear = new FakeEl("button", { "data-pick-clear": "", hidden: true }, p);
    const copy = new FakeEl("button", { "data-pick-copy": "", text: "Copy selection" }, p);
    p.children.push(pillAll, pillA, c1, c2, sum, clear, copy);
    root.children.push(p);
    return { p, pillAll, pillA, c1, c2, sum, clear, copy };
  }

  const triage = makePicker("triage");
  const single = makePicker("single");
  const clipboardWrites = [];
  const runtimeSrc = readFileSync(join(ROOT, "skills/inline-brief/kit/runtime.js"), "utf8");
  vm.runInNewContext(runtimeSrc, {
    document: {
      querySelectorAll: (sel) => root.querySelectorAll(sel),
      addEventListener: () => {},
    },
    navigator: {
      clipboard: {
        writeText: async (text) => { clipboardWrites.push(text); },
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });

  // Filter hides G2
  await triage.pillA.dispatch("click");
  assert.equal(triage.c1.hidden, false);
  assert.equal(triage.c2.hidden, true);
  await triage.pillAll.dispatch("click");
  assert.equal(triage.c2.hidden, false);

  // Triage like + skip updates summary and copies cleanly
  await triage.c1.children[0].dispatch("click");
  await triage.c2.children[1].dispatch("click");
  assert.equal(triage.c1.classList.contains("is-liked"), true);
  assert.equal(triage.c2.classList.contains("is-skipped"), true);
  assert.equal(triage.sum.textContent, "Shortlist: 01 Alpha | Skip: 02 Beta");
  assert.equal(triage.clear.hidden, false);

  await triage.copy.dispatch("click");
  assert.deepEqual(clipboardWrites, ["Shortlist: 01 Alpha | Skip: 02 Beta"]);
  assert.equal(triage.copy.textContent, "Copied");

  // Clear resets triage without affecting single picker
  await single.c1.children[0].dispatch("click");
  assert.equal(single.sum.textContent, "Selected: 01 Alpha");
  await single.c2.children[0].dispatch("click");
  assert.equal(single.c1.classList.contains("is-selected"), false);
  assert.equal(single.c2.classList.contains("is-selected"), true);
  assert.equal(single.sum.textContent, "Selected: 02 Beta");

  await triage.clear.dispatch("click");
  assert.equal(triage.sum.textContent, "Empty");
  assert.equal(triage.clear.hidden, true);
  assert.equal(single.sum.textContent, "Selected: 02 Beta");
});

test("picker: total inlined image budget warns above 1.5 MiB and errors above 6 MiB", () => {
  const dir = tmpDir();
  const img900k = Buffer.alloc(900 * 1024, 0x42);
  writeFileSync(join(dir, "a.png"), img900k);
  writeFileSync(join(dir, "b.png"), img900k);

  const warnRes = compileSource(
    page(`<ib-picker>
      <ib-option id="01" title="A" src="a.png">x</ib-option>
      <ib-option id="02" title="B" src="b.png">x</ib-option>
    </ib-picker>`),
    { baseDir: dir }
  );
  assert.deepEqual(warnRes.errors, []);
  assert.ok(warnRes.warnings.some((w) => w.includes("total inlined images") && w.includes("may slow inline preview")));

  const img1800k = Buffer.alloc(1800 * 1024, 0x43);
  for (const n of ["1", "2", "3", "4"]) writeFileSync(join(dir, `big${n}.png`), img1800k);
  const errRes = compileSource(
    page(`<ib-picker>
      <ib-option id="01" title="A" src="big1.png">x</ib-option>
      <ib-option id="02" title="B" src="big2.png">x</ib-option>
      <ib-option id="03" title="C" src="big3.png">x</ib-option>
      <ib-option id="04" title="D" src="big4.png">x</ib-option>
    </ib-picker>`),
    { baseDir: dir }
  );
  assert.ok(errRes.errors.some((e) => e.includes("exceed the 6 MiB page budget")));
});

test("kit runtime: picker notes, zoom compare dialog sync, and clipboard-blocked plain-text fallback", async () => {
  class FakeClassList {
    constructor() { this.set = new Set(); }
    add(...c) { c.forEach((x) => this.set.add(x)); }
    remove(...c) { c.forEach((x) => this.set.delete(x)); }
    toggle(c, force) {
      if (force === undefined) return this.set.has(c) ? (this.set.delete(c), false) : (this.set.add(c), true);
      if (force) this.set.add(c); else this.set.delete(c);
      return force;
    }
    contains(c) { return this.set.has(c); }
  }
  class FakeEl {
    constructor(tag, attrs = {}, parent = null) {
      this.tag = tag;
      this.tagName = tag.toUpperCase();
      this.attrs = { ...attrs };
      this.dataset = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("data-")) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          this.dataset[camel] = v;
        }
      }
      this.parent = parent;
      this.children = [];
      this.classList = new FakeClassList();
      if (attrs.class) this.classList.add(...attrs.class.split(/\s+/).filter(Boolean));
      this.listeners = {};
      this.textContent = attrs.text || "";
      this.innerHTML = attrs.html || "";
      this.value = attrs.value || "";
      this.hidden = Boolean(attrs.hidden);
      this.open = false;
      this.selected = false;
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, val) { this.attrs[name] = String(val); }
    removeAttribute(name) { delete this.attrs[name]; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
    select() { this.selected = true; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    async dispatch(type, ev = {}) {
      for (const fn of this.listeners[type] || []) await fn({ target: this, ...ev });
    }
    matches(sel) {
      if (sel.includes(" ")) {
        const [pSel, cSel] = sel.split(/\s+/, 2);
        return this.matches(cSel) && Boolean(this.parent && this.parent.matches(pSel));
      }
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      const m = /^\[([a-z-]+)\]$/.exec(sel);
      if (m) return this.attrs[m[1]] !== undefined;
      return this.tag.toLowerCase() === sel.toLowerCase();
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.matches(sel)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  }

  const root = new FakeEl("div");
  const p = new FakeEl("section", {
    class: "ib-picker",
    "data-mode": "triage",
    "data-empty-text": "Empty",
    "data-like-prefix": "心仪：",
    "data-skip-prefix": "排除：",
    "data-note-prefix": "备注：",
    "data-note-open": "（",
    "data-note-close": "）",
    "data-item-sep": "、",
    "data-group-sep": " ｜ ",
    "data-copy-fallback-label": "已选中，按 ⌘C 复制",
  }, root);

  function makeCard(id, title, src) {
    const c = new FakeEl("article", { class: "ib-opt", "data-opt-id": id, "data-opt-title": title }, p);
    const media = new FakeEl("div", { class: "ib-pick-media" }, c);
    media.children.push(
      new FakeEl("img", { src, alt: title }, media),
      new FakeEl("button", { class: "ib-pick-zoom", "data-pick-zoom": "" }, media)
    );
    const sub = new FakeEl("div", { class: "ib-pick-sub", text: `${title} sub` }, c);
    const note = new FakeEl("input", { class: "ib-pick-note", "data-pick-note": "" }, c);
    const like = new FakeEl("button", { "data-pick-act": "like" }, c);
    const skip = new FakeEl("button", { "data-pick-act": "skip" }, c);
    c.children.push(media, sub, note, like, skip);
    return { c, zoom: media.children[1], note, like, skip };
  }

  const c1 = makeCard("01", "武侠低模", "data:image/png;base64,AAA");
  const c2 = makeCard("02", "像素浪客", "data:image/png;base64,BBB");
  const sum = new FakeEl("div", { class: "ib-pick-summary" }, p);
  const clear = new FakeEl("button", { "data-pick-clear": "", hidden: true }, p);
  const copy = new FakeEl("button", { "data-pick-copy": "", text: "复制选择" }, p);
  const fallback = new FakeEl("textarea", { class: "ib-pick-fallback", hidden: true }, p);

  const dlg = new FakeEl("dialog", { class: "ib-pick-dialog" }, p);
  const dlgId = new FakeEl("span", { class: "ib-pick-dlg-id" }, dlg);
  const dlgName = new FakeEl("span", { class: "ib-pick-dlg-name" }, dlg);
  const dlgPos = new FakeEl("span", { class: "ib-pick-dlg-pos" }, dlg);
  const dlgPrev = new FakeEl("button", { "data-dlg-prev": "" }, dlg);
  const dlgNext = new FakeEl("button", { "data-dlg-next": "" }, dlg);
  const dlgClose = new FakeEl("button", { "data-dlg-close": "" }, dlg);
  const dlgStage = new FakeEl("div", { class: "ib-pick-dlg-stage" }, dlg);
  const dlgDesc = new FakeEl("div", { class: "ib-pick-dlg-desc" }, dlg);
  const dlgNote = new FakeEl("input", { "data-dlg-note": "" }, dlg);
  const dlgLike = new FakeEl("button", { "data-dlg-act": "like" }, dlg);
  const dlgSkip = new FakeEl("button", { "data-dlg-act": "skip" }, dlg);
  dlg.children.push(dlgId, dlgName, dlgPos, dlgPrev, dlgNext, dlgClose, dlgStage, dlgDesc, dlgNote, dlgLike, dlgSkip);

  p.children.push(c1.c, c2.c, sum, clear, copy, fallback, dlg);
  root.children.push(p);

  const runtimeSrc = readFileSync(join(ROOT, "skills/inline-brief/kit/runtime.js"), "utf8");
  vm.runInNewContext(runtimeSrc, {
    document: {
      querySelectorAll: (sel) => root.querySelectorAll(sel),
      addEventListener: () => {},
    },
    navigator: {
      clipboard: {
        writeText: async () => { throw new Error("Permissions-Policy blocked"); },
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  });

  // 1) Open zoom compare on card 01, shortlist + add note inside dialog, step to 02 and leave standalone note
  await c1.zoom.dispatch("click");
  assert.equal(dlg.open, true);
  assert.equal(dlgId.textContent, "01");
  assert.equal(dlgPos.textContent, "1/2");

  await dlgLike.dispatch("click");
  dlgNote.value = "衣袍再国风一点";
  await dlgNote.dispatch("input");
  assert.equal(c1.c.classList.contains("is-liked"), true);
  assert.equal(c1.note.value, "衣袍再国风一点");

  await dlgNext.dispatch("click");
  assert.equal(dlgId.textContent, "02");
  assert.equal(dlgPos.textContent, "2/2");
  dlgNote.value = "刀光不错但换装慢";
  await dlgNote.dispatch("input");
  assert.equal(sum.textContent, "心仪：01 武侠低模（衣袍再国风一点） ｜ 备注：02 像素浪客（刀光不错但换装慢）");

  // 2) Clipboard write blocked -> fallback textarea becomes visible, populated and selected
  await copy.dispatch("click");
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.value, "心仪：01 武侠低模（衣袍再国风一点） ｜ 备注：02 像素浪客（刀光不错但换装慢）");
  assert.equal(fallback.selected, true);
  assert.equal(copy.textContent, "已选中，按 ⌘C 复制");

  // 3) Clear wipes states, notes, and hides fallback
  await clear.dispatch("click");
  assert.equal(c1.note.value, "");
  assert.equal(c2.note.value, "");
  assert.equal(fallback.hidden, true);
  assert.equal(sum.textContent, "Empty");
});

test("attribute and label text decode character references once (&amp;lt; stays literal &lt;)", () => {
  const res = compileSource(
    page(`<ib-kpis><ib-kpi label="a &amp;lt; b" value="&amp;gt;"></ib-kpi></ib-kpis>
<ib-lanes title="L" caption="c"><ib-lane name="x"><ib-step>&amp;lt;b&amp;gt;</ib-step></ib-lane></ib-lanes>`)
  );
  assert.deepEqual(res.errors, []);
  assert.ok(res.html.includes('<div class="ib-kpi-label">a &amp;lt; b</div>'));
  assert.ok(res.html.includes('<div class="ib-kpi-val">&amp;gt;</div>'));
  assert.ok(res.html.includes('<span class="ib-step-title">&amp;lt;b&amp;gt;</span>'));
});

// Line numbers stay exact after earlier blocks are expanded and when an opening tag is longer
// than the lines that follow it.
test("errors in later blocks and in child tags point at their own source line", () => {
  const src = [
    '<ib-page title="t">',
    '<ib-kpis>',
    '<ib-kpi label="a" value="1"></ib-kpi>',
    '<ib-kpi label="b" value="2"></ib-kpi>',
    "</ib-kpis>",
    '<ib-flow title="a rather long flow title that makes the opening tag wide" note="and a long note too">',
    '<ib-node id="n0" col="1" row="1">a</ib-node>',
    '<ib-node id="n1" col="2" row="1">b</ib-node>',
    '<ib-edge from="n0" to="n1" label="calls"></ib-edge>',
    '<ib-edge from="n1" to="n0"></ib-edge>',
    "</ib-flow>",
    "</ib-page>",
  ].join("\n");
  assert.deepEqual(compileSource(src).errors.sort(), [
    "line 10 <ib-edge>: missing label attribute (every edge carries an action verb)",
    "line 6 <ib-flow>: missing required caption attribute (state the figure's claim)",
  ]);
});

test("a stray <ib-*> tag is reported once, on its own line, whatever block it sits in", () => {
  const cases = {
    details: ['<ib-details summary="s">', "<p>x</p>", "<ib-bogus>x</ib-bogus>", "</ib-details>"],
    grid: ["<ib-grid>", "<p>x</p>", "<ib-bogus>x</ib-bogus>", "</ib-grid>"],
    kpis: ["<ib-kpis>", '<ib-kpi label="a" value="1"></ib-kpi>', "<ib-bogus>x</ib-bogus>", "</ib-kpis>"],
    stepper: ['<ib-stepper title="s">', '<ib-stage title="a">x', "<ib-bogus>x</ib-bogus></ib-stage>", "</ib-stepper>"],
    picker: ['<ib-picker title="p" caption="c">', '<ib-option id="a" title="A"><p>x</p>', "<ib-bogus>x</ib-bogus></ib-option>", "</ib-picker>"],
  };
  for (const [name, lines] of Object.entries(cases)) {
    const src = ['<ib-page title="t">', '<ib-kpis><ib-kpi label="k" value="1"></ib-kpi></ib-kpis>', ...lines, "</ib-page>"].join("\n");
    const errors = compileSource(src).errors.filter((e) => e.includes("ib-bogus"));
    // One report for the opening and one for the closing tag, both on line 5.
    assert.equal(errors.length, 2, `${name}: ${JSON.stringify(errors)}`);
    for (const e of errors) assert.match(e, /^line 5\b/, `${name}: ${e}`);
  }
});

test("raw < and > inside quoted attribute values stay data", () => {
  const res = compileSource(
    page(`<ib-kpis><ib-kpi label="p95 <style> a > b" value="</ib-kpis>"></ib-kpi></ib-kpis>
<ib-kpis><ib-kpi label="ok" value="1"></ib-kpi></ib-kpis>`)
  );
  assert.deepEqual(res.errors, []);
  assert.ok(res.html.includes('<div class="ib-kpi-label">p95 &lt;style&gt; a &gt; b</div>'));
  assert.ok(res.html.includes('<div class="ib-kpi-val">&lt;/ib-kpis&gt;</div>'));
});
