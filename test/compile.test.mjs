import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { compileSource } from "../skills/inline-brief/scripts/compile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "skills/inline-brief/scripts/compile.mjs");
const DEMOS = ["cache-read-path", "repo-health-audit"];

const page = (body) => `<ib-page title="T">${body}</ib-page>`;
const trend = (attrs, points) => page(`<ib-trend ${attrs}>${points}</ib-trend>`);
const GOOD_POINTS = `<ib-point label="a" value="1" /><ib-point label="b" value="3" />`;

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "inline-brief-"));
}

for (const name of DEMOS) {
  test(`demo ${name} compiles with zero errors and zero warnings`, () => {
    const res = compileSource(readFileSync(join(ROOT, `examples/${name}.src.html`), "utf8"));
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings, []);
    assert.ok(res.stats.figures >= 3);
    assert.doesNotMatch(res.html, /https?:\/\//i, "output must stay offline and self-contained");
    assert.match(res.html, /viewBox="0 0 \d+ \d+"/);
  });

  test(`committed ${name}.html matches a fresh compile`, () => {
    const res = compileSource(readFileSync(join(ROOT, `examples/${name}.src.html`), "utf8"));
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
