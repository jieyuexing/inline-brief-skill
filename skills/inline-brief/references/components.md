# `<ib-*>` component DSL reference

Author a `.src.html` file whose content is wrapped in `<ib-page title="..." lang="en">` and compose it from the tags below. `scripts/compile.mjs` compiles every tag into one self-contained HTML file with inline theme-native CSS and a small runtime. Plain HTML between components (paragraphs, `<span class="ib-ref" data-focus="key">`) passes through. Attribute values may contain `>` when quoted. An unknown or misplaced `<ib-*>` tag is an error.

Shared rules: `tone` is one of `neutral` (default), `info`, `ok`, `warn`, `danger`. `focus` is a comma-separated list of keys; hovering or clicking an element lights every element that shares a key, and `<ib-stepper>` stages drive the same highlight.

## 1. `<ib-kpis>` - telemetry strip

```html
<ib-kpis>
  <ib-kpi label="Bundle deps" value="0" sub="Pure Node ESM" tone="ok" focus="lint"></ib-kpi>
  <ib-kpi label="Thread width" value="728px" sub="Stacks at 360px" tone="info"></ib-kpi>
</ib-kpis>
```

Two to four columns on desktop, two on mobile.

## 2. `<ib-bars>` - zero-baseline comparison bars

```html
<ib-bars title="Footprint" note="Measured per page" unit="lines" max="400" caption="The DSL is ~5x shorter.">
  <ib-bar label="Raw HTML + SVG" value="380" tone="danger"></ib-bar>
  <ib-bar label="inline-brief source" value="85" tone="ok"></ib-bar>
</ib-bars>
```

`value` must be a non-negative number. Omit `max` to scale to the largest bar; a `max` below the largest bar is an error. `caption` is optional but recommended.

## 3. `<ib-trend>` - line and area trend chart

```html
<ib-trend title="Merged PRs per week" note="12 weeks" unit="PRs" max="40" caption="Throughput stepped up after v1.0.">
  <ib-point label="Aug 04" value="6" />
  <ib-point label="Sep 01" value="14" mark="v1.0 release" tone="info" />
  <ib-point label="Oct 20" value="31" />
</ib-trend>
```

- `caption` is required; the compiler rejects a trend without it.
- Needs at least 2 `<ib-point>`. Points are evenly spaced categories in source order; `label` is required.
- `value` must be a non-negative number; the y axis starts at 0. `max` is optional (default: a "nice" ceiling above the largest value); a `max` below the largest value is an error.
- `mark` (optional) draws a dashed vertical milestone line with the text on top; `tone` colors the mark and its point. Two marks that would overlap raise a warning.
- Values are labelled when there are <= 8 points; with more points only marked points, the peak and the last point are labelled. Every point has a hover tooltip. `unit` appears as a pill in the header.
- Colors use `var(--chart-1)`, `var(--border)`, `var(--muted-foreground)` and the semantic tone variables.

## 4. `<ib-flow>` - auto-routed mechanism and loop diagram

Places nodes on a 1-indexed `(col, row)` grid and routes labeled SVG edges, so you never calculate pixel coordinates.

```html
<ib-flow title="Pipeline" note="Hover nodes" caption="Every page is linted before preview.">
  <ib-node id="src" col="1" row="1" sub=".src.html" focus="src">Author</ib-node>
  <ib-node id="lint" col="2" row="1" sub="compile.mjs" tone="info" focus="lint">Compile</ib-node>
  <ib-node id="qa" col="3" row="1" sub="3 states" tone="warn" focus="qa">Preview</ib-node>
  <ib-edge from="src" to="lint" label="validates" tone="info" focus="lint"></ib-edge>
  <ib-edge from="lint" to="qa" label="emits" tone="info" focus="qa"></ib-edge>
  <ib-edge from="qa" to="src" label="fix layout" tone="warn" dashed curve="bottom" focus="qa"></ib-edge>
</ib-flow>
```

- `caption` is required. Node `id` is required and unique; `col`/`row` are positive integers (use 1-4 columns for 728px).
- `<ib-edge>`: `from`/`to` must match node ids; `label` (an action verb) is required. `curve` is `auto` (default), `top` or `bottom` (back edges and loops; avoid two curves on the same side that share an endpoint). `dashed` draws a dashed line.
- Labels on edges between horizontally adjacent nodes must be short; the compiler warns when they exceed the gap.
- Below 560px the flow diagram keeps a 540px minimum width and scrolls horizontally inside its card to stay legible; keep labels short so desktop and mobile stay crisp.

## 5. `<ib-lanes>` - sequential swimlane comparison

```html
<ib-lanes title="Workflow" note="Execution order" caption="Static linting catches violations before preview.">
  <ib-lane name="Ad-hoc HTML" tone="danger">
    <ib-step kind="action" note="~380 lines">Hand-code CSS and SVG</ib-step>
    <ib-step kind="break" note="vh loop">Theme clash or iframe error</ib-step>
  </ib-lane>
  <ib-lane name="inline-brief" tone="ok">
    <ib-step kind="action" note="~80 lines" focus="src">Write semantic DSL</ib-step>
    <ib-step kind="gate" note="3 screenshots" focus="qa">Confirm dark, light, mobile</ib-step>
  </ib-lane>
</ib-lanes>
```

