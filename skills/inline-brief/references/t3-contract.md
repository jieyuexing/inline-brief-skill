# T3 Code `html_render` contract

This skill targets T3 Code's inline sandboxed iframe (`html_preview` + `html_render`). The compiler enforces the rules below statically; the 3-state preview checks what static analysis cannot.

> Unofficial community skill built for T3 Code's `html_render`. Not affiliated with or endorsed by T3 Tools Inc.

## Viewport and frame rules

- **Desktop thread width: `728px`.** Design for one or two columns; no wide 12-column dashboards or layouts that need `>= 1200px`.
- **Mobile thread width: ~`360-390px`.** Every multi-column grid and dual-lane diagram must stack below `560px`.
- **No outer shell.** Leave `html`, `body` and the outermost wrapper transparent: no background, no outer card border, no banner title, no horizontal page padding. T3 draws the frame on the thread surface with its own gutter.
- **Height follows content.** Never use `vh`, `dvh`, `svh`/`lvh` or `height: 100%` on `html` or `body`; they cause iframe resize loops or rejection. Give charts and SVGs a `viewBox` aspect ratio or an explicit pixel height.

## Theme tokens (mandatory)

Never hardcode hex, `rgb()` or `hsl()` colors in custom styles. Use T3's `:root` variables so the page follows Dark, Light and custom themes:

| Role | Token | Notes |
| --- | --- | --- |
| Surface card | `var(--card)` | `padding: 16px`, `border-radius: var(--radius)` |
| Secondary surface | `var(--secondary)` | insets, tracks, pills |
| Primary text | `var(--foreground)` | headings, values, node titles |
| Muted text | `var(--muted-foreground)` | captions, axis ticks, subtitles |
| Hairline border | `var(--border)` | dividers and card strokes |
| Semantic status | `var(--info)`, `var(--success)`, `var(--warning)`, `var(--destructive)` | reserve for meaning; keep ~90% of the surface neutral |
| Soft status surfaces | `var(--accent-surface)`, `var(--warning-surface)`, `var(--destructive-surface)` | tinted callouts and badges |
| Data series | `var(--chart-1)` .. `var(--chart-6)` | categorical series |
| Typography | `var(--font-sans)`, `var(--font-mono)` | local system stack only |

## Sandbox and offline guarantees

- **Zero external requests.** No web fonts, CDN scripts or remote images. T3 previews block hostnames that resolve to private or reserved addresses (including fake-IP DNS from proxies), so external assets fail silently or stall.
- **Read-only iframe.** Inline scripts run for local UI state (steppers, hover cross-highlight, collapsible details) but cannot call back into the agent or persist storage across reloads.

## Static gates enforced by `compile.mjs`

Each violation is an `ERROR` with a source line number and a non-zero exit code:

1. Viewport height units (`vh`, `dvh`, `svh`, `lvh`) anywhere in the source.
2. `height: 100%` on `html` or `body`.
3. External resources: `<link href="http...">`, `<script src="http...">`, `@import` or `url()` pointing at `http(s)://`.
4. Hardcoded colors (`#hex`, `rgb(`, `hsl(`) inside a custom `<style>` block.
5. A raw `<svg>` without `viewBox`.
6. Invalid figure data: negative or non-numeric values, dangling edges (`from`/`to` that match no node), duplicate node ids, a missing `caption` on `<ib-flow>` or `<ib-trend>`, fewer than 2 `<ib-point>`.

Warnings (exit code stays 0) flag labels likely to crowd on 728px, such as an edge label wider than the gap between adjacent nodes or two trend marks that would overlap.

## 3-state QA checklist

Before calling `html_render`, inspect `html_preview` output for:

1. `dark` at `728px`: contrast, crisp borders, balanced column heights, no orphan one-character wraps.
2. `light` at `728px`: readable muted text and SVG strokes, no washed-out badges.
3. `dark` at `390px`: no horizontal clipping, KPI strip collapses to 2 columns, swimlanes stack. SVG figures scale down with the card width, so keep node and tick labels short.
4. `consoleMessages` is `[]`.
