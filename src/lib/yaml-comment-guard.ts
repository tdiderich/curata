/**
 * YAML `#` truncation guard. In a plain (unquoted) scalar, " #" starts a
 * comment, so `body: We cut 40% #1 priority` stores "We cut 40%" and
 * `hex: #899878` stores null. Nothing errors; the page just loses text.
 * This scan finds those spots in raw page YAML so a write can carry a
 * warning back to the agent. It never blocks: a human may mean a comment.
 *
 * Line-based on purpose: js-yaml drops comments before we could see them.
 * Block scalars (`|`, `>`) and quoted or flow values are skipped, since `#`
 * is literal in the first two and flow syntax errors loudly on its own.
 */
import type { ShapeWarning } from "./kazam";

const BLOCK_SCALAR_RE = /:\s*[|>][-+0-9]*\s*(#.*)?$|^\s*-\s+[|>][-+0-9]*\s*(#.*)?$/;
// Optional list dash, optional `key:` (plain key), then the value.
const LINE_RE = /^(\s*)(-\s+)?(?:([^\s"'#{[][^:#]*?):(?=\s|$))?\s*(.*)$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export function findTruncatingComments(content: string): ShapeWarning[] {
  const warnings: ShapeWarning[] = [];
  const lines = content.split(/\r?\n/);
  let blockIndent = -1; // >= 0 while inside a block scalar body

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (blockIndent >= 0) {
      if (line.trim() === "" || indentOf(line) > blockIndent) continue;
      blockIndent = -1;
    }
    if (BLOCK_SCALAR_RE.test(line)) {
      blockIndent = indentOf(line);
      continue;
    }
    if (/^\s*#/.test(line) || line.trim() === "" || line.trim() === "---") continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;
    const key = m[3]?.trim();
    const rest = m[4] ?? "";
    // Value is a whole comment: `hex: #899878` stores null.
    if (key && /^#\S/.test(rest)) {
      warnings.push(warn(i, key, `the value starts with "#", so YAML reads it as a comment and stores nothing`));
      continue;
    }
    if (!rest || /^["'{[|>&*!]/.test(rest)) continue;
    const at = rest.search(/\s#/);
    if (at <= 0) continue;
    const kept = rest.slice(0, at).trim();
    warnings.push(warn(i, key ?? "item", `unquoted " #" cuts the value to "${kept.length > 40 ? `${kept.slice(0, 40)}…` : kept}"`));
  }
  return warnings;
}

function warn(lineIndex: number, field: string, what: string): ShapeWarning {
  return {
    path: `line ${lineIndex + 1}`,
    component: "yaml",
    message: `${field}: ${what}. Quote the whole value ("...") to keep the text after #.`,
    rule: "yaml-unquoted-hash",
    scope: "yaml",
  };
}
