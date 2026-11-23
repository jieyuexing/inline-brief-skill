# AGENTS.md - using and installing inline-brief

Guidance for coding agents that install or use this repository. Humans: see [README.md](README.md).

`inline-brief` is an agent skill with a zero-dependency Node compiler. It turns a short `<ib-*>` source file into one self-contained HTML page for T3 Code's inline `html_preview` / `html_render` tools. Unofficial community skill; not affiliated with or endorsed by T3 Tools Inc.

## Install

1. Copy `skills/inline-brief/` (the whole directory) into the skill directory your agent reads:
   - Claude Code: `.claude/skills/inline-brief/` or `~/.claude/skills/inline-brief/`
   - Codex and Antigravity: `.agents/skills/inline-brief/` in the project
2. Do not run `npm install`; there are no dependencies. Requirement: Node >= 20.
3. Read `skills/inline-brief/SKILL.md`; it is the entry point and links the references.

## Use

1. Collect real evidence with read-only commands first. Never invent metrics.
2. Write `<name>.src.html` using only the tags in `skills/inline-brief/references/components.md`.
3. Compile: `node <skill-dir>/scripts/compile.mjs <name>.src.html <name>.html` (add `--check` to lint only). Exit code 1 means contract errors (printed with line numbers); fix them, never suppress them.
4. Preview with `html_preview` in dark 728, light 728 and dark 390; require empty `consoleMessages`.
5. Call `html_render` with the compiled file and the desktop `contentHeight`.

## Hard rules for generated pages

- No external URLs, `vh`/`dvh` units, `height: 100%` on `html`/`body`, hardcoded colors or outer page chrome. Use `var(--*)` theme tokens only.
- Every `<ib-flow>` and `<ib-trend>` needs a `caption` that states its claim; every edge carries a verb.
- Label whether numbers are measured, sampled or illustrative.

## Repository layout

```
skills/inline-brief/   SKILL.md, references/, kit/ (base.css, runtime.js), scripts/compile.mjs
examples/              two demo sources and their compiled pages
test/compile.test.mjs  node:test suite (no dependencies)
```

## Develop

- Test: `node --test test/*.test.mjs`
- Rebuild committed examples after changing the compiler or kit: `npm run build:examples` (CI fails if `examples/*.html` are stale).
- Release: bump `VERSION` in `compile.mjs` and the four manifests (`package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) together; the test suite fails on any mismatch.
- Keep `compile.mjs` dependency-free and add a failing sample test for every new static check.

## 中文摘要

把 `skills/inline-brief/` 整个目录复制到 Agent 的 skill 目录，无需安装依赖（Node >= 20）。先读 `SKILL.md`，用真实数据写 `.src.html`，用 `compile.mjs` 编译并修完所有 ERROR，再用 `html_preview` 做三态检查，最后 `html_render` 内联显示。
