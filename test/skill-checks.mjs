// Zero-dependency checks that keep the skill loadable in every agent.
// Claude Code, Codex, Cursor and Gemini CLI read SKILL.md frontmatter with strict YAML parsers and
// silently skip a skill whose frontmatter fails (an unquoted "word: word" in a description is
// enough), so the frontmatter is held to a small, strict YAML subset here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/;

function scalarProblem(value) {
  if (/^["']/.test(value)) {
    const q = value[0];
    const body = q === '"' ? /^"(?:[^"\\]|\\.)*"\s*$/ : /^'(?:[^']|'')*'\s*$/;
    return body.test(value) ? null : `unterminated or trailing text after ${q}-quoted value`;
  }
  if (/^[|>][-+]?\s*$/.test(value)) return null;
  if (/^[[{&*!|>%@`,?]/.test(value) || /^-\s/.test(value)) return `plain value starts with YAML indicator "${value[0]}"; quote it`;
  if (/:(\s|$)/.test(value)) return 'plain value contains ": " which strict YAML reads as a nested key; quote the value';
  if (/\s#/.test(value)) return 'plain value contains " #" which YAML reads as a comment; quote the value';
  return null;
}

/** Parse the SKILL.md frontmatter with strict-YAML rules; returns { data, errors }. */
export function checkFrontmatter(text, dirName) {
  const errors = [];
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { data: {}, errors: ["no frontmatter block at the top"] };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let block = null;
  lines.forEach((line, i) => {
    const where = `frontmatter line ${i + 2}`;
    if (!line.trim() || /^\s*#/.test(line)) return;
    if (/\t/.test(line.match(/^\s*/)[0])) return errors.push(`${where}: tab indentation`);
    if (/^\s/.test(line)) {
      if (!block) return errors.push(`${where}: indented line without a parent key`);
      if (block.style === "plain") {
        const p = scalarProblem(line.trim());
        if (p) errors.push(`${where}: ${p}`);
        data[block.key] += ` ${line.trim()}`;
      } else if (block.style === "map") {
        const k = KEY.exec(line.trim());
        if (!k) return errors.push(`${where}: expected "key: value" under ${block.key}`);
        const p = k[2] ? scalarProblem(k[2]) : null;
        if (p) errors.push(`${where}: ${p}`);
      } else data[block.key] += `${data[block.key] ? "\n" : ""}${line.trim()}`;
      return;
    }
    const k = KEY.exec(line);
    if (!k) return errors.push(`${where}: expected "key: value", got ${JSON.stringify(line.slice(0, 40))}`);
    const [, key, raw = ""] = k;
    if (Object.hasOwn(data, key)) errors.push(`${where}: duplicate key "${key}"`);
    const value = raw.trim();
    const p = value ? scalarProblem(value) : null;
    if (p) errors.push(`${where}: ${p}`);
    if (!value) block = { key, style: "map" };
    else if (/^[|>]/.test(value)) block = { key, style: "block" };
    else block = { key, style: /^["']/.test(value) ? "quoted" : "plain" };
    data[key] = p ? value : /^"/.test(value) ? JSON.parse(value.trim()) : /^'/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : /^[|>]/.test(value) ? "" : value;
  });
  if (typeof data.name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.name) || data.name.length > 64) {
    errors.push(`name must be kebab-case, 64 characters at most (got ${JSON.stringify(data.name)})`);
  } else if (data.name !== dirName) {
    errors.push(`name "${data.name}" must match its folder "${dirName}" (Gemini CLI and Cursor key skills by folder)`);
  }
  if (typeof data.description !== "string" || !data.description.trim()) errors.push("description must be a non-empty string");
  else if (data.description.length > 1024) errors.push(`description is ${data.description.length} characters; agents allow 1024 at most`);
  return { data, errors };
}

/** Backticked scripts/, references/ and kit/ paths in SKILL.md that do not exist under the skill dir. */
export function missingRefs(text, skillDir) {
  return [...text.matchAll(/`((?:scripts|references|kit)\/[^`\s]*)`/g)].map((m) => m[1]).filter((ref) => !existsSync(join(skillDir, ref)));
}

export const MANIFESTS = [
  "package.json",
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

/** Every distribution manifest parses, agrees on name and version, and points at real paths. */
export function manifestProblems(root, version, name = "inline-brief-skill") {
  const problems = [];
  const at = (p) => join(root, p);
  for (const rel of MANIFESTS) {
    if (!existsSync(at(rel))) {
      problems.push(`${rel}: missing`);
      continue;
    }
    let j;
    try {
      j = JSON.parse(readFileSync(at(rel), "utf8"));
    } catch (e) {
      problems.push(`${rel}: invalid JSON (${e.message})`);
      continue;
    }
    if (j.name !== name) problems.push(`${rel}: name is ${JSON.stringify(j.name)}, expected "${name}"`);
    if (j.version !== undefined && j.version !== version) problems.push(`${rel}: version ${j.version} != compile.mjs VERSION ${version}`);
    if (typeof j.skills === "string" && !existsSync(at(j.skills))) problems.push(`${rel}: skills path ${j.skills} does not exist`);
    for (const bin of Object.values(typeof j.bin === "object" && j.bin ? j.bin : {})) {
      if (!existsSync(at(bin))) problems.push(`${rel}: bin ${bin} does not exist`);
    }
    for (const f of Array.isArray(j.files) ? j.files : []) if (!existsSync(at(f))) problems.push(`${rel}: files entry ${f} does not exist`);
    for (const plugin of Array.isArray(j.plugins) ? j.plugins : []) {
      if (plugin.name !== name) problems.push(`${rel}: plugin name ${JSON.stringify(plugin.name)}, expected "${name}"`);
      if (plugin.version !== undefined && plugin.version !== version) problems.push(`${rel}: plugin version ${plugin.version} != ${version}`);
      const local = typeof plugin.source === "string" ? plugin.source : plugin.source?.source === "local" ? plugin.source.path : null;
      if (local && !existsSync(at(local))) problems.push(`${rel}: plugin source ${local} does not exist`);
      for (const s of [].concat(plugin.skills || [])) if (!existsSync(join(at(s), "SKILL.md"))) problems.push(`${rel}: lists ${s}, which has no SKILL.md`);
      // Claude Code already discovers skills/ under the plugin source; listing them too loads each twice
      if (rel === ".claude-plugin/marketplace.json" && plugin.source === "./" && plugin.skills) {
        problems.push(`${rel}: plugin "${plugin.name}" lists skills that skills/ already provides; each would load twice`);
      }
    }
  }
  return problems;
}
