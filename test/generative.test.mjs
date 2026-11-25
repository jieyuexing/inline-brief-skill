// Seeded generative tests for the compiler (zero dependencies).
// Reproduce a failure with IB_SEED=<seed> node --test test/generative.test.mjs;
// every failure message prints the seed, the case index and the sample.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compileSource } from "../skills/inline-brief/scripts/compile.mjs";
import { failMessage, loadPage, makeRng, tokenize } from "./support.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "skills/inline-brief/scripts/compile.mjs");

// ---------------------------------------------------------------------------
// Source generator. Every construct sits on its own line so that the line an
// error reports can be compared with the line that was changed.
// ---------------------------------------------------------------------------

const SAFE_WORDS = ["cache", "read", "write", "Gate", "p95", "merge", "build", "red", "lint", "缓存", "命中", "审查", "a-b", "x/y", "(beta)", "v1.0", "> 3", "it's"];
// Hostile text for data slots (contract: attribute and text slots are data).
const HOSTILE = [
  "<script>alert(1)</script>",
  "</script><script>alert(1)</script>",
  "<!--",
  "-->",
  "<style>",
  "</style>",
  '"><img src=x onerror=alert(1)>',
  "' onmouseover='alert(1)",
  "javascript:alert(1)",
  "onclick=alert(1)",
  "</ib-kpis>",
  "<ib-bogus>",
  "a < b && c > d",
  "&amp;lt; is not <",
  "&lt;b&gt;",
  "Tom & \"Jerry\" 's",
  "]]> <![CDATA[",
];
const TONES = ["neutral", "info", "ok", "warn", "danger"];
const FOCUS = ["k1", "k2", "k3", "k4"];
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Encode logical text for a quoted attribute. `rawLt` keeps "<" and ">" as-is
// (legal inside a quoted HTML attribute value); otherwise they are escaped.
function encAttr(text, rawLt) {
  let s = text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  if (!rawLt) s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `"${s}"`;
}
function encText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Build a page. `text(kind)` supplies logical strings for data slots, so the
// same structural seed can be replayed with hostile or benign text.
function genPage(rng, text, { rawLt = false } = {}) {
  const lines = [];
  const meta = { blocks: [], pickers: [], kpiLabels: [], styleRanges: [], flows: [], steppers: [] };
  const A = (kind) => encAttr(text(kind), rawLt);
  const tone = () => (rng.bool(0.6) ? ` tone="${rng.pick(TONES)}"` : "");
  const focus = () => (rng.bool(0.6) ? ` focus="${rng.shuffle(FOCUS).slice(0, rng.int(1, 2)).join(",")}"` : "");
  const num = () => (rng.bool(0.7) ? String(rng.int(0, 400)) : `${rng.int(0, 99)}.${rng.int(0, 9)}`);

  const blocks = {
    kpis() {
      const out = ["<ib-kpis>"];
      for (let i = rng.int(1, 4); i > 0; i--) {
        const label = text("kpi-label");
        meta.kpiLabels.push(label);
        out.push(`<ib-kpi label=${encAttr(label, rawLt)} value=${A("kpi-value")}${rng.bool() ? ` sub=${A("kpi-sub")}` : ""}${tone()}${focus()}></ib-kpi>`);
      }
      out.push("</ib-kpis>");
      return out;
    },
    bars() {
      const vals = Array.from({ length: rng.int(1, 4) }, num);
      const peak = Math.max(...vals.map(Number));
      const max = rng.bool(0.4) ? ` max="${Math.ceil(peak) + rng.int(1, 50)}"` : "";
      const out = [`<ib-bars title=${A("title")} note=${A("note")} unit=${A("unit")}${max} caption=${A("caption")}>`];
      for (const v of vals) out.push(`<ib-bar label=${A("bar-label")} value="${v}"${tone()}${focus()}></ib-bar>`);
      out.push("</ib-bars>");
      return out;
    },
    trend() {
      const n = rng.int(2, 10);
      const out = [`<ib-trend title=${A("title")}${rng.bool() ? ` unit=${A("unit")}` : ""} caption=${A("caption")}>`];
      for (let i = 0; i < n; i++) {
        const mark = rng.bool(0.15) ? ` mark=${A("mark")}` : "";
        out.push(`<ib-point label=${A("point-label")} value="${num()}"${mark}${tone()}${focus()} />`);
      }
      out.push("</ib-trend>");
      return out;
    },
    flow() {
      const cols = rng.int(1, 4);
      const rows = rng.int(1, 3);
      const cells = rng.shuffle(Array.from({ length: cols * rows }, (_, i) => [1 + (i % cols), 1 + Math.floor(i / cols)]));
      const nodes = cells.slice(0, rng.int(1, Math.min(5, cells.length)));
      const out = [`<ib-flow title=${A("title")} note=${A("note")} caption=${A("caption")}>`];
      nodes.forEach(([c, r], i) => out.push(`<ib-node id="n${i}" col="${c}" row="${r}"${rng.bool() ? ` sub=${A("sub")}` : ""}${tone()}${focus()}>${encText(text("node"))}</ib-node>`));
      const edges = rng.int(0, nodes.length);
      for (let i = 0; i < edges; i++) {
        const curve = rng.pick(["", ' curve="auto"', ' curve="top"', ' curve="bottom"']);
        out.push(`<ib-edge from="n${rng.int(0, nodes.length - 1)}" to="n${rng.int(0, nodes.length - 1)}" label=${encAttr(text("edge") || "calls", rawLt)}${curve}${rng.bool(0.3) ? " dashed" : ""}${tone()}${focus()}></ib-edge>`);
      }
      out.push("</ib-flow>");
      meta.flows.push({ nodes: nodes.length });
      return out;
    },
    lanes() {
      const out = [`<ib-lanes title=${A("title")} caption=${A("caption")}>`];
      for (let l = rng.int(1, 3); l > 0; l--) {
        out.push(`<ib-lane name=${A("lane")}${tone()}>`);
        for (let s = rng.int(1, 3); s > 0; s--) {
          const kind = rng.pick(["", ' kind="action"', ' kind="gate"', ' kind="break"']);
          out.push(`<ib-step${kind}${rng.bool() ? ` note=${A("note")}` : ""}${focus()}>${encText(text("step"))}</ib-step>`);
        }
        out.push("</ib-lane>");
      }
      out.push("</ib-lanes>");
      return out;
    },
    stepper() {
      const out = [`<ib-stepper title=${A("title")} note=${A("note")}>`];
      const stages = [];
      for (let s = rng.int(1, 4); s > 0; s--) {
        const keys = rng.bool(0.8) ? rng.shuffle(FOCUS).slice(0, rng.int(1, 2)).join(",") : "";
        const title = text("stage-title");
        stages.push({ title, keys });
        out.push(`<ib-stage title=${encAttr(title, rawLt)}${keys ? ` focus="${keys}"` : ""}>Stage ${stages.length} <span class="ib-ref" data-focus="${rng.pick(FOCUS)}">ref</span></ib-stage>`);
      }
      out.push("</ib-stepper>");
      meta.steppers.push(stages);
      return out;
    },
    picker() {
      const mode = rng.pick(["triage", "multi", "single", null]);
      const out = [`<ib-picker title=${A("title")} note=${A("note")}${mode ? ` mode="${mode}"` : ""}${rng.bool(0.3) ? ' cols="3"' : ""} caption=${A("caption")}>`];
      const options = [];
      for (let o = rng.int(2, 4); o > 0; o--) {
        const id = `${text("opt-id")}${options.length}`;
        const title = text("opt-title");
        const group = rng.bool(0.7) ? rng.pick(["G1", "G2", "G3"]) : "";
        options.push({ id, title, group });
        const media = rng.pick(["none", "data", "preview"]);
        const src = media === "data" ? ` src="${TINY_PNG}" alt=${A("alt")}` : "";
        out.push(`<ib-option id=${encAttr(id, rawLt)} title=${encAttr(title, rawLt)}${group ? ` group="${group}"` : ""}${rng.bool() ? ` badge=${A("badge")}` : ""}${rng.bool() ? ` sub=${A("sub")}` : ""}${src}${tone()}${focus()}>`);
        if (media === "preview") out.push(`<ib-preview><svg viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10" fill="var(--card)" stroke="var(--border)" /></svg></ib-preview>`);
        out.push(`<p>${encText(text("desc"))}</p>`);
        out.push("</ib-option>");
      }
      out.push("</ib-picker>");
      meta.pickers.push({ mode: mode || "triage", options });
      return out;
    },
    details() {
      return [`<ib-details summary=${A("summary")}>`, `<div>${encText(text("desc"))}</div>`, "</ib-details>"];
    },
    prose() {
      return [`<p>${encText(text("prose"))} <span class="ib-ref" data-focus="${rng.pick(FOCUS)}">ref</span></p>`];
    },
    style() {
      return ["<style>", `.ib-gen-${rng.int(0, 99)} { color: var(--foreground); border: 1px solid var(--border); padding: ${rng.int(0, 9)}px; }`, "</style>"];
    },
  };

  const kinds = Object.keys(blocks);
  lines.push(`<ib-page title=${A("page-title")} lang="${rng.pick(["en", "zh-CN"])}">`);
  const count = rng.int(2, 7);
  for (let b = 0; b < count; b++) {
    const kind = rng.pick(kinds);
    const wrap = kind !== "style" && rng.bool(0.15);
    const start = lines.length;
    if (wrap) lines.push("<ib-grid>");
    lines.push(...blocks[kind]());
    if (wrap && rng.bool()) lines.push(...blocks.prose());
    if (wrap) lines.push("</ib-grid>");
    meta.blocks.push({ kind, start, end: lines.length - 1 });
    if (kind === "style") meta.styleRanges.push([start + 1, lines.length - 1]);
  }
  lines.push("</ib-page>");
  return { lines, meta };
}

