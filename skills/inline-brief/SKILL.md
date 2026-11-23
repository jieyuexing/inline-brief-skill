---
name: inline-brief
description: Build theme-native, interactive HTML briefs (KPI strips, trend charts, flow diagrams, swimlane comparisons, steppers) for T3 Code's native inline html_render pipeline. Use when explaining architectures, repo or metric audits, execution flows, before/after comparisons or trade-offs where a figure plus data communicates faster than terminal prose. Do not use for simple one-paragraph answers. Unofficial community skill, not affiliated with T3 Tools Inc.
---

# Inline Brief

Turn complex systems, diagnostics and comparisons into compact interactive visuals that render inline in a T3 Code thread through `html_preview` and `html_render`. You write a short semantic `.src.html` using `<ib-*>` tags; a zero-dependency compiler expands it into one self-contained, theme-native HTML file and statically enforces the `html_render` contract.

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
- **Interactive when motion clarifies.** Add `<ib-stepper>` plus `focus` keys for multi-step flows, state transitions and feedback loops.
- **Strict sandbox & self-contained hygiene.** While the T3 host allows remote URLs, this skill strictly forbids external URLs (`http(s)://` / `//`), `<iframe>`/`<object>`/`<embed>`, and script network calls (`fetch(`, `XMLHttpRequest`, `import(`) so briefs stay offline/proxy-safe (`data:` and `#id` are allowed). No `vh`/`dvh` units or `height: 100%` on `html`/`body`/` :root`, no outer page shell, and theme variables only (`--card`, `--border`, `--foreground`, `--chart-1..6`, `--success`, `--warning`, `--destructive`, `--info`). See `references/t3-contract.md` for host facts vs. skill policy.
- **Every figure earns a caption** that states its claim.

## Files

- `scripts/compile.mjs` - compiler and static linter (CLI `inline-brief`).
- `kit/base.css`, `kit/runtime.js` - inlined into every compiled page.
- `references/` - component DSL, visual grammar, `html_render` contract.
- `examples/` (repository root) - two compiled demo pages with sources.
