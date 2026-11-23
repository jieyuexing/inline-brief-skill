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

function lineAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
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
    results.push({
      attrs: parseAttrs(m[1] || ""),
      inner: (m[2] ?? "").trim(),
      line: lineAt(fullSource, sourceOffset + m.index),
    });
  }
  return results;
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
      const tone = it.attrs.tone || "neutral";
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
  const items = parseChildTags(body, "ib-bar", offset, src);
  if (!items.length) {
    ctx.errors.push(`line ${lineAt(src, offset)} <ib-bars>: must contain at least one <ib-bar>`);
    return "";
  }
  const unit = attrs.unit || "";
  const parsed = items.map((it) => {
    const num = Number(it.attrs.value);
    if (!Number.isFinite(num) || num < 0) {
      ctx.errors.push(`line ${it.line} <ib-bar>: value="${it.attrs.value ?? ""}" must be a non-negative number`);
    }
    return { ...it, num: Number.isFinite(num) && num >= 0 ? num : 0 };
  });
  const maxVal = attrs.max !== undefined && attrs.max !== "" ? Number(attrs.max) : Math.max(...parsed.map((p) => p.num), 1);
  if (!Number.isFinite(maxVal) || maxVal <= 0) {
    ctx.errors.push(`line ${lineAt(src, offset)} <ib-bars>: max="${attrs.max}" must be > 0`);
  }
  const denom = Number.isFinite(maxVal) && maxVal > 0 ? maxVal : 1;
  ctx.stats.figures += 1;

  const rows = parsed
    .map((p) => {
      const pct = Math.min(100, Math.max(0, (p.num / denom) * 100));
      const tone = p.attrs.tone || "neutral";
      const valText = unit ? `${p.num} ${unit}` : String(p.num);
      return `<div class="ib-bar-row"${focusAttr(p.attrs.focus)}>
        <div class="ib-bar-lbl" title="${escHtml(p.attrs.label || "")}">${escHtml(p.attrs.label || "")}</div>
        <div class="ib-bar-track"><div class="ib-bar-fill ib-fill-${escHtml(tone)}" style="width:${pct.toFixed(1)}%"></div></div>
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
  let maxCol = 1;
  let maxRow = 1;
  for (const n of nodes) {
    const id = n.attrs.id;
    const col = Number(n.attrs.col || 1);
    const row = Number(n.attrs.row || 1);
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
    const label = unescBasic(n.inner);
    if (approxLabelWidth(label) > 138) {
      ctx.warnings.push(`line ${n.line} <ib-node id="${id}">: label "${label}" may crowd on 728px; consider shortening`);
    }
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    nodeMap.set(id, { ...n, id, col, row, label });
  }

  for (const e of edges) {
    if (!nodeMap.has(e.attrs.from)) {
      ctx.errors.push(`line ${e.line} <ib-edge>: unknown from="${e.attrs.from ?? ""}"`);
    }
    if (!nodeMap.has(e.attrs.to)) {
      ctx.errors.push(`line ${e.line} <ib-edge>: unknown to="${e.attrs.to ?? ""}"`);
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
  const nodeW = Math.floor((svgW - padX * 2 - gapX * (maxCol - 1)) / maxCol);
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
      const tone = TONE_STROKE[n.attrs.tone] ? n.attrs.tone : "neutral";
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
    const num = Number(it.attrs.value);
    const valid = it.attrs.value !== undefined && it.attrs.value !== "" && Number.isFinite(num) && num >= 0;
    if (!valid) {
      ctx.errors.push(`line ${it.line} <ib-point>: value="${it.attrs.value ?? ""}" must be a non-negative number`);
    }
    if (!it.attrs.label) {
      ctx.errors.push(`line ${it.line} <ib-point>: missing label attribute`);
    }
    return { ...it, num: valid ? num : 0, label: it.attrs.label || "", mark: it.attrs.mark || "" };
  });

  const peak = Math.max(...pts.map((p) => p.num));
  let top;
  let step;
  if (attrs.max !== undefined && attrs.max !== "") {
    top = Number(attrs.max);
    if (!Number.isFinite(top) || top <= 0) {
      ctx.errors.push(`line ${line} <ib-trend>: max="${attrs.max}" must be > 0`);
      top = 4;
    } else if (top < peak) {
      ctx.errors.push(`line ${line} <ib-trend>: max="${attrs.max}" is below the largest value ${peak}`);
      top = peak;
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
    const color = TONE_EDGE[p.attrs.tone] && p.attrs.tone !== "neutral" ? TONE_EDGE[p.attrs.tone] : "var(--muted-foreground)";
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
      const toned = TONE_EDGE[p.attrs.tone] && p.attrs.tone !== "neutral";
      const stroke = toned ? TONE_EDGE[p.attrs.tone] : "var(--chart-1)";
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
      const tone = lane.attrs.tone || "neutral";
      const headCls = tone !== "neutral" ? ` ib-tone-${escHtml(tone)}` : "";
      const laneIdx = body.indexOf(lane.inner);
      const steps = parseChildTags(lane.inner, "ib-step", offset + Math.max(0, laneIdx), src);
      const stepsHtml = steps
        .map((st, idx) => {
          const kind = ["action", "gate", "break"].includes(st.attrs.kind) ? st.attrs.kind : "action";
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

function lintSource(src, customStyles, ctx) {
  // 1. Forbidden external resource links
  const extPatterns = [
    { re: /<link\b[^>]*\bhref\s*=\s*["']https?:\/\//gi, msg: "external <link> URL forbidden (T3 offline/fake-IP safety)" },
    { re: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi, msg: "external <script src> URL forbidden (must be self-contained)" },
    { re: /@import\s+(?:url\()?["']?https?:\/\//gi, msg: "external CSS @import URL forbidden" },
    { re: /url\(\s*["']?https?:\/\//gi, msg: "external CSS url() forbidden" },
  ];
  for (const p of extPatterns) {
    let m;
    while ((m = p.re.exec(src)) !== null) {
      ctx.errors.push(`line ${lineAt(src, m.index)}: ${p.msg}`);
    }
  }

  // 2. Forbidden vh/dvh/svh and height:100% on html/body
  const vhRe = /\b\d+(?:\.\d+)?(?:d|s|l)?vh\b/gi;
  let m;
  while ((m = vhRe.exec(src)) !== null) {
    ctx.errors.push(`line ${lineAt(src, m.index)}: viewport height unit "${m[0]}" forbidden in T3 html_render (causes iframe resize loops)`);
  }
  const h100Re = /(?:html|body)[^{]*\{[^}]*\bheight\s*:\s*100%/gi;
  while ((m = h100Re.exec(src)) !== null) {
    ctx.errors.push(`line ${lineAt(src, m.index)}: height: 100% on html/body forbidden in T3 html_render`);
  }

  // 3. Hardcoded colors in custom <style> blocks
  for (const style of customStyles) {
    const colorRe = /(?:#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/g;
    let cm;
    while ((cm = colorRe.exec(style.text)) !== null) {
      ctx.errors.push(
        `line ${lineAt(src, style.offset + cm.index)}: hardcoded color "${cm[0]}" in <style>; use T3 CSS variables var(--*)`
      );
    }
  }

  // 4. Raw <svg> without viewBox
  const rawSvgRe = /<svg\b([^>]*)>/gi;
  while ((m = rawSvgRe.exec(src)) !== null) {
    if (!/\bviewBox\s*=/i.test(m[1])) {
      ctx.errors.push(`line ${lineAt(src, m.index)}: raw <svg> missing viewBox attribute`);
    }
  }
}

export function compileSource(src) {
  const ctx = {
    errors: [],
    warnings: [],
    stats: {
      srcLines: src.split("\n").length,
      figures: 0,
      interactive: 0,
    },
  };

  let title = "Inline Brief";
  let lang = "en";
  let inner = src;

  const pageMatch = /<ib-page\b([^>]*)>([\s\S]*?)<\/ib-page>/i.exec(src);
  if (pageMatch) {
    const attrs = parseAttrs(pageMatch[1]);
    title = attrs.title || title;
    lang = attrs.lang || lang;
    inner = pageMatch[2];
  }

  // Extract optional custom <style> inside source so we can lint it separately
  const customStyles = [];
  inner = inner.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) => {
    customStyles.push({ text: css, offset: Math.max(0, src.indexOf(css)) });
    return "";
  });

  lintSource(src, customStyles, ctx);

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
    const positions = Array.from(src.matchAll(re), (m) => m.index);
    let seen = 0;
    inner = inner.replace(re, (full, rawAttrs, body) =>
      fn(parseAttrs(rawAttrs || ""), body, positions[seen++] ?? 0, src, ctx)
    );
  }

  // Expand <ib-grid cols="2"> wrapper
  inner = inner.replace(/<ib-grid\b([^>]*)>([\s\S]*?)<\/ib-grid>/g, (_, rawAttrs, body) => {
    const attrs = parseAttrs(rawAttrs || "");
    const cls = attrs.cols === "2" || !attrs.cols ? "ib-grid-2" : "ib-stack";
    return `<div class="${cls}">${body}</div>`;
  });

  const stray = /<\/?ib-[a-z]+/i.exec(inner);
  if (stray) {
    ctx.errors.push(`line ${lineAt(src, src.indexOf(stray[0]))}: unknown or misplaced ${stray[0]}> tag`);
  }

  const baseCss = readFileSync(resolve(KIT_DIR, "base.css"), "utf8");
  const runtimeJs = readFileSync(resolve(KIT_DIR, "runtime.js"), "utf8");

  const html = `<!DOCTYPE html>
<html lang="${escHtml(lang)}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
