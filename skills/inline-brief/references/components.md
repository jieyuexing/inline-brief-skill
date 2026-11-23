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
- `<ib-edge>`: `from`/`to` must match node ids. `curve` is `auto` (default), `top` or `bottom` (back edges and loops; avoid two curves on the same side that share an endpoint). `dashed` draws a dashed line.
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

## 7. `<ib-grid>` - two-column wrapper

`<ib-grid>` (or `cols="2"`) places its children in two columns on desktop and stacks them on mobile. Any other `cols` value renders a plain vertical stack.

## 8. `<ib-details>` - folded reference block

```html
<ib-details summary="Commands and scope">
  <pre><code>git log --since="12 weeks ago" --merges</code></pre>
</ib-details>
```

Escape literal `<` as `&lt;` inside the body.

## 9. Page-specific CSS

An optional `<style>` block inside `<ib-page>` is appended to the base kit. It must use `var(--*)` tokens only (no hex, `rgb(`, `hsl(`), no `vh` units and no external URLs.
