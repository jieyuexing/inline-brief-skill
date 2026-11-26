---
name: inline-brief
description: Build theme-native, interactive HTML briefs and visual option pickers (KPI strips, trend charts, flow diagrams, swimlane comparisons, steppers, filterable visual selection cards with copyable summary) for T3 Code's native inline html_render pipeline. Use when explaining architectures, repo or metric audits, execution flows, before/after comparisons, OR when asking the user to visually shortlist, compare, or confirm design/asset/architecture options directly on screen instead of typing 1/2/3/4 in chat. Do not use for simple one-paragraph answers. Unofficial community skill, not affiliated with T3 Tools Inc.
---

# Inline Brief

Turn complex systems, diagnostics, comparisons and multi-option user confirmations into compact interactive visuals that render inline in a T3 Code thread through `html_preview` and `html_render`. You write a short semantic `.src.html` using `<ib-*>` tags; a zero-dependency compiler expands it into one self-contained, theme-native HTML file and statically enforces the `html_render` contract.

> Unofficial community skill built for T3 Code's `html_render`. Not affiliated with or endorsed by T3 Tools Inc.

## Core workflow

1. **Gather real evidence first.** Run read-only commands (`git log`, file stats, config reads, symbol lookups) before drawing. Never invent metrics, timings or code paths; state the sampling scope and its limits.
2. **Author a compact `.src.html`** with the `<ib-*>` components in `references/components.md`, choosing the pattern from `references/visual-grammar.md`. Keep custom CSS minimal and bound to theme variables (`references/t3-contract.md`).
3. **Compile and lint** (Node >= 20, no install step):
   ```bash
   node <skill-dir>/scripts/compile.mjs <source.src.html> <output.html>
   ```
   Fix every `ERROR` before previewing. Use `--check` to lint without writing. Never bypass the static contract checks.
4. **Three-state visual QA with `html_preview`:**
   - desktop dark (`appearance: "dark"`, `width: 728`)
   - desktop light (`appearance: "light"`, `width: 728`)
   - mobile (`appearance: "dark"`, `width: 390`)

   Read the returned PNGs. Require an empty `consoleMessages`, no clipped or overlapping text, readable contrast in both themes and clean stacking on mobile.
5. **Render inline with `html_render`** using the compiled `output.html` path and the `contentHeight` reported by the desktop preview.
6. **Keep the text reply complementary.** Do not repeat numbers or labels already in the visual; use the text for the verdict, reasoning boundaries and file or command citations.

## Design rules

- **Diagram first, prose second.** Lead with the answer (a `<ib-kpis>` strip or the mechanism diagram), not a banner. Fold raw logs, commands and checklists into `<ib-details>` at the bottom.
- **Show mechanisms, not label boxes.** Every `<ib-edge>` carries an action verb. For two-sided comparisons use sequential `<ib-lanes>` with `gate` (decision) and `break` (failure or gap) steps instead of two prose columns.
- **Use `<ib-trend>` for change over time**, with `mark` on the events that explain the curve (release, migration, incident).
- **Interactive when motion or selection clarifies.** Add `<ib-stepper>` plus `focus` keys for multi-step flows, state transitions and feedback loops. Whenever the user needs to pick, shortlist, or confirm directions, visual styles, assets, or multi-option trade-offs, use `<ib-picker>` (`mode="triage"` / `multi` / `single`) with real local image thumbnails (`src="imgs/..."`, auto-inlined as `data:` URIs at compile time) or inline `<ib-preview>` SVGs so the user can filter, click cards directly on screen, and copy their structured selection back to the thread instead of typing `1/2/3/4`.
- **Strict sandbox & self-contained hygiene.** While the T3 host allows remote URLs, this skill strictly forbids external URLs (`http(s)://` / `//`), `<iframe>`/`<object>`/`<embed>`, and script network calls (`fetch(`, `XMLHttpRequest`, `import(`) so briefs stay offline/proxy-safe (`data:`, `#id`, and `<ib-option>` local raster images inside the source directory are allowed and inlined at compile time). No `vh`/`dvh` units or `height: 100%` on `html`/`body`/` :root`, no outer page shell, and theme variables only (`--card`, `--border`, `--foreground`, `--chart-1..6`, `--success`, `--warning`, `--destructive`, `--info`). See `references/t3-contract.md` for host facts vs. skill policy.
- **Every figure earns a caption** that states its claim.

## Files

- `scripts/compile.mjs` - compiler and static linter (CLI `inline-brief`).
- `kit/base.css`, `kit/runtime.js` - inlined into every compiled page.
- `references/` - component DSL, visual grammar, `html_render` contract.
- `references/lessons.md` - traps that already broke pages, the compiler or packaging; read before adding a component or gate.
- `agents/openai.yaml` - display metadata for Codex.
- `examples/` (repository root) - compiled demo pages (architecture flow, repo audit, visual direction picker) with sources.