`kind` is `action` (default), `gate` (decision or review checkpoint) or `break` (failure or gap). Up to three lanes side by side; stacks on mobile.

## 6. `<ib-stepper>` - interactive walkthrough

```html
<ib-stepper title="Walk the pipeline" note="Click a step or Play">
  <ib-stage title="Author" focus="src">The agent writes nodes and data, not CSS boilerplate.</ib-stage>
  <ib-stage title="Gate" focus="lint">The compiler blocks vh units and hardcoded colors.</ib-stage>
</ib-stepper>
```

Prev, Next, Play and All controls. Selecting a stage highlights every element whose `focus` matches the stage's keys and dims the rest.

## 7. `<ib-picker>` - interactive visual option picker & confirmation board

Lets the user filter candidates by category, mark choices directly on screen, and copy a structured selection summary back into the chat thread (instead of typing option numbers manually).

```html
<ib-picker title="Shortlist 1–2 directions" note="Click cards, then copy summary" mode="triage" cols="2">
  <ib-option id="01" title="Low-Poly 3D" group="Game Art" badge="CC0" tone="ok" sub="3-head stylized base" src="assets/opt-lowpoly.png" fit="cover" focus="opt1">
    <ul>
      <li><b>Strength:</b> Fast palette swaps.</li>
      <li><b>Trade-off:</b> Needs custom modular hair/robe slots.</li>
    </ul>
  </ib-option>
  <ib-option id="02" title="Editorial Bento" group="Interface" badge="Recommended" tone="info" sub="KPI strip + one main visual" focus="opt2">
    <ib-preview>
      <svg viewBox="0 0 320 200" width="320" height="200">...</svg>
    </ib-preview>
    <p>Scans in 5 seconds and stacks cleanly on 390px mobile.</p>
  </ib-option>
</ib-picker>
```

- Needs at least 2 `<ib-option>` children. Every `<ib-option>` requires a unique `id` (within the picker) and a `title`.
- `mode` is `triage` (default: `★ Shortlist` / `✕ Skip`), `multi` (`✓ Select`), or `single` (`◉ Choose`). UI labels localize automatically when `<ib-page lang="zh...">` is set. `copy-label` overrides the Copy button text.
- `cols` is `2` (default, collapses to 1 column at `<= 560px`) or `3`.
- `group` (optional): when at least 2 distinct groups exist, the compiler auto-renders a category filter pill bar (`All (N)` + one pill per group).
- Visual thumbnail (optional — omit both `src` and `<ib-preview>` for clean text/decision cards):
  - `src`: either a `data:image/...` URI or a **relative local raster image path** inside the `.src.html` directory (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `<= 2 MiB` per image; total inlined images warn above `1.5 MiB` raw and fail above `6 MiB` raw — resize/convert thumbnails to WebP `<= 640px` wide; no `..`, no absolute paths, no symlink escapes). `compile.mjs` inlines local files as `data:image/...;base64,...` so the output stays strictly offline. External `http(s)://` URLs are rejected by Gate 3. `fit` is `cover` (default), `contain`, or `pixel` (`image-rendering: pixelated; object-fit: contain`).
  - `<ib-preview>...</ib-preview>`: inline theme-native `<svg viewBox="...">` or compact HTML preview. Cannot be combined with `src` on the same `<ib-option>`.
- Built-in **zoom & A/B compare** + **per-card notes** + **sandbox copy fallback**:
  - Cards with media render a `⤢` zoom/compare button (clicking an `<ib-preview>` SVG also opens it; bare `<img>` clicks remain compatible with T3's native image lightbox). Inside the `<dialog>` compare view, users step `←` / `→` across visible candidates and mark or annotate directly.
  - Each card includes a short single-line note input; notes are appended inside parentheses in the copied summary (and standalone notes on unmarked cards appear under `Notes:` / `备注：`).
  - If the sandboxed iframe blocks clipboard writes, clicking Copy reveals and auto-selects a read-only plain-text `<textarea>` for instant `⌘C` / `Ctrl+C`.
- `badge` + `tone` (`neutral`, `info`, `ok`, `warn`, `danger`) adds a status pill (e.g. license, risk, recommendation). `focus` links the card to other charts/flows on the page.

## 8. `<ib-grid>` - two-column wrapper

`<ib-grid>` (or `cols="2"`) places its children in two columns on desktop and stacks them on mobile. Any other `cols` value renders a plain vertical stack.

## 9. `<ib-details>` - folded reference block

```html
<ib-details summary="Commands and scope">
  <pre><code>git log --since="12 weeks ago" --merges</code></pre>
</ib-details>
```

Escape literal `<` as `&lt;` inside the body.

## 10. Page-specific CSS

An optional `<style>` block inside `<ib-page>` is appended to the base kit. It must use `var(--*)` tokens only (no hex, `rgb(`, `hsl(`), no `vh` units and no external URLs.
