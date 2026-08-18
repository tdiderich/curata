/**
 * Dead-code checker (phase 1): finds CSS classes defined in src/app/globals.css
 * that have no corresponding className usage anywhere under src/components or
 * src/app.
 *
 * CSS side: parsed with postcss + postcss-selector-parser so we correctly
 * handle pseudo-classes/elements (::before, :hover, ...), media queries,
 * compound selectors (.a.b), and comma-separated selector lists (.a, .b).
 * globals.css does not use real CSS nesting (no Tailwind/@apply either -
 * verified: no @tailwind/@apply/tailwind.config in this repo), so no nesting
 * flattening is needed, but the walk is written to not care either way since
 * postcss's `walkRules` recurses into every container (including @media).
 *
 * TSX side: parsed with the TypeScript compiler API (already a project
 * dependency) rather than regex, so template literals, ternaries, and
 * string concatenation are read from the real AST instead of pattern-matched.
 *
 * Usage: tsx scripts/find-unused-css.ts
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const ROOT = path.resolve(__dirname, "..");
const CSS_FILE = path.join(ROOT, "src/app/globals.css");
const SCAN_DIRS = ["src/components", "src/app"];
const REPORT_FILE = path.join(ROOT, "scripts/unused-css-report.txt");

// ---------------------------------------------------------------------------
// CSS side: collect every class defined in globals.css, its location(s), and
// which other classes it co-occurs with in the same selector (intra-CSS
// reference - e.g. `.btn.btn--primary` or `.parent:hover .child`).
// ---------------------------------------------------------------------------

interface CssClassInfo {
  name: string;
  locations: { line: number; selector: string }[];
  coOccursWith: Set<string>;
}

function parseCssClasses(cssPath: string): Map<string, CssClassInfo> {
  const css = fs.readFileSync(cssPath, "utf8");
  const root = postcss.parse(css, { from: cssPath });
  const classes = new Map<string, CssClassInfo>();

  const getOrCreate = (name: string): CssClassInfo => {
    let info = classes.get(name);
    if (!info) {
      info = { name, locations: [], coOccursWith: new Set() };
      classes.set(name, info);
    }
    return info;
  };

  root.walkRules((rule) => {
    // Skip keyframe selectors (0%, from, to, ...) - selector-parser will
    // just find no `class` nodes in them anyway, but skip early for clarity.
    let parsed: selectorParser.Root;
    try {
      parsed = selectorParser().astSync(rule.selector);
    } catch {
      return; // malformed/non-standard selector (rare); skip rather than crash
    }

    const line = rule.source?.start?.line ?? 0;

    // Each top-level child of `parsed` is one comma-separated selector
    // branch (e.g. `.a, .b` -> two branches). Classes within the same
    // branch co-occur with each other, whether compound (`.a.b`) or
    // combined via a combinator (`.a .b`, `.a > .b`, `.a:hover .b`, ...).
    parsed.each((selectorNode) => {
      const namesInBranch: string[] = [];
      selectorNode.walkClasses((classNode) => {
        namesInBranch.push(classNode.value);
      });
      namesInBranch.forEach((name) => {
        const info = getOrCreate(name);
        info.locations.push({ line, selector: rule.selector.trim() });
        namesInBranch.forEach((other) => {
          if (other !== name) info.coOccursWith.add(other);
        });
      });
    });
  });

  return classes;
}

// ---------------------------------------------------------------------------
// TSX side: walk every className attribute and extract whatever literal
// class-name tokens we can prove statically, plus "dynamic fragment" prefixes/
// suffixes for template/concatenation pieces that are glued to a variable
// (e.g. `` `pg-tag-k-${kind}` `` -> prefix fragment "pg-tag-k-").
// ---------------------------------------------------------------------------

interface UsageCtx {
  literalTokens: Set<string>;
  prefixFragments: Set<string>;
  suffixFragments: Set<string>;
}

function addTextSegment(
  text: string,
  ctx: UsageCtx,
  opts: { precededByDynamic: boolean; followedByDynamic: boolean },
) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return;

  const endsWithSpace = /\s$/.test(text);
  const startsWithSpace = /^\s/.test(text);
  const literalTokens = tokens;

  // Token glued to a following expression with no whitespace between them
  // (e.g. `app-sidebar` in `` `app-sidebar${open ? " app-sidebar--open" : ""}` ``)
  // is a dynamic prefix candidate (the substitution may append more, e.g.
  // "app-sidebar--open"), BUT it also stands alone as a literal token in its
  // own right whenever the substitution resolves to "" - so record it as
  // both a prefix fragment and a literal token rather than choosing one.
  if (opts.followedByDynamic && !endsWithSpace) {
    ctx.prefixFragments.add(literalTokens[literalTokens.length - 1]);
  }
  // Same reasoning in the other direction for a token glued to a preceding
  // expression (e.g. the `-foo` in `` `${prefix}-foo` ``).
  if (opts.precededByDynamic && !startsWithSpace && literalTokens.length > 0) {
    ctx.suffixFragments.add(literalTokens[0]);
  }

  literalTokens.forEach((t) => ctx.literalTokens.add(t));
}

function flattenPlusChain(expr: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expr)) return flattenPlusChain(expr.expression);
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...flattenPlusChain(expr.left), ...flattenPlusChain(expr.right)];
  }
  return [expr];
}

function walkExpr(expr: ts.Expression | undefined, ctx: UsageCtx) {
  if (!expr) return;

  if (ts.isParenthesizedExpression(expr)) {
    walkExpr(expr.expression, ctx);
    return;
  }

  if (ts.isStringLiteralLike(expr)) {
    addTextSegment(expr.text, ctx, { precededByDynamic: false, followedByDynamic: false });
    return;
  }

  if (ts.isTemplateExpression(expr)) {
    const segments: ts.LiteralLikeNode[] = [expr.head, ...expr.templateSpans.map((s) => s.literal)];
    segments.forEach((seg, i) => {
      addTextSegment(seg.text, ctx, {
        precededByDynamic: i > 0,
        followedByDynamic: i < segments.length - 1,
      });
    });
    // Recurse into the substitutions themselves in case one is a nested
    // ternary/template that resolves to its own literal class names, e.g.
    // `` `foo ${cond ? "bar" : "baz"}` ``.
    expr.templateSpans.forEach((s) => walkExpr(s.expression, ctx));
    return;
  }

  if (ts.isConditionalExpression(expr)) {
    walkExpr(expr.whenTrue, ctx);
    walkExpr(expr.whenFalse, ctx);
    return;
  }

  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const flat = flattenPlusChain(expr);
    flat.forEach((node, i) => {
      if (ts.isStringLiteralLike(node)) {
        addTextSegment(node.text, ctx, {
          precededByDynamic: i > 0,
          followedByDynamic: i < flat.length - 1,
        });
      } else {
        // Not a plain string literal (identifier, call, etc) - recurse in
        // case it's itself a resolvable ternary/template; otherwise it's
        // opaque and we can't extract anything further from it.
        walkExpr(node, ctx);
      }
    });
    return;
  }

  // Identifier / CallExpression / PropertyAccess / etc - fully dynamic,
  // nothing static to extract.
}

function collectTsxFiles(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      collectTsxFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

function scanTsxUsage(scanDirs: string[]): { usage: UsageCtx; files: string[] } {
  const ctx: UsageCtx = {
    literalTokens: new Set(),
    prefixFragments: new Set(),
    suffixFragments: new Set(),
  };

  const files: string[] = [];
  for (const dir of scanDirs) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) collectTsxFiles(abs, files);
  }

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "className" && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          addTextSegment(node.initializer.text, ctx, { precededByDynamic: false, followedByDynamic: false });
        } else if (ts.isJsxExpression(node.initializer)) {
          walkExpr(node.initializer.expression, ctx);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { usage: ctx, files };
}

// ---------------------------------------------------------------------------
// Cross-reference and report
// ---------------------------------------------------------------------------

type Status = "used" | "possible-dynamic" | "unused";

function classify(
  name: string,
  usage: UsageCtx,
): { status: Status; matchedFragment?: string } {
  if (usage.literalTokens.has(name)) return { status: "used" };

  for (const prefix of usage.prefixFragments) {
    if (prefix && name.startsWith(prefix)) return { status: "possible-dynamic", matchedFragment: `${prefix}*` };
  }
  for (const suffix of usage.suffixFragments) {
    if (suffix && name.endsWith(suffix)) return { status: "possible-dynamic", matchedFragment: `*${suffix}` };
  }
  return { status: "unused" };
}

function main() {
  const cssClasses = parseCssClasses(CSS_FILE);
  const { usage, files: scannedFiles } = scanTsxUsage(SCAN_DIRS);

  const unused: { info: CssClassInfo; coOccursUsed: string[] }[] = [];
  const possibleDynamic: { info: CssClassInfo; matchedFragment: string }[] = [];
  let usedCount = 0;

  const sortedNames = [...cssClasses.keys()].sort(
    (a, b) => cssClasses.get(a)!.locations[0].line - cssClasses.get(b)!.locations[0].line,
  );

  for (const name of sortedNames) {
    const info = cssClasses.get(name)!;
    const { status, matchedFragment } = classify(name, usage);
    if (status === "used") {
      usedCount++;
    } else if (status === "possible-dynamic") {
      possibleDynamic.push({ info, matchedFragment: matchedFragment! });
    } else {
      // Intra-CSS reference note: does this otherwise-unused class
      // co-occur (in a selector) with a class that IS used/dynamic?
      const coOccursUsed = [...info.coOccursWith].filter((other) => {
        const otherClassify = classify(other, usage);
        return otherClassify.status !== "unused";
      });
      unused.push({ info, coOccursUsed });
    }
  }

  const lines: string[] = [];
  lines.push("Unused CSS class report");
  lines.push(`Source: ${path.relative(ROOT, CSS_FILE)}`);
  lines.push(`Scanned ${scannedFiles.length} .tsx files under: ${SCAN_DIRS.join(", ")}`);
  lines.push("");

  lines.push(`== Unused classes (${unused.length}) ==`);
  lines.push("No className usage (literal or dynamic-pattern) found in any .tsx file.");
  lines.push("");
  for (const { info, coOccursUsed } of unused) {
    for (const loc of info.locations) {
      let line = `  globals.css:${loc.line}  .${info.name}  (selector: ${loc.selector})`;
      if (coOccursUsed.length > 0) {
        line += `  [co-occurs in CSS with used class(es): ${coOccursUsed.join(", ")}]`;
      }
      lines.push(line);
    }
  }
  lines.push("");

  lines.push(`== Possible dynamic (${possibleDynamic.length}) ==`);
  lines.push("Matches a dynamic prefix/suffix fragment from a template literal or");
  lines.push("concatenation (e.g. `${prefix}-foo`); not confirmed used, not counted as unused.");
  lines.push("");
  for (const { info, matchedFragment } of possibleDynamic) {
    for (const loc of info.locations) {
      lines.push(`  globals.css:${loc.line}  .${info.name}  (selector: ${loc.selector})  [matches: ${matchedFragment}]`);
    }
  }
  lines.push("");

  lines.push("== Summary ==");
  lines.push(`  Total distinct classes in globals.css: ${cssClasses.size}`);
  lines.push(`  Used (literal className match):        ${usedCount}`);
  lines.push(`  Possible dynamic (not confirmed):      ${possibleDynamic.length}`);
  lines.push(`  Unused:                                ${unused.length}`);

  const report = lines.join("\n") + "\n";
  fs.writeFileSync(REPORT_FILE, report);
  console.log(report);
  console.log(`Report written to ${path.relative(ROOT, REPORT_FILE)}`);
}

main();