const safeText = (rng) => (kind) => {
  if (kind === "opt-id") return rng.pick(["A", "B", "opt", "方案"]);
  const n = rng.int(1, 3);
  return Array.from({ length: n }, () => rng.pick(SAFE_WORDS)).join(" ");
};

// ---------------------------------------------------------------------------
// Independent output checker. It parses the compiled page with the test
// tokenizer instead of reusing the compiler's own lint.
// Contracts: AGENTS.md "Hard rules for generated pages" (no external URLs,
// vh/dvh units, height:100% on html/body or hardcoded colors) and
// references/t3-contract.md.
// ---------------------------------------------------------------------------

const URL_ATTRS = new Set(["src", "href", "srcset", "poster", "data", "action", "formaction", "xlink:href", "background"]);
const NAMED = ["red", "blue", "green", "white", "black", "gray", "grey", "orange", "yellow", "purple", "pink", "tomato", "navy", "teal", "silver", "gold", "maroon", "olive", "lime", "aqua", "fuchsia", "crimson", "coral"];
const COLOR_RE = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|(?<![-\\w])(?:${NAMED.join("|")})(?![-\\w])`, "i");
const EXTERNAL_RE = /^\s*(?:https?:)?\/\//i;

function cssDeclBodies(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules = [];
  let boundary = 0;
  let selStart = 0;
  let open = -1;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{") {
      open = i;
      selStart = boundary;
      boundary = i + 1;
    } else if (ch === "}") {
      if (open >= 0) rules.push({ selector: clean.slice(selStart, open).trim(), body: clean.slice(open + 1, i) });
      open = -1;
      boundary = i + 1;
    } else if (ch === ";" && open < 0) {
      boundary = i + 1;
    }
  }
  return rules;
}

function declValues(body) {
  return body
    .split(";")
    .map((d) => d.split(":"))
    .filter((p) => p.length > 1)
    .map(([prop, ...rest]) => ({ prop: prop.trim().toLowerCase(), value: rest.join(":").replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""') }));
}

export function outputViolations(html) {
  const v = [];
  const tokens = tokenize(html);
  const cssChunks = [];
  let inStyle = false;
  let inScript = false;
  for (const t of tokens) {
    if (t.type === "start") {
      if (["iframe", "object", "embed", "link", "base", "frame"].includes(t.name)) v.push(`embed/link tag <${t.name}>`);
      for (const [name, value] of t.attrs) {
        if (URL_ATTRS.has(name)) {
          const parts = name === "srcset" ? value.split(",").map((p) => p.trim().split(/\s+/)[0]) : [value];
          if (parts.some((p) => EXTERNAL_RE.test(p))) v.push(`external <${t.name} ${name}="${value}">`);
        }
        if (name === "style") cssChunks.push({ decls: declValues(value), selector: t.name });
        if (["fill", "stroke", "stop-color", "flood-color", "lighting-color"].includes(name) && !/^(?:none|transparent|currentcolor|var\(--[\w-]+(?:\s*,.*)?\)|url\(#[\w-]+\))$/i.test(value.trim())) {
          v.push(`hardcoded SVG ${name}="${value}"`);
        }
      }
      inStyle = t.name === "style";
      inScript = t.name === "script";
    } else if (t.type === "text" && t.raw && inStyle) {
      if (/@import/i.test(t.text)) v.push("@import in CSS");
      for (const r of cssDeclBodies(t.text)) cssChunks.push({ decls: declValues(r.body), selector: r.selector });
      inStyle = false;
    } else if (t.type === "text" && t.raw && inScript) {
      if (/https?:\/\//i.test(t.text)) v.push("URL inside <script>");
      inScript = false;
    }
  }
  for (const { decls, selector } of cssChunks) {
    const rootSel = /(?:^|[\s,>+~])(?:html|body|:root)(?![-\w])/i.test(` ${selector}`);
    for (const d of decls) {
      if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(d.value)) v.push(`external url() in ${d.prop}`);
      if (/(?<![\w-])(?:\d*\.)?\d+(?:d|s|l)?vh\b/i.test(d.value)) v.push(`viewport unit in ${d.prop}: ${d.value.trim()}`);
      if (COLOR_RE.test(d.value)) v.push(`hardcoded color in ${selector} { ${d.prop}: ${d.value.trim()} }`);
      if (rootSel && d.prop === "height" && /^\s*(?:100%|calc\(\s*100%\s*\))\s*(?:!important)?\s*$/i.test(d.value)) v.push(`height:100% on ${selector}`);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// I1: valid random sources compile cleanly, deterministically and safely.
// ---------------------------------------------------------------------------

test("checker sanity: the independent output checker flags known-bad pages and passes a clean compile", () => {
  const clean = compileSource(`<ib-page title="T"><p>ok</p></ib-page>`);
  assert.deepEqual(outputViolations(clean.html), [], "base kit must satisfy the independent checker");
  const bad = [
    '<img src="https://example.com/a.png">',
    '<link rel="stylesheet" href="//cdn.example.com/x.css">',
    '<p style="color: #ff0000">x</p>',
    '<p style="height: 50vh">x</p>',
    "<style>body { height: 100% }</style>",
    '<svg viewBox="0 0 1 1"><rect fill="tomato" /></svg>',
    '<p style="background: url(https://example.com/x.png)">x</p>',
  ];
  for (const b of bad) {
    assert.ok(outputViolations(`<html><body>${b}</body></html>`).length > 0, `checker missed: ${b}`);
  }
});

test("generative I1: random valid sources compile with zero errors, deterministically and within the page contract", () => {
  const salt = "i1-valid";
  const rng = makeRng(salt);
  for (let i = 0; i < 80; i++) {
    const { lines } = genPage(rng, safeText(rng), { rawLt: rng.bool(0.5) });
    const src = lines.join("\n");
    const a = compileSource(src);
    assert.deepEqual(a.errors, [], failMessage(salt, i, "valid source produced errors", src));
    const b = compileSource(src);
    assert.equal(a.html, b.html, failMessage(salt, i, "two compiles of one source differ", src));
    assert.deepEqual(a.warnings, b.warnings, failMessage(salt, i, "warnings differ between compiles", src));
    assert.deepEqual(outputViolations(a.html), [], failMessage(salt, i, "compiled page breaks the output contract", src));
  }
});

// ---------------------------------------------------------------------------
// I1: a single injected illegal item must be reported, on its own line only.
// ---------------------------------------------------------------------------

const INJECTIONS = {
  unknownTag: () => "<ib-bogus>x</ib-bogus>",
  externalImg: () => '<img src="https://example.com/a.png" alt="x">',
  externalLink: () => '<link rel="stylesheet" href="//cdn.example.com/x.css">',
  externalScript: () => '<script src="https://example.com/x.js"></script>',
  externalStyleUrl: () => '<p style="background: url(https://example.com/b.png)">x</p>',
  inlineHex: () => '<p style="color: #c0ffee">x</p>',
  svgNamedFill: () => '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="tomato" /></svg>',
};

function injectOnce(rng, rawLt) {
  const { lines, meta } = genPage(rng, rng.bool(0.5) ? safeText(rng) : hostileText(rng), { rawLt });
  const kind = rng.pick(["insert", "insert", "insert", "caption", "edge", "cssColor"]);
  const inStyle = (idx) => meta.styleRanges.some(([s, e]) => idx >= s && idx <= e);
  if (kind === "caption") {
    const candidates = lines.map((l, idx) => (/^<ib-(?:flow|trend) /.test(l) ? idx : -1)).filter((x) => x >= 0);
    if (candidates.length) {
      const idx = rng.pick(candidates);
      lines[idx] = lines[idx].replace(/ caption=(?:"[^"]*")/, "");
      return { lines, line: idx + 1, what: "missing caption" };
    }
  }
  if (kind === "edge") {
    const flowEnds = lines.map((l, idx) => (l === "</ib-flow>" ? idx : -1)).filter((x) => x >= 0);
    if (flowEnds.length) {
      const idx = rng.pick(flowEnds);
      lines.splice(idx, 0, '<ib-edge from="n0" to="n0"></ib-edge>');
      return { lines, line: idx + 1, what: "edge without a verb label" };
    }
  }
  if (kind === "cssColor" && meta.styleRanges.length) {
    const [s] = rng.pick(meta.styleRanges);
    lines.splice(s, 0, `.ib-bad { border-color: ${rng.pick(["rgb(1, 2, 3)", "#abc", "crimson", "hsl(0 0% 0%)"])}; }`);
    return { lines, line: s + 1, what: "hardcoded color in <style>" };
  }
  let idx;
  do idx = rng.int(1, lines.length - 1);
  while (inStyle(idx));
  const name = rng.pick(Object.keys(INJECTIONS));
  lines.splice(idx, 0, INJECTIONS[name]());
  return { lines, line: idx + 1, what: name };
}

test("generative I1: one injected illegal item is reported, and every error points at the injected line", () => {
  const salt = "i1-inject";
  const rng = makeRng(salt);
  for (let i = 0; i < 120; i++) {
    const { lines, line, what } = injectOnce(rng, rng.bool(0.5));
    const src = lines.join("\n");
    const res = compileSource(src);
    assert.ok(res.errors.length > 0, failMessage(salt, i, `injected ${what} at line ${line} was not reported`, src));
    for (const e of res.errors) {
      assert.ok(e.startsWith(`line ${line}`), failMessage(salt, i, `injected ${what} at line ${line}, but got error "${e}"`, src));
    }
  }
});

test("generative I1: --check and a real compile report the same errors and exit code", () => {
  const salt = "i1-cli";
  const rng = makeRng(salt);
  const dir = mkdtempSync(join(tmpdir(), "ib-gen-"));
  try {
    for (let i = 0; i < 6; i++) {
      const lines = i % 2 ? injectOnce(rng, false).lines : genPage(rng, safeText(rng)).lines;
      const src = lines.join("\n");
      const input = join(dir, `case${i}.src.html`);
      const output = join(dir, `case${i}.html`);
      writeFileSync(input, src);
      const check = spawnSync(process.execPath, [CLI, input, "--check"], { encoding: "utf8" });
      assert.equal(existsSync(output), false, failMessage(salt, i, "--check wrote output", src));
      const full = spawnSync(process.execPath, [CLI, input, output], { encoding: "utf8" });
      const errs = (r) => r.stderr.split("\n").filter((l) => l.startsWith("ERROR")).sort();
      assert.equal(check.status, full.status, failMessage(salt, i, "exit codes differ", src));
      assert.deepEqual(errs(check), errs(full), failMessage(salt, i, "error sets differ", src));
      assert.equal(existsSync(output), full.status === 0, failMessage(salt, i, "output presence does not match exit code", src));
      rmSync(output, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// I2: hostile text in data slots (attributes, node and step text) must stay
// data. Contract: references/components.md lists these as attributes/labels;
// the compiler escapes them (compile.mjs escHtml). Passthrough HTML (stage,
// option and details bodies, previews, page prose) is author HTML by design
// and is not a data slot.
// ---------------------------------------------------------------------------

function hostileText(rng) {
  return (kind) => {
    if (kind === "opt-id") return rng.pick(HOSTILE).trim() || "x";
    return rng.bool(0.7) ? rng.pick(HOSTILE).trim() : `${rng.pick(SAFE_WORDS)} ${rng.pick(HOSTILE)}`.trim();
  };
}

// Shape of a page: element names with attribute names, plus URL-attribute
// values and the full text of every raw <script>/<style>.
function shape(html) {
  return tokenize(html)
    .filter((t) => t.type === "start" || t.type === "end" || t.raw)
    .map((t) => {
      if (t.raw) return `raw:${t.text}`;
      if (t.type === "end") return `/${t.name}`;
      const attrs = t.attrs
        .map(([n, v]) => (URL_ATTRS.has(n) ? `${n}=${v}` : n))
        .sort()
        .join(" ");
      return `<${t.name} ${attrs}>`;
    });
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `#${i}: benign=${b[i]} hostile=${a[i]}`;
  return "";
}

