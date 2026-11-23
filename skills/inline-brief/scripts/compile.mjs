#!/usr/bin/env node
/**
 * inline-brief compiler & static T3 html_render contract linter.
 * Zero external dependencies (Node >= 20 ESM).
 *
 * Usage:
 *   node scripts/compile.mjs <input.src.html> [output.html] [--check]
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = resolve(__dirname, "../kit");

// Single version source for every install path (copied skill directories ship without package.json).
export const VERSION = "0.1.1";

const TONE_STROKE = {
  neutral: "var(--border)",
  info: "var(--info)",
  ok: "var(--success)",
  warn: "var(--warning)",
  danger: "var(--destructive)",
};

const TONE_TEXT = {
  neutral: "var(--foreground)",
  info: "var(--info)",
  ok: "var(--success)",
  warn: "var(--warning)",
  danger: "var(--destructive)",
};

const TONE_EDGE = {
  neutral: "var(--muted-foreground)",
  info: "var(--info)",
  ok: "var(--success)",
  warn: "var(--warning)",
  danger: "var(--destructive)",
};

const VALID_TONES = new Set(["neutral", "info", "ok", "warn", "danger"]);
const VALID_KINDS = new Set(["action", "gate", "break"]);
const VALID_CURVES = new Set(["auto", "top", "bottom"]);

// Standard CSS Color 4 named colors (excluding allowed keywords like transparent / currentColor).
const NAMED_COLORS = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond",
  "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue",
  "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey",
  "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon",
  "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia",
  "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew", "hotpink",
  "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon",
  "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey",
  "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen",
  "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite",
  "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen",
  "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
  "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke",
  "yellow", "yellowgreen",
]);

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescBasic(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function maskKeepNewlines(s) {
  return s.replace(/[^\n]/g, " ");
}

function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, maskKeepNewlines);
}

function lineAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = unescBasic(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

// Attribute text up to the tag's closing ">", allowing ">" inside quoted values.
const ATTR_SRC = `((?:[^>"']|"[^"]*"|'[^']*')*?)`;

function parseChildTags(body, tagName, sourceOffset, fullSource) {
  const results = [];
  const re = new RegExp(`<${tagName}\\b${ATTR_SRC}(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`, "g");
  let m;
  while ((m = re.exec(body)) !== null) {
    const rawInner = m[2] ?? "";
    const leadWs = rawInner.length - rawInner.trimStart().length;
    const innerOffset =
      m[2] !== undefined
        ? sourceOffset + m.index + 1 + tagName.length + (m[1] || "").length + 1 + leadWs
        : sourceOffset + m.index;
    results.push({
      attrs: parseAttrs(m[1] || ""),
      inner: rawInner.trim(),
      innerOffset,
      line: lineAt(fullSource, sourceOffset + m.index),
    });
  }
  return results;
}

function parseNonNegativeNumber(raw) {
  if (raw === undefined || raw === null) return { valid: false, num: 0 };
  const s = String(raw).trim();
  if (!s || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return { valid: false, num: 0 };
  const num = Number(s);
  if (!Number.isFinite(num) || num < 0) return { valid: false, num: 0 };
  return { valid: true, num };
}

function parsePositiveNumber(raw) {
  if (raw === undefined || raw === null) return { valid: false, num: 0 };
  const s = String(raw).trim();
  if (!s || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return { valid: false, num: 0 };
  const num = Number(s);
  if (!Number.isFinite(num) || num <= 0) return { valid: false, num: 0 };
  return { valid: true, num };
}

function validateTone(rawTone, line, tagName, ctx) {
  if (rawTone === undefined) return "neutral";
  if (!VALID_TONES.has(rawTone)) {
    ctx.errors.push(`line ${line} <${tagName}>: unknown tone="${rawTone}" (expected neutral, info, ok, warn, danger)`);
    return "neutral";
  }
  return rawTone;
}

function parseFocusKeys(val) {
  return String(val || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function focusAttr(val) {
  if (!val) return "";
  return ` data-focus="${escHtml(val)}"`;
}

function approxLabelWidth(text) {
  let w = 0;
  for (const ch of String(text || "")) {
    w += ch.charCodeAt(0) > 127 ? 10.5 : 6.2;
  }
  return w;
}

function renderKpis(attrs, body, offset, src, ctx) {
  const items = parseChildTags(body, "ib-kpi", offset, src);
  if (!items.length) {
    ctx.errors.push(`line ${lineAt(src, offset)} <ib-kpis>: must contain at least one <ib-kpi>`);
    return "";
  }
  const cols = Math.min(4, Math.max(2, items.length));
  const cards = items
    .map((it) => {
      const tone = validateTone(it.attrs.tone, it.line, "ib-kpi", ctx);
      const valCls = tone !== "neutral" ? ` ib-tone-${escHtml(tone)}` : "";
      const sub = it.attrs.sub ? `<div class="ib-kpi-sub">${escHtml(it.attrs.sub)}</div>` : "";
      return `<div class="ib-kpi"${focusAttr(it.attrs.focus)}>
        <div class="ib-kpi-label">${escHtml(it.attrs.label || "")}</div>
        <div class="ib-kpi-val${valCls}">${escHtml(it.attrs.value || "")}</div>
        ${sub}
      </div>`;
    })
    .join("\n");
  return `<div class="ib-kpis" style="--ib-kpi-cols:${cols}">${cards}</div>`;
}

function renderBars(attrs, body, offset, src, ctx) {
  const barLine = lineAt(src, offset);
  const items = parseChildTags(body, "ib-bar", offset, src);
  if (!items.length) {
    ctx.errors.push(`line ${barLine} <ib-bars>: must contain at least one <ib-bar>`);
    return "";
  }
  const unit = attrs.unit || "";
  const parsed = items.map((it) => {
    const { valid, num } = parseNonNegativeNumber(it.attrs.value);
    if (!valid) {
      ctx.errors.push(`line ${it.line} <ib-bar>: value="${it.attrs.value ?? ""}" must be a non-negative number`);
    }
    const tone = validateTone(it.attrs.tone, it.line, "ib-bar", ctx);
    return { ...it, num, tone };
  });
  const peak = Math.max(...parsed.map((p) => p.num), 0);
  let denom = Math.max(peak, 1);
  if (attrs.max !== undefined) {
    const { valid, num } = parsePositiveNumber(attrs.max);
    if (!valid) {
      ctx.errors.push(`line ${barLine} <ib-bars>: max="${attrs.max}" must be > 0`);
    } else if (num < peak) {
      ctx.errors.push(`line ${barLine} <ib-bars>: max="${attrs.max}" is below the largest value ${peak}`);
      denom = Math.max(peak, 1);
    } else {
      denom = num;
    }
  }
  ctx.stats.figures += 1;

  const rows = parsed
    .map((p) => {
      const pct = Math.min(100, Math.max(0, (p.num / denom) * 100));
      const valText = unit ? `${p.num} ${unit}` : String(p.num);
      return `<div class="ib-bar-row"${focusAttr(p.attrs.focus)}>
        <div class="ib-bar-lbl" title="${escHtml(p.attrs.label || "")}">${escHtml(p.attrs.label || "")}</div>
        <div class="ib-bar-track"><div class="ib-bar-fill ib-fill-${escHtml(p.tone)}" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="ib-bar-num">${escHtml(valText)}</div>
      </div>`;
    })
    .join("\n");

  const cap = attrs.caption ? `<div class="ib-caption">${escHtml(attrs.caption)}</div>` : "";
  return `<div class="ib-card">
    <div class="ib-head">
      <div class="ib-title">${escHtml(attrs.title || "")}</div>
      ${attrs.note ? `<div class="ib-note">${escHtml(attrs.note)}</div>` : ""}
    </div>
    <div class="ib-bars">${rows}</div>
    ${cap}
  </div>`;
}

function renderFlow(attrs, body, offset, src, ctx) {
  const flowLine = lineAt(src, offset);
  if (!attrs.caption) {
    ctx.errors.push(`line ${flowLine} <ib-flow>: missing required caption attribute (state the figure's claim)`);
  }
  const nodes = parseChildTags(body, "ib-node", offset, src);
  const edges = parseChildTags(body, "ib-edge", offset, src);
  if (!nodes.length) {
    ctx.errors.push(`line ${flowLine} <ib-flow>: must contain at least one <ib-node>`);
    return "";
  }
  ctx.stats.figures += 1;

  const nodeMap = new Map();
  const cellMap = new Map();
  let maxCol = 1;
  let maxRow = 1;
  for (const n of nodes) {
    const id = n.attrs.id;
    const col = Number(n.attrs.col || 1);
    const row = Number(n.attrs.row || 1);
    const tone = validateTone(n.attrs.tone, n.line, "ib-node", ctx);
    if (!id) {
      ctx.errors.push(`line ${n.line} <ib-node>: missing id attribute`);
      continue;
    }
    if (nodeMap.has(id)) {
      ctx.errors.push(`line ${n.line} <ib-node id="${id}">: duplicate node id`);
      continue;
    }
    if (!Number.isInteger(col) || col < 1 || !Number.isInteger(row) || row < 1) {
      ctx.errors.push(`line ${n.line} <ib-node id="${id}">: col/row must be positive integers`);
      continue;
    }
    const cellKey = `${col},${row}`;
    if (cellMap.has(cellKey)) {
      ctx.errors.push(`line ${n.line} <ib-node id="${id}">: cell (${col}, ${row}) collides with <ib-node id="${cellMap.get(cellKey)}">`);
    } else {
      cellMap.set(cellKey, id);
    }
    const label = unescBasic(n.inner);
    if (approxLabelWidth(label) > 138) {
      ctx.warnings.push(`line ${n.line} <ib-node id="${id}">: label "${label}" may crowd on 728px; consider shortening`);
    }
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    nodeMap.set(id, { ...n, id, col, row, label, tone });
  }

  for (const e of edges) {
    if (!nodeMap.has(e.attrs.from)) {
      ctx.errors.push(`line ${e.line} <ib-edge>: unknown from="${e.attrs.from ?? ""}"`);
    }
    if (!nodeMap.has(e.attrs.to)) {
      ctx.errors.push(`line ${e.line} <ib-edge>: unknown to="${e.attrs.to ?? ""}"`);
    }
    validateTone(e.attrs.tone, e.line, "ib-edge", ctx);
    if (e.attrs.curve !== undefined && !VALID_CURVES.has(e.attrs.curve)) {
      ctx.errors.push(`line ${e.line} <ib-edge>: unknown curve="${e.attrs.curve}" (expected auto, top, bottom)`);
    }
    if (e.attrs.label && approxLabelWidth(e.attrs.label) > 125) {
      ctx.warnings.push(`line ${e.line} <ib-edge>: label "${e.attrs.label}" may overlap adjacent nodes`);
    }
  }

  const hasTopCurve = edges.some((e) => e.attrs.curve === "top");
  const hasBottomCurve = edges.some((e) => e.attrs.curve === "bottom");

  const svgW = 680;
  const padX = 12;
  const padTop = hasTopCurve ? 46 : 14;
  const padBottom = hasBottomCurve ? 50 : 14;
  const gapX = maxCol >= 4 ? 58 : 64;
  const gapY = 48;
  const nodeH = 56;
  const rawNodeW = Math.floor((svgW - padX * 2 - gapX * (maxCol - 1)) / maxCol);
  if (rawNodeW <= 0) {
    ctx.errors.push(`line ${flowLine} <ib-flow>: too many columns (${maxCol}) for 680px diagram (node width ${rawNodeW}px <= 0)`);
  }
  const nodeW = Math.max(1, rawNodeW);
  const svgH = padTop + maxRow * nodeH + (maxRow - 1) * gapY + padBottom;

  for (const n of nodeMap.values()) {
    n.x = padX + (n.col - 1) * (nodeW + gapX);
    n.y = padTop + (n.row - 1) * (nodeH + gapY);
    n.cx = n.x + nodeW / 2;
    n.cy = n.y + nodeH / 2;
  }

  const markerId = (tone) => `ib-arr-${ctx.stats.figures}-${tone}`;
  const defs = Object.entries(TONE_EDGE)
    .map(
      ([tone, color]) =>
        `<marker id="${markerId(tone)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="${color}" /></marker>`
    )
    .join("");

  const edgePathSvgs = [];
  const edgeLabelSvgs = [];

  for (const e of edges) {
    if (!nodeMap.has(e.attrs.from) || !nodeMap.has(e.attrs.to)) continue;
    const a = nodeMap.get(e.attrs.from);
    const b = nodeMap.get(e.attrs.to);
    const tone = TONE_EDGE[e.attrs.tone] ? e.attrs.tone : "neutral";
    const stroke = TONE_EDGE[tone];
    const dash = "dashed" in e.attrs ? ` stroke-dasharray="5,3"` : "";
    const curve = e.attrs.curve || "auto";

    let d = "";
    let lx = (a.cx + b.cx) / 2;
    let ly = (a.cy + b.cy) / 2;
    let isAdjHorizontal = false;

    if (curve === "bottom") {
      const yBot = Math.max(a.y, b.y) + nodeH;
      const laneY = yBot + 30;
      d = `M ${a.cx} ${yBot} L ${a.cx} ${laneY} L ${b.cx} ${laneY} L ${b.cx} ${b.y + nodeH + 3}`;
      lx = (a.cx + b.cx) / 2;
      ly = laneY;
    } else if (curve === "top") {
      const yTop = Math.min(a.y, b.y);
      const laneY = yTop - 28;
      d = `M ${a.cx} ${a.y} L ${a.cx} ${laneY} L ${b.cx} ${laneY} L ${b.cx} ${b.y - 3}`;
      lx = (a.cx + b.cx) / 2;
      ly = laneY;
    } else if (a.row === b.row && Math.abs(b.col - a.col) === 1) {
      isAdjHorizontal = true;
      const right = b.col > a.col;
      const x1 = right ? a.x + nodeW : a.x;
      const x2 = right ? b.x - 3 : b.x + nodeW + 3;
      d = `M ${x1} ${a.cy} L ${x2} ${b.cy}`;
      lx = (x1 + x2) / 2;
      ly = a.cy - 14;
    } else if (a.col === b.col) {
      const down = b.row > a.row;
      const y1 = down ? a.y + nodeH : a.y;
      const y2 = down ? b.y - 3 : b.y + nodeH + 3;
      d = `M ${a.cx} ${y1} L ${b.cx} ${y2}`;
      lx = a.cx;
      ly = (y1 + y2) / 2;
    } else {
      const x1 = a.cx;
      const y1 = b.row > a.row ? a.y + nodeH : a.y;
      const x2 = b.cx;
      const y2 = b.row > a.row ? b.y - 3 : b.y + nodeH + 3;
      const midY = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      lx = (x1 + x2) / 2;
      ly = midY;
    }

    edgePathSvgs.push(
      `<g class="ib-edge"${focusAttr(e.attrs.focus)}><path class="ib-edge-path" d="${d}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash} marker-end="url(#${markerId(tone)})" /></g>`
    );

    if (e.attrs.label) {
      const pillW = Math.max(40, Math.ceil(approxLabelWidth(e.attrs.label) * 0.92 + 10));
      const pillH = 16;
      if (isAdjHorizontal && pillW > gapX - 2) {
        ctx.warnings.push(`line ${e.line} <ib-edge>: label "${e.attrs.label}" (${pillW}px) exceeds horizontal gap (${gapX}px); shorten label`);
      }
      edgeLabelSvgs.push(
        `<g class="ib-edge"${focusAttr(e.attrs.focus)}>
          <rect x="${(lx - pillW / 2).toFixed(1)}" y="${(ly - pillH / 2).toFixed(1)}" width="${pillW}" height="${pillH}" rx="8" fill="var(--card)" stroke="var(--border)" stroke-width="0.9" />
          <text x="${lx.toFixed(1)}" y="${(ly + 3.2).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${stroke}">${escHtml(e.attrs.label)}</text>
        </g>`
      );
    }
  }

  const nodeSvgs = Array.from(nodeMap.values())
    .map((n) => {
      const tone = n.tone;
      const stroke = TONE_STROKE[tone];
      const titleColor = TONE_TEXT[tone];
      const fill = tone === "ok" ? "var(--accent-surface, var(--secondary))" : "var(--secondary)";
      const hasSub = Boolean(n.attrs.sub);
      const titleY = hasSub ? n.y + 23 : n.y + 32;
      const subSvg = hasSub
        ? `<text x="${n.cx.toFixed(1)}" y="${(n.y + 40).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted-foreground)">${escHtml(n.attrs.sub)}</text>`
        : "";
      return `<g class="ib-node"${focusAttr(n.attrs.focus)}>
        <rect class="ib-node-box" x="${n.x}" y="${n.y}" width="${nodeW}" height="${nodeH}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.4" />
        <text x="${n.cx.toFixed(1)}" y="${titleY.toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${titleColor}">${escHtml(n.label)}</text>
        ${subSvg}
      </g>`;
    })
    .join("\n");

  return `<div class="ib-card">
    <div class="ib-head">
      <div class="ib-title">${escHtml(attrs.title || "")}</div>
      ${attrs.note ? `<div class="ib-note">${escHtml(attrs.note)}</div>` : ""}
    </div>
    <div class="ib-flow-wrap">
      <svg class="ib-flow-svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" preserveAspectRatio="xMidYMid meet">
        <defs>${defs}</defs>
        ${edgePathSvgs.join("\n")}
        ${nodeSvgs}
        ${edgeLabelSvgs.join("\n")}
      </svg>
    </div>
    <div class="ib-caption">${escHtml(attrs.caption || "")}</div>
  </div>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

function fmtNum(n) {
  const [int, frac] = String(Number(n.toFixed(2))).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}

function anchorFor(x, w, svgW) {
  if (x - w / 2 < 4) return "start";
  if (x + w / 2 > svgW - 4) return "end";
  return "middle";
}

function renderTrend(attrs, body, offset, src, ctx) {
  const line = lineAt(src, offset);
  if (!attrs.caption) {
    ctx.errors.push(`line ${line} <ib-trend>: missing required caption attribute (state the figure's claim)`);
  }
  const items = parseChildTags(body, "ib-point", offset, src);
  if (items.length < 2) {
    ctx.errors.push(`line ${line} <ib-trend>: needs at least 2 <ib-point> (found ${items.length})`);
    return "";
  }
  ctx.stats.figures += 1;

  const pts = items.map((it) => {
    const { valid, num } = parseNonNegativeNumber(it.attrs.value);
    if (!valid) {
      ctx.errors.push(`line ${it.line} <ib-point>: value="${it.attrs.value ?? ""}" must be a non-negative number`);
    }
    if (!it.attrs.label) {
      ctx.errors.push(`line ${it.line} <ib-point>: missing label attribute`);
    }
    const tone = validateTone(it.attrs.tone, it.line, "ib-point", ctx);
    return { ...it, num, tone, label: it.attrs.label || "", mark: it.attrs.mark || "" };
  });

  const peak = Math.max(...pts.map((p) => p.num));
  let top;
  let step;
  if (attrs.max !== undefined && attrs.max !== "") {
    const { valid, num } = parsePositiveNumber(attrs.max);
    if (!valid) {
      ctx.errors.push(`line ${line} <ib-trend>: max="${attrs.max}" must be > 0`);
      top = 4;
    } else if (num < peak) {
      ctx.errors.push(`line ${line} <ib-trend>: max="${attrs.max}" is below the largest value ${peak}`);
      top = peak;
    } else {
      top = num;
    }
    step = top / 4;
  } else if (peak > 0) {
    step = niceStep(peak / 4);
    top = step * Math.ceil(peak / step);
  } else {
    step = 1;
    top = 4;
  }
  const tickCount = Math.max(1, Math.round(top / step));

  const svgW = 560;
  const padL = 46;
  const padR = 18;
  const padT = 34;
  const padB = 32;
  const plotW = svgW - padL - padR;
  const plotH = 168;
  const svgH = padT + plotH + padB;
  const baseY = padT + plotH;
  const n = pts.length;
  const xAt = (i) => padL + (plotW * i) / (n - 1);
  const yAt = (v) => baseY - (Math.min(v, top) / top) * plotH;

  const grid = [];
  for (let t = 0; t <= tickCount; t++) {
    const v = (top * t) / tickCount;
    const y = yAt(v);
    const dash = t === 0 ? "" : ` stroke-dasharray="2,4"`;
    grid.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"${dash} />`);
    grid.push(`<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" font-family="var(--font-mono, monospace)" fill="var(--muted-foreground)">${fmtNum(v)}</text>`);
  }

  const maxLabelW = Math.max(...pts.map((p) => approxLabelWidth(p.label)));
  const fit = Math.max(1, Math.floor(plotW / (maxLabelW + 20)));
  const every = Math.max(1, Math.ceil(n / fit));
  const shown = [];
  for (let i = 0; i < n; i++) if (i % every === 0) shown.push(i);
  if (!shown.includes(n - 1) && (n - 1 - shown[shown.length - 1]) * (plotW / (n - 1)) >= maxLabelW + 24) {
    shown.push(n - 1);
  }
  const xLabels = shown
    .map((i) => {
      const w = approxLabelWidth(pts[i].label);
      return `<text x="${xAt(i).toFixed(1)}" y="${baseY + 18}" text-anchor="${anchorFor(xAt(i), w, svgW)}" font-size="11" fill="var(--muted-foreground)">${escHtml(pts[i].label)}</text>`;
    })
    .join("");

  const coords = pts.map((p, i) => ({ x: xAt(i), y: yAt(p.num) }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[n - 1].x.toFixed(1)} ${baseY} L ${coords[0].x.toFixed(1)} ${baseY} Z`;

  const peakIdx = pts.findIndex((p) => p.num === peak);
  const labelAll = n <= 8;
  const markSvgs = [];
  let prevMark = null;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (!p.mark) continue;
    const color = p.tone !== "neutral" ? TONE_EDGE[p.tone] : "var(--muted-foreground)";
    const w = approxLabelWidth(p.mark) * 1.04;
    const x = coords[i].x;
    if (prevMark && x - prevMark.x < (prevMark.w + w) / 2 + 6) {
      ctx.warnings.push(`line ${p.line} <ib-point>: mark "${p.mark}" may overlap the previous mark; shorten or move it`);
    }
    prevMark = { x, w };
    markSvgs.push(
      `<g class="ib-pt"${focusAttr(p.attrs.focus)}>
        <line x1="${x.toFixed(1)}" y1="18" x2="${x.toFixed(1)}" y2="${baseY}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" />
        <text x="${x.toFixed(1)}" y="12" text-anchor="${anchorFor(x, w, svgW)}" font-size="10.5" font-weight="700" fill="${color}">${escHtml(p.mark)}</text>
      </g>`
    );
  }

  const unit = attrs.unit || "";
  const pointSvgs = pts
    .map((p, i) => {
      const { x, y } = coords[i];
      const toned = p.tone !== "neutral";
      const stroke = toned ? TONE_EDGE[p.tone] : "var(--chart-1)";
      const showValue = labelAll || Boolean(p.mark) || i === n - 1 || i === peakIdx;
      const vText = fmtNum(p.num);
      const valueSvg = showValue
        ? `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="${anchorFor(x, approxLabelWidth(vText), svgW)}" font-size="11" font-weight="600" font-family="var(--font-mono, monospace)" fill="var(--foreground)" stroke="var(--card)" stroke-width="3" paint-order="stroke">${vText}</text>`
        : "";
      const tip = `${p.label}: ${vText}${unit ? ` ${unit}` : ""}${p.mark ? ` (${p.mark})` : ""}`;
      return `<g class="ib-pt"${focusAttr(p.attrs.focus)}>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="${toned ? stroke : "var(--card)"}" stroke="${stroke}" stroke-width="1.8"><title>${escHtml(tip)}</title></circle>
        ${valueSvg}
      </g>`;
    })
    .join("\n");

  const label = `${attrs.title || "Trend"}: ${attrs.caption || ""}`;
  return `<div class="ib-card">
    <div class="ib-head">
      <div class="ib-title">${escHtml(attrs.title || "")}</div>
      <div class="ib-head-meta">${attrs.note ? `<span class="ib-note">${escHtml(attrs.note)}</span>` : ""}${unit ? `<span class="ib-unit">${escHtml(unit)}</span>` : ""}</div>
    </div>
    <div class="ib-chart-wrap">
      <svg class="ib-chart-svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escHtml(label)}">
        ${grid.join("\n")}
        ${xLabels}
        ${markSvgs.join("\n")}
        <path d="${areaPath}" fill="var(--chart-1)" fill-opacity="0.13" stroke="none" />
        <path d="${linePath}" fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${pointSvgs}
      </svg>
    </div>
    <div class="ib-caption">${escHtml(attrs.caption || "")}</div>
  </div>`;
}

function renderLanes(attrs, body, offset, src, ctx) {
  const lanes = parseChildTags(body, "ib-lane", offset, src);
  if (!lanes.length) {
    ctx.errors.push(`line ${lineAt(src, offset)} <ib-lanes>: must contain at least one <ib-lane>`);
    return "";
  }
  ctx.stats.figures += 1;
  const cols = Math.min(3, Math.max(1, lanes.length));
  const laneHtml = lanes
    .map((lane) => {
      const tone = validateTone(lane.attrs.tone, lane.line, "ib-lane", ctx);
      const headCls = tone !== "neutral" ? ` ib-tone-${escHtml(tone)}` : "";
      const steps = parseChildTags(lane.inner, "ib-step", lane.innerOffset, src);
      if (!steps.length) {
        ctx.errors.push(`line ${lane.line} <ib-lane name="${lane.attrs.name || ""}">: must contain at least one <ib-step>`);
      }
      const stepsHtml = steps
        .map((st, idx) => {
          let kind = st.attrs.kind;
          if (kind === undefined) {
            kind = "action";
          } else if (!VALID_KINDS.has(kind)) {
            ctx.errors.push(`line ${st.line} <ib-step>: unknown kind="${kind}" (expected action, gate, break)`);
            kind = "action";
          }
          const kindLabel = kind === "gate" ? "GATE" : kind === "break" ? "BREAK" : "STEP";
          const arrow = idx < steps.length - 1 ? `<div class="ib-step-arrow">↓</div>` : "";
          return `<div class="ib-step"${focusAttr(st.attrs.focus)}>
            <div class="ib-step-top">
              <span class="ib-step-title">${escHtml(unescBasic(st.inner))}</span>
              <span class="ib-kind ib-kind-${kind}">${kindLabel}</span>
            </div>
            ${st.attrs.note ? `<div class="ib-step-note">${escHtml(st.attrs.note)}</div>` : ""}
          </div>${arrow}`;
        })
        .join("\n");
      return `<div class="ib-lane">
        <div class="ib-lane-head${headCls}"><span>${escHtml(lane.attrs.name || "")}</span><span>${steps.length} steps</span></div>
        ${stepsHtml}
      </div>`;
    })
    .join("\n");

  const cap = attrs.caption ? `<div class="ib-caption">${escHtml(attrs.caption)}</div>` : "";
  return `<div class="ib-card">
    <div class="ib-head">
      <div class="ib-title">${escHtml(attrs.title || "")}</div>
      ${attrs.note ? `<div class="ib-note">${escHtml(attrs.note)}</div>` : ""}
    </div>
    <div class="ib-lanes" style="--ib-lane-cols:${cols}">${laneHtml}</div>
    ${cap}
  </div>`;
}

function renderStepper(attrs, body, offset, src, ctx) {
  const stages = parseChildTags(body, "ib-stage", offset, src);
  if (!stages.length) {
    ctx.errors.push(`line ${lineAt(src, offset)} <ib-stepper>: must contain at least one <ib-stage>`);
    return "";
  }
  for (const st of stages) {
    const keys = parseFocusKeys(st.attrs.focus);
    if (keys.length) {
      ctx.stageFocusChecks.push({ line: st.line, keys });
    }
  }
  ctx.stats.interactive += 1;
  const dots = stages
    .map((_, i) => `<button type="button" class="ib-dot${i === 0 ? " is-active" : ""}" aria-label="Step ${i + 1}">${i + 1}</button>`)
    .join("");
  const dataEls = stages
    .map(
      (st) =>
        `<div class="ib-stage-data" hidden data-title="${escHtml(st.attrs.title || "")}" data-stage-focus="${escHtml(st.attrs.focus || "")}">${st.inner}</div>`
    )
    .join("\n");

  return `<div class="ib-card ib-stepper">
    <div class="ib-stepper-bar">
      <div>
        <div class="ib-title">${escHtml(attrs.title || "Interactive Walkthrough")}</div>
        ${attrs.note ? `<div class="ib-note">${escHtml(attrs.note)}</div>` : ""}
      </div>
      <div class="ib-stepper-btns">
        <button type="button" class="ib-btn" data-act="prev">←</button>
        <div class="ib-dots">${dots}</div>
        <button type="button" class="ib-btn" data-act="next">→</button>
        <button type="button" class="ib-btn" data-act="play" aria-pressed="false">▶ Play</button>
        <button type="button" class="ib-btn" data-act="reset">All</button>
      </div>
    </div>
    <div class="ib-stage-box">
      <div class="ib-stage-title"></div>
      <div class="ib-stage-body"></div>
    </div>
    ${dataEls}
  </div>`;
}

function renderDetails(attrs, body) {
  return `<details class="ib-fold">
    <summary>${escHtml(attrs.summary || "Reference")}</summary>
    <div class="ib-fold-body">${body}</div>
  </details>`;
}

function stripCssComments(css) {
  let out = "";
  let inStr = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inStr) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[++i];
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        out += maskKeepNewlines(css.slice(i));
        break;
      }
      out += maskKeepNewlines(css.slice(i, end + 2));
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function maskCssStringsAndUrls(val) {
  let out = "";
  let inStr = null;
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    if (inStr) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === "\\" && i + 1 < val.length) {
        const next = val[++i];
        out += next === "\n" ? "\n" : " ";
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += " ";
      continue;
    }
    if (
      (ch === "u" || ch === "U") &&
      /^url\s*\(/i.test(val.slice(i)) &&
      (i === 0 || !/[\w-]/.test(val[i - 1]))
    ) {
      let j = val.indexOf("(", i) + 1;
      let depth = 1;
      let str = null;
      while (j < val.length && depth > 0) {
        const c = val[j];
        if (str) {
          if (c === "\\" && j + 1 < val.length) j++;
          else if (c === str) str = null;
        } else if (c === '"' || c === "'") {
          str = c;
        } else if (c === "(") {
          depth++;
        } else if (c === ")") {
          depth--;
        }
        j++;
      }
      out += maskKeepNewlines(val.slice(i, j));
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function walkCssRules(css, onRule) {
  const clean = stripCssComments(css);
  const stack = [];
  let headerStart = 0;
  let inStr = null;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) {
      if (ch === "\\" && i + 1 < clean.length) i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === ";" && stack.length === 0) {
      headerStart = i + 1;
    } else if (ch === "{") {
      if (stack.length > 0) stack[stack.length - 1].hasNested = true;
      stack.push({
        header: clean.slice(headerStart, i),
        openIdx: i,
        hasNested: false,
      });
      headerStart = i + 1;
    } else if (ch === "}") {
      const frame = stack.pop();
      if (frame && !frame.hasNested) {
        onRule({
          selector: frame.header.trim(),
          body: clean.slice(frame.openIdx + 1, i),
          bodyOffset: frame.openIdx + 1,
        });
      }
      headerStart = i + 1;
    }
  }
}

function splitCssDeclarations(text, baseOffset) {
  const decls = [];
  let start = 0;
  let depth = 0;
  let inStr = null;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : ";";
    if (i < text.length) {
      if (inStr) {
        if (ch === "\\" && i + 1 < text.length) i++;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")" && depth > 0) {
        depth--;
        continue;
      }
    }
    if (ch === ";" && depth === 0) {
      const seg = text.slice(start, i);
      const colonIdx = findColonOutside(seg);
      if (colonIdx !== -1) {
        const prop = seg.slice(0, colonIdx).trim().toLowerCase();
        const val = seg.slice(colonIdx + 1);
        decls.push({ prop, val, valOffset: baseOffset + start + colonIdx + 1 });
      }
      start = i + 1;
    }
  }
  return decls;
}

function findColonOutside(seg) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (inStr) {
      if (ch === "\\" && i + 1 < seg.length) i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

function selectorTargetsRoot(selector) {
  if (!selector || selector.startsWith("@")) return false;
  for (const part of selector.split(",")) {
    const subject = part.trim().split(/[\s>+~]+/).pop() || "";
    if (/^(?:(?:html|body)(?![-\w])|:root(?![-\w]))/i.test(subject)) {
      return true;
    }
  }
  return false;
}

function isFullPercentValue(val) {
  const clean = val.replace(/!\s*important\b/gi, "").trim();
  return /^(?:100(?:\.0+)?%|calc\(\s*100(?:\.0+)?%\s*\))$/i.test(clean);
}

function checkHardcodedColors(rawVal, valOffset, locationLabel, src, ctx) {
  const masked = maskCssStringsAndUrls(rawVal);
  const fnOrHexRe = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\s*\(/gi;
  let m;
  while ((m = fnOrHexRe.exec(masked)) !== null) {
    ctx.errors.push(
      `line ${lineAt(src, valOffset + m.index)}: hardcoded color "${m[0]}" in ${locationLabel}; use T3 CSS variables var(--*)`
    );
  }
  const wordRe = /(?:^|[^-\w])([a-zA-Z]+)(?![-\w])/g;
  while ((m = wordRe.exec(masked)) !== null) {
    const word = m[1].toLowerCase();
    if (NAMED_COLORS.has(word)) {
      const wordIdx = m.index + (m[0].length - m[1].length);
      ctx.errors.push(
        `line ${lineAt(src, valOffset + wordIdx)}: hardcoded color "${m[1]}" in ${locationLabel}; use T3 CSS variables var(--*)`
      );
    }
  }
}

function lintCssDeclarations(decls, locationLabel, selector, tagName, src, ctx) {
  const isRootTarget = selector !== null ? selectorTargetsRoot(selector) : tagName === "html" || tagName === "body";
  for (const d of decls) {
    const vhRe = /(?:^|[^\w-])((?:\d+(?:\.\d+)?|\.\d+)(?:d|s|l)?vh)\b/gi;
    let vm;
    while ((vm = vhRe.exec(d.val)) !== null) {
      const unitIdx = vm.index + (vm[0].length - vm[1].length);
      ctx.errors.push(
        `line ${lineAt(src, d.valOffset + unitIdx)}: viewport height unit "${vm[1]}" forbidden in T3 html_render (causes iframe resize loops)`
      );
    }
    if (isRootTarget && d.prop === "height" && isFullPercentValue(d.val)) {
      ctx.errors.push(`line ${lineAt(src, d.valOffset)}: height: 100% on html/body forbidden in T3 html_render`);
    }
    checkHardcodedColors(d.val, d.valOffset, locationLabel, src, ctx);
  }
}

const URL_ATTRS = new Set(["src", "href", "srcset", "poster", "data", "action", "formaction", "xlink:href"]);
const FORBIDDEN_EMBED_TAGS = new Set(["iframe", "object", "embed"]);

function isExternalUrl(raw) {
  const val = String(raw || "").trim();
  if (!val || val.startsWith("#") || /^data:/i.test(val)) return false;
  return /^(?:https?:)?\/\//i.test(val);
}

function checkTagAttrsForExternalUrls(tagName, rawAttrs, attrsOffset, src, ctx) {
  if (FORBIDDEN_EMBED_TAGS.has(tagName)) {
    ctx.errors.push(`line ${lineAt(src, attrsOffset)}: embedded <${tagName}> forbidden (must be self-contained)`);
  }
  const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let am;
  while ((am = attrRe.exec(rawAttrs)) !== null) {
    const attrName = am[1].toLowerCase();
    if (!URL_ATTRS.has(attrName)) continue;
    const rawVal = am[2] ?? am[3] ?? am[4] ?? "";
    const candidates =
      attrName === "srcset"
        ? rawVal.split(",").map((part) => part.trim().split(/\s+/)[0] || "")
        : [rawVal];
    for (const urlCandidate of candidates) {
      if (!isExternalUrl(urlCandidate)) continue;
      const errOffset = attrsOffset + am.index;
      if (tagName === "link" && attrName === "href") {
        ctx.errors.push(`line ${lineAt(src, errOffset)}: external <link> URL forbidden (T3 offline/fake-IP safety)`);
      } else if (tagName === "script" && attrName === "src") {
        ctx.errors.push(`line ${lineAt(src, errOffset)}: external <script src> URL forbidden (must be self-contained)`);
      } else {
        ctx.errors.push(`line ${lineAt(src, errOffset)}: external <${tagName} ${attrName}> URL forbidden (must be self-contained)`);
      }
      break;
    }
  }
}

function checkCssExternalUrls(cssText, cssOffset, src, ctx) {
  const clean = stripCssComments(cssText);
  const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;
  let m;
  while ((m = importRe.exec(clean)) !== null) {
    const target = m[1] ?? m[2] ?? m[3] ?? "";
    if (isExternalUrl(target)) {
      ctx.errors.push(`line ${lineAt(src, cssOffset + m.index)}: external CSS @import URL forbidden`);
    }
  }
  const urlRe = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
  while ((m = urlRe.exec(clean)) !== null) {
    const target = m[1] ?? m[2] ?? m[3] ?? "";
    if (isExternalUrl(target)) {
      ctx.errors.push(`line ${lineAt(src, cssOffset + m.index)}: external CSS url() forbidden`);
    }
  }
}

function lintScriptBody(js, jsOffset, src, ctx) {
  // Separate code from string/template literals while skipping JS comments
  let codeOnly = "";
  const strings = [];
  for (let i = 0; i < js.length; i++) {
    const ch = js[i];
    if (ch === "/" && js[i + 1] === "/") {
      const nl = js.indexOf("\n", i + 2);
      const end = nl === -1 ? js.length : nl;
      codeOnly += maskKeepNewlines(js.slice(i, end));
      i = end - 1;
      continue;
    }
    if (ch === "/" && js[i + 1] === "*") {
      const close = js.indexOf("*/", i + 2);
      const end = close === -1 ? js.length : close + 2;
      codeOnly += maskKeepNewlines(js.slice(i, end));
      i = end - 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i + 1;
      let j = start;
      while (j < js.length) {
        if (js[j] === "\\" && j + 1 < js.length) {
          j += 2;
          continue;
        }
        if (js[j] === quote) break;
        j++;
      }
      strings.push({ text: js.slice(start, j), offset: jsOffset + start });
      codeOnly += maskKeepNewlines(js.slice(i, Math.min(js.length, j + 1)));
      i = j;
      continue;
    }
    codeOnly += ch;
  }

  const netPatterns = [
    { re: /\bfetch\s*\(/g, msg: 'external network call "fetch(" forbidden in <script> (must be self-contained)' },
    { re: /\bXMLHttpRequest\b/g, msg: 'external network API "XMLHttpRequest" forbidden in <script> (must be self-contained)' },
    { re: /\bimport\s*\(/g, msg: 'dynamic "import(" forbidden in <script> (must be self-contained)' },
  ];
  for (const p of netPatterns) {
    let m;
    while ((m = p.re.exec(codeOnly)) !== null) {
      ctx.errors.push(`line ${lineAt(src, jsOffset + m.index)}: ${p.msg}`);
    }
  }

  const strUrlRe = /(?:https?:\/\/|(?:^|[^:\w/])\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  for (const s of strings) {
    let m;
    while ((m = strUrlRe.exec(s.text)) !== null) {
      ctx.errors.push(`line ${lineAt(src, s.offset + m.index)}: external URL in <script> string forbidden (must be self-contained)`);
    }
  }
}

function lintSource(src, ctx) {
  // Extract CSS/script blocks outside HTML comments
  const noComments = stripHtmlComments(src);
  const blockRe = new RegExp(`<(style|script)\\b${ATTR_SRC}>([\\s\\S]*?)<\\/\\1>`, "gi");
  let htmlOnly = "";
  let last = 0;
  let bm;
  while ((bm = blockRe.exec(noComments)) !== null) {
    htmlOnly += noComments.slice(last, bm.index);
    htmlOnly += maskKeepNewlines(bm[0]);
    last = bm.index + bm[0].length;
    const blockTag = bm[1].toLowerCase();
    const rawBlockAttrs = bm[2] || "";
    const blockAttrsOffset = bm.index + 1 + bm[1].length;
    const bodyOffset = blockAttrsOffset + rawBlockAttrs.length + 1;
    if (blockTag === "style") {
      checkCssExternalUrls(bm[3], bodyOffset, src, ctx);
      walkCssRules(bm[3], (rule) => {
        const decls = splitCssDeclarations(rule.body, bodyOffset + rule.bodyOffset);
        lintCssDeclarations(decls, "<style>", rule.selector, null, src, ctx);
      });
    } else if (blockTag === "script") {
      checkTagAttrsForExternalUrls("script", rawBlockAttrs, blockAttrsOffset, src, ctx);
      lintScriptBody(bm[3], bodyOffset, src, ctx);
    }
  }
  htmlOnly += noComments.slice(last);

  // HTML/SVG tags: Gate 3 URL attributes/embeds + inline style= attributes (Gates 1, 2, 3, 4)
  const tagRe = new RegExp(`<([a-zA-Z][\\w:-]*)\\b(${ATTR_SRC})\\/?>`, "g");
  let tm;
  while ((tm = tagRe.exec(htmlOnly)) !== null) {
    const tagName = tm[1].toLowerCase();
    const rawAttrs = tm[2] || "";
    const attrsOffset = tm.index + 1 + tm[1].length;
    checkTagAttrsForExternalUrls(tagName, rawAttrs, attrsOffset, src, ctx);
    const styleAttrRe = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let sm;
    while ((sm = styleAttrRe.exec(rawAttrs)) !== null) {
      const val = sm[1] ?? sm[2] ?? sm[3] ?? "";
      const quoteAdjust = sm[1] !== undefined || sm[2] !== undefined ? 1 : 0;
      const valOffset = attrsOffset + sm.index + sm[0].indexOf("=") + 1;
      const eqTail = sm[0].slice(sm[0].indexOf("=") + 1);
      const leadSpace = eqTail.length - eqTail.trimStart().length;
      const exactOffset = valOffset + leadSpace + quoteAdjust;
      checkCssExternalUrls(val, exactOffset, src, ctx);
      const decls = splitCssDeclarations(val, exactOffset);
      lintCssDeclarations(decls, "style attribute", null, tagName, src, ctx);
    }
  }

  // Raw <svg> viewBox (Gate 5) + SVG fill/stroke/stop-color hardcoded colors (Gate 4)
  const rawSvgRe = new RegExp(`<svg\\b${ATTR_SRC}\\/?>`, "gi");
  let m;
  while ((m = rawSvgRe.exec(htmlOnly)) !== null) {
    if (!/\bviewBox\s*=/i.test(m[1])) {
      ctx.errors.push(`line ${lineAt(src, m.index)}: raw <svg> missing viewBox attribute`);
    }
  }

  const svgBlockRe = new RegExp(`<svg\\b${ATTR_SRC}>([\\s\\S]*?)<\\/svg>`, "gi");
  let svgMatch;
  while ((svgMatch = svgBlockRe.exec(htmlOnly)) !== null) {
    const svgSlice = svgMatch[0];
    const svgBase = svgMatch.index;
    const innerTagRe = new RegExp(`<([a-zA-Z][\\w:-]*)\\b(${ATTR_SRC})\\/?>`, "g");
    let itm;
    while ((itm = innerTagRe.exec(svgSlice)) !== null) {
      const rawAttrs = itm[2] || "";
      const attrsOffset = svgBase + itm.index + 1 + itm[1].length;
      const paintRe = /\b(fill|stroke|stop-color)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
      let pm;
      while ((pm = paintRe.exec(rawAttrs)) !== null) {
        const attrName = pm[1].toLowerCase();
        const val = pm[2] ?? pm[3] ?? pm[4] ?? "";
        const quoteAdjust = pm[2] !== undefined || pm[3] !== undefined ? 1 : 0;
        const eqTail = pm[0].slice(pm[0].indexOf("=") + 1);
        const leadSpace = eqTail.length - eqTail.trimStart().length;
        const valOffset = attrsOffset + pm.index + pm[0].indexOf("=") + 1 + leadSpace + quoteAdjust;
        checkHardcodedColors(val, valOffset, `SVG ${attrName} attribute`, src, ctx);
      }
    }
  }
}

function validateStrictContainers(inner, innerOffset, src, ctx) {
  const containerRules = [
    ["ib-kpis", ["ib-kpi"]],
    ["ib-bars", ["ib-bar"]],
    ["ib-trend", ["ib-point"]],
    ["ib-flow", ["ib-node", "ib-edge"]],
    ["ib-lanes", ["ib-lane"]],
    ["ib-stepper", ["ib-stage"]],
  ];
  for (const [container, allowed] of containerRules) {
    const containerRe = new RegExp(`<${container}\\b${ATTR_SRC}>([\\s\\S]*?)<\\/${container}>`, "g");
    let cm;
    while ((cm = containerRe.exec(inner)) !== null) {
      const prefixLen = 1 + container.length + (cm[1] || "").length + 1;
      const bodyOffset = innerOffset + cm.index + prefixLen;
      let rest = cm[2];
      for (const child of allowed) {
        const childRe = new RegExp(`<${child}\\b${ATTR_SRC}(?:\\/>|>([\\s\\S]*?)<\\/${child}>)`, "g");
        rest = rest.replace(childRe, (full, attrsRaw, childBody, matchIdx) => {
          if (child === "ib-lane" && childBody !== undefined) {
            const laneOffset = bodyOffset + matchIdx + 1 + child.length + (attrsRaw || "").length + 1;
            const stepRe = new RegExp(`<ib-step\\b${ATTR_SRC}(?:\\/>|>([\\s\\S]*?)<\\/ib-step>)`, "g");
            const laneRest = childBody.replace(stepRe, maskKeepNewlines);
            for (const stray of laneRest.matchAll(/<\/?ib-[a-z0-9-]+/gi)) {
              ctx.errors.push(`line ${lineAt(src, laneOffset + stray.index)} <ib-lane>: unknown or misplaced ${stray[0]}> tag`);
            }
          } else if (child !== "ib-stage" && childBody !== undefined) {
            const childOffset = bodyOffset + matchIdx + 1 + child.length + (attrsRaw || "").length + 1;
            for (const stray of childBody.matchAll(/<\/?ib-[a-z0-9-]+/gi)) {
              ctx.errors.push(`line ${lineAt(src, childOffset + stray.index)} <${child}>: unknown or misplaced ${stray[0]}> tag`);
            }
          }
          return maskKeepNewlines(full);
        });
      }
      for (const stray of rest.matchAll(/<\/?ib-[a-z0-9-]+/gi)) {
        ctx.errors.push(`line ${lineAt(src, bodyOffset + stray.index)} <${container}>: unknown or misplaced ${stray[0]}> tag`);
      }
    }
  }
}

export function compileSource(src) {
  const ctx = {
    errors: [],
    warnings: [],
    stageFocusChecks: [],
    stats: {
      srcLines: src.split("\n").length,
      figures: 0,
      interactive: 0,
    },
  };

  let title = "Inline Brief";
  let lang = "en";
  let inner = src;
  let innerOffset = 0;

  const pageRe = new RegExp(`<ib-page\\b${ATTR_SRC}>([\\s\\S]*?)<\\/ib-page>`, "i");
  const pageMatch = pageRe.exec(src);
  if (pageMatch) {
    const before = stripHtmlComments(src.slice(0, pageMatch.index));
    const after = stripHtmlComments(src.slice(pageMatch.index + pageMatch[0].length));
    if (before.trim()) {
      const idx = before.search(/\S/);
      ctx.errors.push(`line ${lineAt(src, idx)}: unexpected content outside <ib-page>`);
    }
    if (after.trim()) {
      const idx = pageMatch.index + pageMatch[0].length + after.search(/\S/);
      ctx.errors.push(`line ${lineAt(src, idx)}: unexpected content outside <ib-page>`);
    }
    const attrs = parseAttrs(pageMatch[1]);
    title = attrs.title || title;
    lang = attrs.lang || lang;
    inner = pageMatch[2];
    innerOffset = pageMatch.index + 1 + "ib-page".length + (pageMatch[1] || "").length + 1;
  } else {
    const nonComment = stripHtmlComments(src);
    if (nonComment.trim()) {
      const idx = nonComment.search(/\S/);
      ctx.errors.push(`line ${lineAt(src, idx)}: content outside <ib-page> is forbidden (wrap the brief in <ib-page>...</ib-page>)`);
    }
  }

  // Extract optional custom <style> inside source so we can append it cleanly
  const customStyles = [];
  inner = inner.replace(new RegExp(`<style\\b${ATTR_SRC}>([\\s\\S]*?)<\\/style>`, "gi"), (full, rawAttrs, css) => {
    customStyles.push({ text: css });
    return maskKeepNewlines(full);
  });

  lintSource(src, ctx);
  validateStrictContainers(inner, innerOffset, src, ctx);

  // Expand top-level <ib-*> blocks
  const blockHandlers = {
    "ib-kpis": renderKpis,
    "ib-bars": renderBars,
    "ib-flow": renderFlow,
    "ib-lanes": renderLanes,
    "ib-stepper": renderStepper,
    "ib-trend": renderTrend,
    "ib-details": renderDetails,
  };

  for (const [tag, fn] of Object.entries(blockHandlers)) {
    const re = new RegExp(`<${tag}\\b${ATTR_SRC}>([\\s\\S]*?)<\\/${tag}>`, "g");
    const positions = Array.from(inner.matchAll(re), (m) => innerOffset + m.index);
    let seen = 0;
    inner = inner.replace(re, (full, rawAttrs, body) =>
      fn(parseAttrs(rawAttrs || ""), body, positions[seen++] ?? innerOffset, src, ctx)
    );
  }

  // Expand <ib-grid cols="2"> wrapper
  inner = inner.replace(new RegExp(`<ib-grid\\b${ATTR_SRC}>([\\s\\S]*?)<\\/ib-grid>`, "g"), (_, rawAttrs, body) => {
    const attrs = parseAttrs(rawAttrs || "");
    const cls = attrs.cols === "2" || !attrs.cols ? "ib-grid-2" : "ib-stack";
    return `<div class="${cls}">${body}</div>`;
  });

  for (const stray of inner.matchAll(/<\/?ib-[a-z0-9-]+/gi)) {
    ctx.errors.push(`line ${lineAt(src, innerOffset + stray.index)}: unknown or misplaced ${stray[0]}> tag`);
  }

  // Warn on dangling focus keys in <ib-stage> and .ib-ref
  const allFocusKeys = new Set();
  const nonRefFocusKeys = new Set();
  const focusElRe = new RegExp(`<([a-zA-Z][\\w:-]*)\\b(${ATTR_SRC})>`, "g");
  let fm;
  while ((fm = focusElRe.exec(inner)) !== null) {
    const attrs = parseAttrs(fm[2] || "");
    if (!attrs["data-focus"]) continue;
    const keys = parseFocusKeys(attrs["data-focus"]);
    const isRef = /\bib-ref\b/.test(attrs.class || "");
    for (const k of keys) {
      allFocusKeys.add(k);
      if (!isRef) nonRefFocusKeys.add(k);
    }
  }
  for (const check of ctx.stageFocusChecks) {
    for (const k of check.keys) {
      if (!allFocusKeys.has(k)) {
        ctx.warnings.push(`line ${check.line} <ib-stage>: dangling focus key "${k}" matches no element`);
      }
    }
  }
  const refRe = new RegExp(`<([a-zA-Z][\\w:-]*)\\b(${ATTR_SRC})>`, "g");
  let rm;
  while ((rm = refRe.exec(src)) !== null) {
    const attrs = parseAttrs(rm[2] || "");
    if (!attrs["data-focus"] || !/\bib-ref\b/.test(attrs.class || "")) continue;
    for (const k of parseFocusKeys(attrs["data-focus"])) {
      if (!nonRefFocusKeys.has(k)) {
        ctx.warnings.push(`line ${lineAt(src, rm.index)} .ib-ref: dangling focus key "${k}" matches no target element`);
      }
    }
  }
  delete ctx.stageFocusChecks;

  const baseCss = readFileSync(resolve(KIT_DIR, "base.css"), "utf8");
  const runtimeJs = readFileSync(resolve(KIT_DIR, "runtime.js"), "utf8");

  const html = `<!DOCTYPE html>
<html lang="${escHtml(lang)}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="generator" content="inline-brief ${escHtml(VERSION)}" />
<title>${escHtml(title)}</title>
<style>
${baseCss.trim()}
${customStyles.map((c) => `\n/* Page-specific styles */\n${c.text.trim()}`).join("\n")}
</style>
</head>
<body>
<div class="ib-stack">
${inner.trim()}
</div>
<script>
${runtimeJs.trim()}
</script>
</body>
</html>
`;

  ctx.stats.outBytes = Buffer.byteLength(html, "utf8");
  return { html, ...ctx };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
  }
  const checkOnly = args.includes("--check");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--help") || !positional.length) {
    const usage = "Usage: inline-brief <input.src.html> [output.html] [--check]";
    if (args.includes("--help")) {
      console.log(usage);
      process.exit(0);
    }
    console.error(usage);
    process.exit(2);
  }
  const inputPath = resolve(positional[0]);
  const outputPath = positional[1]
    ? resolve(positional[1])
    : inputPath.replace(/\.src\.html$/i, ".html");

  let src;
  try {
    src = readFileSync(inputPath, "utf8");
  } catch (err) {
    console.error(`ERROR cannot read ${inputPath}: ${err.code ?? err.message}`);
    process.exit(2);
  }
  const res = compileSource(src);

  for (const w of res.warnings) console.warn(`WARN  ${w}`);
  for (const e of res.errors) console.error(`ERROR ${e}`);

  if (res.errors.length > 0) {
    console.error(`FAIL  ${res.errors.length} error(s), ${res.warnings.length} warning(s) — output not written.`);
    process.exit(1);
  }

  if (!checkOnly) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, res.html, "utf8");
  }

  console.log(
    `OK    ${res.stats.figures} figure(s) · ${res.stats.interactive} interactive · ${res.stats.srcLines} src lines → ${(res.stats.outBytes / 1024).toFixed(1)} KiB${checkOnly ? " (check only)" : ` → ${outputPath}`}`
  );
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
