import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    const text = readFileSync(f, "utf8");
    for (const b of banned) assert.ok(!text.includes(b), `${f} contains "${b}"`);
  }
});