function expectedSummary(picker, marks) {
  const parts = [];
  const lab = (o) => `${o.id.trim()} ${o.title.trim()}`;
  if (picker.mode === "triage") {
    const like = picker.options.filter((o, i) => marks[i] === "like").map(lab);
    const skip = picker.options.filter((o, i) => marks[i] === "skip").map(lab);
    if (like.length) parts.push(`${picker.zh ? "心仪：" : "Shortlist: "}${like.join(picker.zh ? "、" : ", ")}`);
    if (skip.length) parts.push(`${picker.zh ? "排除：" : "Skip: "}${skip.join(picker.zh ? "、" : ", ")}`);
  } else {
    const sel = picker.options.filter((o, i) => marks[i] === "select").map(lab);
    if (sel.length) parts.push(`${picker.zh ? "已选：" : "Selected: "}${sel.join(picker.zh ? "、" : ", ")}`);
  }
  return parts.join(picker.zh ? " ｜ " : " | ");
}

test("generative I2: hostile attribute and label text never changes page structure and round-trips through the picker copy", async () => {
  const salt = "i2-escape";
  const rng = makeRng(salt);
  for (let i = 0; i < 60; i++) {
    const structureSeed = `${salt}-${i}`;
    const rawLt = rng.bool(0.5);
    const hostileRng = makeRng(`${structureSeed}-text`);
    const hostile = genPage(makeRng(structureSeed), hostileText(hostileRng), { rawLt });
    // The benign twin gets text of the same estimated width (compile.mjs approxLabelWidth:
    // ASCII vs non-ASCII), so width-driven layout (trend label thinning) matches and only
    // escaping can make the two pages differ.
    const twinText = hostileText(makeRng(`${structureSeed}-text`));
    const benign = genPage(makeRng(structureSeed), (kind) => [...twinText(kind)].map((ch) => (ch.charCodeAt(0) > 127 ? "中" : "x")).join(""), { rawLt });
    const src = hostile.lines.join("\n");
    const hRes = compileSource(src);
    const bRes = compileSource(benign.lines.join("\n"));
    assert.deepEqual(bRes.errors, [], failMessage(salt, i, "benign twin failed to compile", benign.lines.join("\n")));
    assert.deepEqual(hRes.errors, [], failMessage(salt, i, "hostile text in data slots produced errors", src));
    const diff = firstDiff(shape(hRes.html), shape(bRes.html));
    assert.equal(diff, "", failMessage(salt, i, `hostile text changed the page structure ${diff}`, src));
    assert.deepEqual(outputViolations(hRes.html), [], failMessage(salt, i, "hostile page breaks the output contract", src));

    // Round trip: KPI labels render as the exact logical text.
    const page = loadPage(hRes.html, vm);
    const kpiLabels = page.root.querySelectorAll(".ib-kpi-label").map((e) => e.textContent);
    assert.deepEqual(kpiLabels, hostile.meta.kpiLabels, failMessage(salt, i, "KPI label text did not round-trip", src));

    // Round trip: marking every option and copying yields the logical id + title.
    const zh = /lang="zh/.test(hostile.lines[0]);
    const pickers = page.root.querySelectorAll(".ib-picker");
    for (let p = 0; p < pickers.length; p++) {
      const model = { ...hostile.meta.pickers[p], zh };
      const cards = pickers[p].querySelectorAll(".ib-opt");
      const marks = [];
      for (let c = 0; c < cards.length; c++) {
        const act = model.mode === "triage" ? rng.pick(["like", "skip", null]) : model.mode === "multi" ? rng.pick(["select", null]) : null;
        marks.push(act);
        if (act) await page.click(cards[c].querySelector(`[data-pick-act="${act}"]`));
      }
      if (model.mode === "single") {
        const c = rng.int(0, cards.length - 1);
        marks[c] = "select";
        await page.click(cards[c].querySelector('[data-pick-act="select"]'));
      }
      const expected = expectedSummary(model, marks);
      if (!expected) continue;
      page.clipboard.length = 0;
      await page.click(pickers[p].querySelector("[data-pick-copy]"));
      assert.deepEqual(page.clipboard, [expected], failMessage(salt, i, `picker ${p} copy text did not round-trip`, src));
    }
  }
});
