import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../skills/inline-brief/scripts/compile.mjs";
import { MANIFESTS, checkFrontmatter, manifestProblems, missingRefs } from "./skill-checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills/inline-brief");
const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const fm = (body) => `---\n${body}\n---\n\n# Title\n`;

test("SKILL.md frontmatter loads under strict YAML rules, name matches folder, description <= 1024", () => {
  const { data, errors } = checkFrontmatter(SKILL, "inline-brief");
  assert.deepEqual(errors, []);
  assert.equal(data.name, "inline-brief");
  assert.ok(data.description.length > 0 && data.description.length <= 1024);
});

test("frontmatter checker rejects the shapes strict parsers skip silently", () => {
  const bad = {
    'unquoted "word: word"': fm("name: inline-brief\ndescription: Builds briefs. Use for: architecture walks"),
    'unquoted " #"': fm("name: inline-brief\ndescription: Builds briefs #1 for T3"),
    "name differs from folder": fm("name: inline-briefs\ndescription: Builds briefs"),
    "name not kebab-case": fm("name: Inline_Brief\ndescription: Builds briefs"),
    "empty description": fm("name: inline-brief\ndescription: \"\""),
    "description too long": fm(`name: inline-brief\ndescription: ${"x".repeat(1025)}`),
    "duplicate key": fm("name: inline-brief\nname: inline-brief\ndescription: Builds briefs"),
    "unterminated quote": fm('name: inline-brief\ndescription: "Builds briefs'),
    "indicator start": fm("name: inline-brief\ndescription: *briefs"),
    "continuation with colon": fm("name: inline-brief\ndescription: Builds briefs\n  for: T3"),
    "no frontmatter": "# Title only\n",
  };
  for (const [label, text] of Object.entries(bad)) {
    assert.ok(checkFrontmatter(text, "inline-brief").errors.length > 0, `${label} should fail`);
  }
  const good = fm("name: inline-brief\ndescription: \"Builds briefs. Use for: architecture walks\"\nlicense: MIT\nmetadata:\n  version: \"0.2.1\"");
  assert.deepEqual(checkFrontmatter(good, "inline-brief").errors, []);
  assert.equal(checkFrontmatter(good, "inline-brief").data.description, "Builds briefs. Use for: architecture walks");
});

test("every scripts/, references/ and kit/ path SKILL.md mentions exists", () => {
  assert.deepEqual(missingRefs(SKILL, SKILL_DIR), []);
  assert.deepEqual(missingRefs("Read `references/nope.md` and `kit/base.css`.", SKILL_DIR), ["references/nope.md"]);
});

test("all distribution manifests parse, agree with compile.mjs VERSION and point at real paths", () => {
  assert.deepEqual(manifestProblems(ROOT, VERSION), []);
});

test("manifest checker catches version drift, broken paths and double-loaded Claude skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "ib-manifests-"));
  try {
    for (const rel of [...MANIFESTS, "skills", "examples", "llms.txt", "README.md", "README.zh-CN.md", "AGENTS.md"]) {
      cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
    }
    assert.deepEqual(manifestProblems(dir, VERSION), [], "a faithful copy passes");
    const edit = (rel, fn) => {
      const p = join(dir, rel);
      const j = JSON.parse(readFileSync(p, "utf8"));
      fn(j);
      writeFileSync(p, JSON.stringify(j));
    };
    edit("gemini-extension.json", (j) => { j.version = "9.9.9"; });
    edit(".codex-plugin/plugin.json", (j) => { j.skills = "./skillz/"; });
    edit(".claude-plugin/marketplace.json", (j) => { j.plugins[0].skills = ["./skills/inline-brief"]; });
    writeFileSync(join(dir, ".cursor-plugin/plugin.json"), "{ not json");
    const problems = manifestProblems(dir, VERSION).join("\n");
    assert.match(problems, /gemini-extension\.json: version 9\.9\.9/);
    assert.match(problems, /\.codex-plugin\/plugin\.json: skills path \.\/skillz\/ does not exist/);
    assert.match(problems, /each would load twice/);
    assert.match(problems, /\.cursor-plugin\/plugin\.json: invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
