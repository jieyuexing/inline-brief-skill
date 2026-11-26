# Lessons

Traps `inline-brief` has hit or is easy to hit, and what avoids them. Check this list before adding a component or a gate. Paths under `test/` and the repository-level `scripts/` exist only in the source repository, not in an installed skill.

## Page and host

- **Height that follows the viewport loops.** `vh`/`dvh`/`svh`/`lvh` and `height: 100%` on `html`/`body` make the `html_render` iframe resize itself forever (or get rejected). Size charts with a `viewBox` or explicit px; the compiler rejects both (gates 1 and 2).
- **The thread is 728px, phones ~390px.** Every two-column layout stacks below `560px`. A flow diagram cannot shrink that far and stay legible, so `.ib-flow-svg` keeps `min-width: 540px` and scrolls inside its own card; the document itself must never scroll sideways.
- **Theme colours come from the host.** T3 injects `--card`, `--border`, `--chart-1..6` and friends on `:root`, and swaps them on theme change without reloading. A hardcoded colour survives the swap and clashes, so gate 4 rejects them everywhere, including SVG `fill`/`stroke`.
- **Remote URLs stall behind proxies.** The host allows them, but fonts, CDN scripts and images hang on fake-IP DNS. The skill keeps pages fully offline (gate 3) and inlines local images at compile time.
- **The sandbox cannot write the clipboard.** `navigator.clipboard.writeText` rejects and `execCommand("copy")` returns false inside the iframe. The picker reveals a selected read-only `<textarea>` so one Ctrl/Cmd+C copies the summary; never rely on the clipboard alone.
- **Image budget.** Each inlined image is capped at 2 MiB, and the page total warns above 1.5 MiB raw and fails above 6 MiB raw (~8 MiB base64), well under T3's 25 MiB cap and 6-second measurement timeout. Resize thumbnails to <= 640px or convert them to WebP.

## Compiler

- **Entities decode once.** `&amp;lt;` must stay the literal text `&lt;`; decoding it twice turned it into `<`. Decode in a single regex pass.
- **Attribute values may hold `<` and `>`.** HTML allows `label="a > b"`, but regex tag scanners read `"<style>"` inside a value as markup. Encode brackets inside quoted values before scanning and keep newlines in place so error line numbers still match the source.
- **Every new static check ships with a sample that fails** on the old compiler first (repository `test/compile.test.mjs`).

## Packaging

- **Strict YAML frontmatter.** Claude Code, Codex, Cursor and Gemini CLI parse `SKILL.md` frontmatter strictly and silently skip a skill that fails. An unquoted value containing `: ` or ` #` is enough: quote it. `name` must equal the folder name and `description` stays within 1024 characters (repository `test/skill-checks.test.mjs`).
- **One version, four manifests.** `VERSION` in `compile.mjs` is the source; `package.json`, `plugin.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` must match it.
- **Do not list `skills` on a `source: "./"` marketplace entry.** Claude Code already discovers `skills/`; listing them again loads each skill twice.

## Repository browser tooling (top-level `scripts/`, not the skill's `scripts/`)

- **A virtual clock must cover `setInterval`.** The stepper's Play uses `setInterval`; freezing only `setTimeout` and `requestAnimationFrame` would leave it on wall time and the recording would drift.
- **Nothing sits above a modal `<dialog>`.** `showModal()` puts it in the top layer, over any `z-index`. Draw a recording cursor onto the screenshots, not into the page.
- **Headless Chromium can copy.** Outside the sandbox the copy succeeds (the button says `Copied`) and the fallback never shows; deny the clipboard in an init script to test what T3 users see.
