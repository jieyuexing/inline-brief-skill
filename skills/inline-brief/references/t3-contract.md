# T3 Code `html_render` contract

This skill targets T3 Code's inline sandboxed iframe (`html_preview` + `html_render`). Below, host rules are separated from stricter policies added by `inline-brief`; if a host detail ever diverges, the live `html_render` / `html_preview` tool description is authoritative.

> Unofficial community skill built for T3 Code's `html_render`. Not affiliated with or endorsed by T3 Tools Inc.

## T3 Code host facts

- **Desktop thread width: `728px`.** Design for one or two columns; no wide 12-column dashboards or layouts that need `>= 1200px`.
- **Mobile thread width: ~`360-390px`.** Every multi-column grid and dual-lane diagram must stack below `560px` (`<ib-flow>` keeps a `540px` minimum width and scrolls horizontally inside its card).
- **No outer shell.** Leave `html`, `body` and the outermost wrapper transparent: no background, no outer card border, no banner title, no horizontal page padding. T3 draws the frame on the thread surface and injects an overridable `8px` `html` gutter (`kit/base.css` sets `html, body { padding: 0 }` so component layouts align cleanly).
- **Height follows content.** Never use `vh`, `dvh`, `svh`/`lvh` in CSS (`<style>` or `style=`) or `height: 100%` on `html` or `body`; they cause iframe resize loops or rejection. `html_render` takes a `height` from `80` to `2000` CSS px (mobile scrolls beyond that height). Give charts and SVGs a `viewBox` aspect ratio or an explicit pixel height.
- **Remote URLs on the host.** T3 Code's `html_render` host allows remote URLs to load as-is, while `html_preview` blocks hostnames that resolve to private, reserved, or fake-IP addresses.
- **Read-only iframe.** Inline scripts run for local UI state (steppers, visual option pickers with clipboard summary copy, hover cross-highlight, collapsible details) but cannot call back into the agent or persist storage across reloads.

## Skill-enforced policy (`inline-brief`)

To keep every compiled brief strictly self-contained and reliable offline or behind proxies (where remote fonts, CDN scripts, or images stall on fake-IP DNS), `inline-brief` enforces a **zero external requests** policy beyond the host minimum:

- **Zero external URLs.** Forbids `http(s)://` and protocol-relative `//` in `src`, `href`, `srcset`, `poster`, `data`, `action`, `formaction`, `xlink:href` (quoted or unquoted), CSS `@import` and `url()` (`<style>` and inline `style=`), embedded `<iframe>`/`<object>`/`<embed>`, and `<script>` network calls (`fetch(`, `XMLHttpRequest`, `import(`, or external URL strings).
- **Allowed local URIs & compile-time image inlining.** `data:` URIs and page-local `#id` fragment anchors are allowed. `<ib-option src="assets/...">` also accepts relative raster image paths (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `<= 2 MiB`) strictly inside the `.src.html` directory (no `..`, no absolute paths, no symlink escapes), which `compile.mjs` inlines as `data:image/...;base64,...` into the output HTML.

## Theme tokens (mandatory)

Never hardcode hex, `rgb()`, `hsl()`, `oklch()` or named colors in styles or SVG paint attributes. Use T3's `:root` variables so the page follows Dark, Light and custom themes:

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

## Static gates enforced by `compile.mjs`

Each violation is an `ERROR` with a source line number and a non-zero exit code:

1. Viewport height units (`vh`, `dvh`, `svh`, `lvh`) in CSS contexts (`<style>` blocks and `style=` attributes).
2. `height: 100%` scoped to `html`, `body`, or `:root` selectors (or inline `style=` on `html`/`body`).
3. External URLs (`http(s)://` or `//`) in URL attributes (`src`, `href`, `srcset`, `poster`, `data`, `action`, `formaction`, `xlink:href`, quoted or unquoted), CSS `@import` / `url()` (`<style>` and `style=`), `<iframe>`/`<object>`/`<embed>`, and `<script>` (`fetch(`, `XMLHttpRequest`, `import(`, external URL strings). `data:` and `#id` are allowed.
4. Hardcoded colors (`#hex`, `rgb()`, `hsl()`, `oklch()` / `oklab()` / `lab()` / `lch()` / `hwb()` / `color()`, CSS named colors) in CSS declarations (`<style>` and `style=`) or SVG `fill`/`stroke`/`stop-color` attributes (`transparent`, `currentColor`, `inherit`, `none`, `var(--*)`, and `url(#...)` are allowed).
5. A raw `<svg>` without `viewBox`.
6. Invalid DSL structure or figure data: unknown or misplaced `<ib-*>` tags, content outside `<ib-page>`, empty/non-numeric values, `max` below the largest value, unknown `tone`/`kind`/`curve`, flow cell collisions or column overflow, empty `<ib-lane>`, dangling edges, duplicate node ids, missing `caption` on `<ib-flow>` or `<ib-trend>`, fewer than 2 `<ib-point>`.

Warnings (exit code stays 0) flag labels likely to crowd on 728px (oversized edge labels, overlapping trend marks) and dangling `focus` keys on `<ib-stage>` or `.ib-ref`.

## 3-state QA checklist

Before calling `html_render`, inspect `html_preview` output for:

1. `dark` at `728px`: contrast, crisp borders, balanced column heights, no orphan one-character wraps.
2. `light` at `728px`: readable muted text and SVG strokes, no washed-out badges.
3. `dark` at `390px`: no horizontal clipping, KPI strip collapses to 2 columns, swimlanes stack. SVG figures scale down with the card width, so keep node and tick labels short.
4. `consoleMessages` is `[]`.
