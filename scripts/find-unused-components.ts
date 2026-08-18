/**
 * Dead-code checker (phase 2) & Shared Component Analyzer:
 *
 * 1. Discovers all exported React components across both `curata` (OSS base)
 *    and `curata-app` (hosted extensions overlay).
 * 2. Parses TypeScript ASTs using the TypeScript compiler API to extract:
 *    - Component declarations (named, default, forwardRef, memo)
 *    - Value imports (ignoring `import type` and `export type`)
 *    - Re-export chains (resolving barrel files like `settings/index.ts`)
 *    - Dynamic imports (`import()`, `dynamic()`, `lazy()`)
 *    - JSX render sites and Storybook `meta.component` declarations
 * 3. Performs Graph Reachability Analysis starting from App Router Entry Points:
 *    - Finds direct dead components (0 imports)
 *    - Finds transitive dead components (only imported by other dead components)
 *    - Identifies story-only components (reachable only from Storybook)
 * 4. Analyzes Component Reuse and Architecture:
 *    - Computes live consumer fan-in count & domain diversity
 *    - Identifies Shared UI Kit promotion candidates
 *    - Checks Storybook story coverage for shared components
 *    - Recommends target shared locations (e.g. `components/ui/`, `settings/`)
 *
 * Usage:
 *   pnpm tsx scripts/find-unused-components.ts
 *   pnpm tsx scripts/find-unused-components.ts --strict
 *   pnpm tsx scripts/find-unused-components.ts --json
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const CURATA_ROOT = path.resolve(__dirname, "..");
const CURATA_APP_ROOT = path.resolve(CURATA_ROOT, "../curata-app");
const REPORT_FILE = path.join(CURATA_ROOT, "scripts/unused-components-report.txt");

interface ComponentDecl {
  id: string; // "filePath:exportName"
  filePath: string;
  relPath: string;
  repo: "curata" | "curata-app";
  exportName: string;
  isDefault: boolean;
  line: number;
  isEntryPoint: boolean;
  isKazamGenerated: boolean;
}

interface ImportRef {
  sourceFile: string;
  relSourceFile: string;
  targetModule: string;
  resolvedTargetFile: string | null;
  importedName: string; // "default", named identifier, or "*"
  isTypeOnly: boolean;
  line: number;
  isStory: boolean;
}

interface ReExportRef {
  sourceFile: string;
  targetModule: string;
  resolvedTargetFile: string | null;
  exportedName: string;
  importedName: string; // "default", "*", or named
  line: number;
}

interface JsxUsage {
  sourceFile: string;
  relSourceFile: string;
  tagName: string;
  line: number;
  isStory: boolean;
}

interface ParsedFile {
  filePath: string;
  relPath: string;
  repo: "curata" | "curata-app";
  isStory: boolean;
  isEntryPoint: boolean;
  components: ComponentDecl[];
  imports: ImportRef[];
  reExports: ReExportRef[];
  jsxUsages: JsxUsage[];
}

// ---------------------------------------------------------------------------
// File Scanner
// ---------------------------------------------------------------------------

function collectTsFiles(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".build" ||
        entry.name === ".git" ||
        entry.name === "demos"
      ) {
        continue;
      }
      collectTsFiles(full, out);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
}

function getRelativeDisplay(filePath: string): string {
  if (filePath.startsWith(CURATA_ROOT)) {
    return "curata/" + path.relative(CURATA_ROOT, filePath);
  }
  if (filePath.startsWith(CURATA_APP_ROOT)) {
    return "curata-app/" + path.relative(CURATA_APP_ROOT, filePath);
  }
  return filePath;
}

function isStoryFile(filePath: string): boolean {
  return (
    filePath.includes(".stories.") ||
    filePath.includes(".story.") ||
    filePath.includes("/stories/")
  );
}

function isNextJsEntryPoint(filePath: string): boolean {
  const base = path.basename(filePath);
  const isAppRouter =
    filePath.includes("/src/app/") || filePath.includes("/extensions/src/app/");
  if (!isAppRouter) return false;

  const entryNames = new Set([
    "page.tsx",
    "page.jsx",
    "page.ts",
    "page.js",
    "layout.tsx",
    "layout.jsx",
    "loading.tsx",
    "error.tsx",
    "global-error.tsx",
    "not-found.tsx",
    "template.tsx",
    "route.ts",
    "route.tsx",
    "robots.ts",
    "sitemap.ts",
    "middleware.ts",
  ]);
  return entryNames.has(base);
}

function shouldScanForComponentDeclarations(filePath: string): boolean {
  if (isStoryFile(filePath)) return false;
  if (filePath.includes("/generated/prisma/")) return false;
  if (filePath.includes("/src/lib/") || filePath.includes("/extensions/src/lib/")) return false;
  if (filePath.includes("/src/hooks/")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Module Path Resolution (Overlay-aware)
// ---------------------------------------------------------------------------

function resolveModuleSpecifier(
  specifier: string,
  containingFile: string,
  allFilesSet: Set<string>,
): string | null {
  const tryFile = (candidate: string): string | null => {
    const extensions = [
      "",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      "/index.tsx",
      "/index.ts",
      "/index.jsx",
      "/index.js",
    ];
    for (const ext of extensions) {
      const p = candidate + ext;
      if (allFilesSet.has(p)) return p;
    }
    return null;
  };

  // 1. Relative imports
  if (specifier.startsWith(".")) {
    const fromDir = path.dirname(containingFile);
    const resolved = path.resolve(fromDir, specifier);
    return tryFile(resolved);
  }

  // 2. Alias imports `@/...`
  if (specifier.startsWith("@/")) {
    const subPath = specifier.slice(2);

    // Overlay resolution order:
    if (containingFile.startsWith(CURATA_APP_ROOT)) {
      const appTarget = path.join(CURATA_APP_ROOT, "extensions/src", subPath);
      const foundApp = tryFile(appTarget);
      if (foundApp) return foundApp;
    }

    const curataTarget = path.join(CURATA_ROOT, "src", subPath);
    const foundCurata = tryFile(curataTarget);
    if (foundCurata) return foundCurata;

    const appTargetFallback = path.join(CURATA_APP_ROOT, "extensions/src", subPath);
    const foundAppFallback = tryFile(appTargetFallback);
    if (foundAppFallback) return foundAppFallback;
  }

  return null;
}

// ---------------------------------------------------------------------------
// AST Traversal & Extraction
// ---------------------------------------------------------------------------

function isReactComponentName(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*$/.test(name);
}

function parseSourceFile(filePath: string, allFilesSet: Set<string>): ParsedFile {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const relPath = getRelativeDisplay(filePath);
  const repo: "curata" | "curata-app" = filePath.startsWith(CURATA_APP_ROOT)
    ? "curata-app"
    : "curata";
  const isEntry = isNextJsEntryPoint(filePath);
  const isKazam = filePath.includes("/generated/kazam");
  const isStory = isStoryFile(filePath);
  const scanDecls = shouldScanForComponentDeclarations(filePath);

  const components: ComponentDecl[] = [];
  const imports: ImportRef[] = [];
  const reExports: ReExportRef[] = [];
  const jsxUsages: JsxUsage[] = [];

  const getLine = (node: ts.Node) => {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  };

  const addComponent = (name: string, isDefault: boolean, node: ts.Node) => {
    if (!scanDecls) return;

    if (
      isReactComponentName(name) ||
      (isDefault && (filePath.includes("/components/") || isEntry))
    ) {
      components.push({
        id: `${filePath}:${name}`,
        filePath,
        relPath,
        repo,
        exportName: name,
        isDefault,
        line: getLine(node),
        isEntryPoint: isEntry,
        isKazamGenerated: isKazam,
      });
    }
  };

  const visit = (node: ts.Node) => {
    // 1. Function Declarations
    if (ts.isFunctionDeclaration(node)) {
      const isExported =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isDefault =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      if (isExported) {
        const name = node.name?.getText(sourceFile) || (isDefault ? "default" : "");
        if (name) addComponent(name, isDefault, node);
      }
    }

    // 2. Variable Statements
    if (ts.isVariableStatement(node)) {
      const isExported =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.getText(sourceFile);
            addComponent(name, false, decl);
          }
        }
      }
    }

    // 3. Export Assignments
    if (ts.isExportAssignment(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.getText(sourceFile)
        : "default";
      addComponent(name, true, node);
    }

    // 4. Export Declarations
    if (ts.isExportDeclaration(node)) {
      const isExportTypeOnly = node.isTypeOnly ?? false;
      if (!isExportTypeOnly) {
        const moduleSpecifier = node.moduleSpecifier
          ? (node.moduleSpecifier as ts.StringLiteral).text
          : null;

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            if (element.isTypeOnly) continue;
            const exportedName = element.name.getText(sourceFile);
            const propertyName = element.propertyName
              ? element.propertyName.getText(sourceFile)
              : exportedName;

            if (moduleSpecifier) {
              const resolved = resolveModuleSpecifier(
                moduleSpecifier,
                filePath,
                allFilesSet,
              );
              reExports.push({
                sourceFile: filePath,
                targetModule: moduleSpecifier,
                resolvedTargetFile: resolved,
                exportedName,
                importedName: propertyName,
                line: getLine(element),
              });
            } else {
              addComponent(exportedName, exportedName === "default", element);
            }
          }
        } else if (moduleSpecifier && !node.exportClause) {
          const resolved = resolveModuleSpecifier(
            moduleSpecifier,
            filePath,
            allFilesSet,
          );
          reExports.push({
            sourceFile: filePath,
            targetModule: moduleSpecifier,
            resolvedTargetFile: resolved,
            exportedName: "*",
            importedName: "*",
            line: getLine(node),
          });
        }
      }
    }

    // 5. Import Declarations
    if (ts.isImportDeclaration(node)) {
      const isTypeOnly = node.importClause?.isTypeOnly ?? false;
      const targetModule = (node.moduleSpecifier as ts.StringLiteral).text;
      const resolved = resolveModuleSpecifier(targetModule, filePath, allFilesSet);

      if (node.importClause && !isTypeOnly) {
        if (node.importClause.name) {
          imports.push({
            sourceFile: filePath,
            relSourceFile: relPath,
            targetModule,
            resolvedTargetFile: resolved,
            importedName: "default",
            isTypeOnly: false,
            line: getLine(node.importClause.name),
            isStory,
          });
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            imports.push({
              sourceFile: filePath,
              relSourceFile: relPath,
              targetModule,
              resolvedTargetFile: resolved,
              importedName: "*",
              isTypeOnly: false,
              line: getLine(node.importClause.namedBindings),
              isStory,
            });
          } else if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
              if (element.isTypeOnly) continue;
              const importedSymbol = element.propertyName
                ? element.propertyName.getText(sourceFile)
                : element.name.getText(sourceFile);

              imports.push({
                sourceFile: filePath,
                relSourceFile: relPath,
                targetModule,
                resolvedTargetFile: resolved,
                importedName: importedSymbol,
                isTypeOnly: false,
                line: getLine(element),
                isStory,
              });
            }
          }
        }
      }
    }

    // 6. Dynamic Import Calls
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const targetModule = node.arguments[0].text;
      const resolved = resolveModuleSpecifier(targetModule, filePath, allFilesSet);
      imports.push({
        sourceFile: filePath,
        relSourceFile: relPath,
        targetModule,
        resolvedTargetFile: resolved,
        importedName: "*",
        isTypeOnly: false,
        line: getLine(node),
        isStory,
      });
    }

    // 7. Storybook `component: ComponentName`
    if (
      isStory &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === "component" &&
      ts.isIdentifier(node.initializer)
    ) {
      jsxUsages.push({
        sourceFile: filePath,
        relSourceFile: relPath,
        tagName: node.initializer.getText(sourceFile),
        line: getLine(node),
        isStory: true,
      });
    }

    // 8. JSX Elements
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const baseTag = tagName.includes(".") ? tagName.split(".").pop()! : tagName;
      if (isReactComponentName(baseTag)) {
        jsxUsages.push({
          sourceFile: filePath,
          relSourceFile: relPath,
          tagName: baseTag,
          line: getLine(node),
          isStory,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { filePath, relPath, repo, isStory, isEntryPoint: isEntry, components, imports, reExports, jsxUsages };
}

// ---------------------------------------------------------------------------
// Reachability & Graph Analysis
// ---------------------------------------------------------------------------

interface ConsumerInfo {
  file: string;
  relFile: string;
  line: number;
  isStory: boolean;
  via: "direct-import" | "re-export" | "jsx";
}

interface ComponentAnalysis {
  decl: ComponentDecl;
  status: "used" | "entry-point" | "story-only" | "unused";
  isTransitivelyDead: boolean;
  deadParentFile?: string;
  appConsumers: ConsumerInfo[];
  liveAppConsumers: ConsumerInfo[];
  storyConsumers: ConsumerInfo[];
  allConsumers: ConsumerInfo[];
  domains: Set<string>;
  isSharedKit: boolean;
  shouldPromoteToShared: boolean;
  promotionReasons: string[];
  hasStorybook: boolean;
  suggestedDirectory?: string;
}

function extractDomain(relPath: string): string {
  if (relPath.includes("/app/(app)/settings") || relPath.includes("/components/settings")) return "settings";
  if (relPath.includes("/app/(app)/dashboard") || relPath.includes("/components/dashboard")) return "dashboard";
  if (relPath.includes("/app/(app)/pages") || relPath.includes("/components/page-")) return "page-viewer";
  if (relPath.includes("/app/(app)/cleanup")) return "cleanup";
  if (relPath.includes("/app/(app)/review")) return "review";
  if (relPath.includes("curata-app/extensions/src/app/marketing") || relPath.includes("marketing")) return "marketing";
  if (relPath.includes("curata-app/extensions/src/app/billing") || relPath.includes("billing")) return "billing";
  if (relPath.includes("curata-app/extensions/src/app/docs") || relPath.includes("docs")) return "docs";
  if (relPath.includes("curata-app/extensions/src/app/playground") || relPath.includes("playground")) return "playground";
  if (relPath.includes("curata-app/extensions")) return "curata-app-extension";
  if (relPath.includes("/components/sidebar")) return "sidebar";
  if (relPath.includes("/components/command-palette")) return "command-palette";
  return "general";
}

function analyzeGraph(parsedFiles: ParsedFile[]): {
  analyses: ComponentAnalysis[];
  allComponents: ComponentDecl[];
} {
  const fileByPath = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    fileByPath.set(pf.filePath, pf);
  }

  // Export symbol maps
  const exportsByFile = new Map<string, Map<string, ComponentDecl>>();

  for (const pf of parsedFiles) {
    const map = new Map<string, ComponentDecl>();
    for (const c of pf.components) {
      map.set(c.exportName, c);
      if (c.isDefault) map.set("default", c);
    }
    exportsByFile.set(pf.filePath, map);
  }

  // Resolve re-exports (barrel files like settings/index.ts)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const pf of parsedFiles) {
      const currentMap = exportsByFile.get(pf.filePath)!;
      for (const re of pf.reExports) {
        if (!re.resolvedTargetFile) continue;
        const targetMap = exportsByFile.get(re.resolvedTargetFile);
        if (!targetMap) continue;

        if (re.exportedName === "*") {
          for (const [sym, decl] of targetMap.entries()) {
            if (!currentMap.has(sym)) {
              currentMap.set(sym, decl);
              changed = true;
            }
          }
        } else {
          const targetDecl = targetMap.get(re.importedName);
          if (targetDecl && !currentMap.has(re.exportedName)) {
            currentMap.set(re.exportedName, targetDecl);
            changed = true;
          }
        }
      }
    }
  }

  // Record all raw consumers
  const consumersByDecl = new Map<string, ConsumerInfo[]>();
  const declById = new Map<string, ComponentDecl>();

  const recordConsumer = (decl: ComponentDecl, consumer: ConsumerInfo) => {
    if (decl.filePath === consumer.file) return;
    let list = consumersByDecl.get(decl.id);
    if (!list) {
      list = [];
      consumersByDecl.set(decl.id, list);
    }
    if (!list.some((c) => c.file === consumer.file)) {
      list.push(consumer);
    }
  };

  for (const pf of parsedFiles) {
    for (const c of pf.components) declById.set(c.id, c);

    for (const imp of pf.imports) {
      if (imp.isTypeOnly || !imp.resolvedTargetFile) continue;
      const targetMap = exportsByFile.get(imp.resolvedTargetFile);
      if (!targetMap) continue;

      if (imp.importedName === "*") {
        for (const decl of targetMap.values()) {
          recordConsumer(decl, {
            file: pf.filePath,
            relFile: pf.relPath,
            line: imp.line,
            isStory: imp.isStory,
            via: "direct-import",
          });
        }
      } else {
        const decl = targetMap.get(imp.importedName);
        if (decl) {
          recordConsumer(decl, {
            file: pf.filePath,
            relFile: pf.relPath,
            line: imp.line,
            isStory: imp.isStory,
            via: "direct-import",
          });
        }
      }
    }

    for (const jsx of pf.jsxUsages) {
      const targetMap = exportsByFile.get(pf.filePath);
      const decl = targetMap?.get(jsx.tagName);
      if (decl && decl.filePath !== pf.filePath) {
        recordConsumer(decl, {
          file: pf.filePath,
          relFile: pf.relPath,
          line: jsx.line,
          isStory: jsx.isStory,
          via: "jsx",
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reachability Analysis from App Entrypoints & Stories
  // -------------------------------------------------------------------------
  const liveAppFiles = new Set<string>();
  const liveStoryFiles = new Set<string>();

  // Initialize entrypoints
  for (const pf of parsedFiles) {
    if (pf.isEntryPoint) {
      liveAppFiles.add(pf.filePath);
    }
    if (pf.isStory) {
      liveStoryFiles.add(pf.filePath);
    }
  }

  // Propagate app reachability downward
  let appReachableChanged = true;
  while (appReachableChanged) {
    appReachableChanged = false;
    for (const pf of parsedFiles) {
      if (!liveAppFiles.has(pf.filePath)) continue;

      // All files imported by this live file become live
      for (const imp of pf.imports) {
        if (!imp.resolvedTargetFile || imp.isTypeOnly) continue;
        if (!liveAppFiles.has(imp.resolvedTargetFile)) {
          liveAppFiles.add(imp.resolvedTargetFile);
          appReachableChanged = true;
        }
      }

      // All files re-exported by this live file become live
      for (const re of pf.reExports) {
        if (!re.resolvedTargetFile) continue;
        if (!liveAppFiles.has(re.resolvedTargetFile)) {
          liveAppFiles.add(re.resolvedTargetFile);
          appReachableChanged = true;
        }
      }
    }
  }

  // Propagate story reachability downward
  let storyReachableChanged = true;
  while (storyReachableChanged) {
    storyReachableChanged = false;
    for (const pf of parsedFiles) {
      if (!liveStoryFiles.has(pf.filePath)) continue;

      for (const imp of pf.imports) {
        if (!imp.resolvedTargetFile || imp.isTypeOnly) continue;
        if (!liveStoryFiles.has(imp.resolvedTargetFile)) {
          liveStoryFiles.add(imp.resolvedTargetFile);
          storyReachableChanged = true;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Assemble Analyses
  // -------------------------------------------------------------------------
  const allComponents: ComponentDecl[] = [];
  for (const pf of parsedFiles) {
    allComponents.push(...pf.components);
  }

  const analyses: ComponentAnalysis[] = [];

  for (const decl of allComponents) {
    const rawConsumers = consumersByDecl.get(decl.id) || [];
    const appConsumers = rawConsumers.filter((c) => !c.isStory);
    const liveAppConsumers = appConsumers.filter((c) => liveAppFiles.has(c.file));
    const storyConsumers = rawConsumers.filter((c) => c.isStory);

    const isReachableApp = liveAppFiles.has(decl.filePath);
    const isReachableStory = liveStoryFiles.has(decl.filePath);

    let status: "used" | "entry-point" | "story-only" | "unused" = "unused";
    let isTransitivelyDead = false;
    let deadParentFile: string | undefined = undefined;

    if (decl.isEntryPoint) {
      status = "entry-point";
    } else if (isReachableApp && liveAppConsumers.length > 0) {
      status = "used";
    } else if (!isReachableApp && appConsumers.length > 0) {
      // It was imported, but only by dead files!
      status = "unused";
      isTransitivelyDead = true;
      deadParentFile = appConsumers[0].relFile;
    } else if (isReachableStory || storyConsumers.length > 0) {
      status = "story-only";
    } else {
      status = "unused";
    }

    const domains = new Set<string>();
    for (const c of liveAppConsumers) {
      domains.add(extractDomain(c.relFile));
    }

    const isSharedKit =
      decl.relPath.includes("/components/settings/") ||
      decl.relPath.includes("/components/ui/") ||
      decl.relPath.includes("/components/shared/");

    const promotionReasons: string[] = [];
    let shouldPromoteToShared = false;
    let suggestedDirectory: string | undefined = undefined;

    if (status === "used" && !isSharedKit && !decl.isEntryPoint && !decl.isKazamGenerated) {
      const hasCrossRepoConsumer = liveAppConsumers.some((c) =>
        decl.repo === "curata"
          ? c.relFile.startsWith("curata-app/")
          : c.relFile.startsWith("curata/"),
      );

      if (liveAppConsumers.length >= 3) {
        promotionReasons.push(`High consumer fan-in (${liveAppConsumers.length} consumers)`);
      }
      if (domains.size >= 2) {
        promotionReasons.push(`Cross-domain usage across ${domains.size} feature areas: [${Array.from(domains).join(", ")}]`);
      }
      if (hasCrossRepoConsumer) {
        promotionReasons.push(`Cross-repo consumption between OSS curata and hosted curata-app`);
      }

      if (promotionReasons.length > 0) {
        shouldPromoteToShared = true;
        if (domains.has("settings") && domains.size === 1) {
          suggestedDirectory = "src/components/settings/";
        } else {
          suggestedDirectory = "src/components/ui/ (or shared/)";
        }
      }
    }

    const hasStorybook = storyConsumers.length > 0 || isStoryFile(decl.filePath);

    analyses.push({
      decl,
      status,
      isTransitivelyDead,
      deadParentFile,
      appConsumers,
      liveAppConsumers,
      storyConsumers,
      allConsumers: rawConsumers,
      domains,
      isSharedKit,
      shouldPromoteToShared,
      promotionReasons,
      hasStorybook,
      suggestedDirectory,
    });
  }

  return { analyses, allComponents };
}

// ---------------------------------------------------------------------------
// Main & Report Generation
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const isStrict = args.includes("--strict");
  const isJson = args.includes("--json");

  const tsFiles: string[] = [];
  collectTsFiles(path.join(CURATA_ROOT, "src"), tsFiles);
  if (fs.existsSync(CURATA_APP_ROOT)) {
    collectTsFiles(path.join(CURATA_APP_ROOT, "extensions/src"), tsFiles);
  }

  const allFilesSet = new Set(tsFiles);
  const parsedFiles = tsFiles.map((f) => parseSourceFile(f, allFilesSet));
  const { analyses, allComponents } = analyzeGraph(parsedFiles);

  const unusedList = analyses.filter((a) => a.status === "unused" && !a.decl.isKazamGenerated);
  const storyOnlyList = analyses.filter((a) => a.status === "story-only");
  const entryPointList = analyses.filter((a) => a.status === "entry-point");
  const usedList = analyses.filter((a) => a.status === "used" && !a.decl.isKazamGenerated);
  const kazamList = analyses.filter((a) => a.decl.isKazamGenerated);
  const promotionCandidates = analyses.filter((a) => a.shouldPromoteToShared);
  const singleConsumerList = usedList.filter((a) => a.liveAppConsumers.length === 1);

  if (isJson) {
    const jsonOutput = {
      summary: {
        totalComponents: allComponents.length,
        used: usedList.length,
        entryPoints: entryPointList.length,
        storyOnly: storyOnlyList.length,
        unused: unusedList.length,
        kazamGenerated: kazamList.length,
        sharedPromotionCandidates: promotionCandidates.length,
      },
      unused: unusedList.map((a) => ({
        name: a.decl.exportName,
        file: a.decl.relPath,
        line: a.decl.line,
        isTransitive: a.isTransitivelyDead,
        deadParent: a.deadParentFile,
      })),
      storyOnly: storyOnlyList.map((a) => ({
        name: a.decl.exportName,
        file: a.decl.relPath,
        line: a.decl.line,
        stories: a.storyConsumers.map((s) => s.relFile),
      })),
      promotionCandidates: promotionCandidates.map((a) => ({
        name: a.decl.exportName,
        file: a.decl.relPath,
        fanIn: a.liveAppConsumers.length,
        reasons: a.promotionReasons,
        suggestedDir: a.suggestedDirectory,
        consumers: a.liveAppConsumers.map((c) => c.relFile),
        hasStorybook: a.hasStorybook,
      })),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    if (isStrict && unusedList.length > 0) process.exit(1);
    return;
  }

  // Format Report
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push("                   DEAD CODE & SHARED COMPONENT REPORT                        ");
  lines.push("===============================================================================");
  lines.push(`Scanned ${tsFiles.length} TypeScript / React files across curata & curata-app.`);
  lines.push(`Total exported components discovered: ${allComponents.length}`);
  lines.push("");

  // 1. Unused / Dead
  lines.push(`── 1. Dead / Unused Components (${unusedList.length}) ──────────────────────────────────────`);
  lines.push("Components with 0 live application consumers. Safe cleanup candidates:");
  lines.push("");
  if (unusedList.length === 0) {
    lines.push("  ✓ No dead components found.");
  } else {
    for (const item of unusedList) {
      if (item.isTransitivelyDead) {
        lines.push(
          `  ✗ ${item.decl.exportName.padEnd(28)} ${item.decl.relPath}:${item.decl.line}  [Transitive: only imported by dead ${item.deadParentFile}]`,
        );
      } else {
        lines.push(
          `  ✗ ${item.decl.exportName.padEnd(28)} ${item.decl.relPath}:${item.decl.line}`,
        );
      }
    }
  }
  lines.push("");

  // 2. Story-Only
  lines.push(`── 2. Story-Only Components (${storyOnlyList.length}) ─────────────────────────────────────`);
  lines.push("Components referenced in Storybook (*.stories.tsx) but with 0 application consumers:");
  lines.push("");
  if (storyOnlyList.length === 0) {
    lines.push("  ✓ None.");
  } else {
    for (const item of storyOnlyList) {
      lines.push(
        `  ◈ ${item.decl.exportName.padEnd(28)} ${item.decl.relPath}:${item.decl.line}`,
      );
      lines.push(
        `    Stories: ${item.storyConsumers.map((s) => s.relFile).join(", ")}`,
      );
    }
  }
  lines.push("");

  // 3. Promotion to Shared Kit
  lines.push(`── 3. Shared Component Promotion Candidates (${promotionCandidates.length}) ───────────────`);
  lines.push("Components in root `components/` with high fan-in (≥3), cross-domain, or cross-repo usage.");
  lines.push("Recommendation: Promote to a shared UI kit folder (e.g. `components/ui/` or `settings/`)");
  lines.push("and ensure Storybook story exists:");
  lines.push("");
  if (promotionCandidates.length === 0) {
    lines.push("  ✓ All shared components are already organized in shared kits.");
  } else {
    for (const item of promotionCandidates) {
      const storyBadge = item.hasStorybook ? "[Storybook: ✓]" : "[Storybook: MISSING]";
      lines.push(`  ★ ${item.decl.exportName} (${item.decl.relPath}:${item.decl.line}) ${storyBadge}`);
      lines.push(`    Fan-in: ${item.liveAppConsumers.length} live consumers`);
      if (item.suggestedDirectory) {
        lines.push(`    Suggested Target: ${item.suggestedDirectory}`);
      }
      for (const reason of item.promotionReasons) {
        lines.push(`    - ${reason}`);
      }
      lines.push(`    Live Consumers:`);
      for (const c of item.liveAppConsumers) {
        lines.push(`      • ${c.relFile}:${c.line}`);
      }
      lines.push("");
    }
  }

  // 4. Single-Consumer Components
  lines.push(`── 4. Feature-Private / Single-Consumer Components (${singleConsumerList.length}) ────────────`);
  lines.push("Components used by exactly one parent file (potential co-location candidates):");
  lines.push("");
  for (const item of singleConsumerList) {
    lines.push(
      `  • ${item.decl.exportName.padEnd(28)} ${item.decl.relPath}:${item.decl.line} -> used in ${item.liveAppConsumers[0].relFile}`,
    );
  }
  lines.push("");

  // 5. Summary
  lines.push("── Summary ────────────────────────────────────────────────────────────────────");
  lines.push(`  Total Components Scanned:               ${allComponents.length}`);
  lines.push(`  Used in Application:                    ${usedList.length}`);
  lines.push(`  Next.js Route Entrypoints:              ${entryPointList.length}`);
  lines.push(`  Kazam Generated Renderers:              ${kazamList.length}`);
  lines.push(`  Story-Only (Catalog):                   ${storyOnlyList.length}`);
  lines.push(`  Dead / Unused:                          ${unusedList.length}`);
  lines.push(`  Candidates for Shared Kit Promotion:   ${promotionCandidates.length}`);
  lines.push(`  Single-Consumer Components:             ${singleConsumerList.length}`);
  lines.push("===============================================================================");

  const report = lines.join("\n") + "\n";
  fs.writeFileSync(REPORT_FILE, report);
  console.log(report);
  console.log(`Report written to ${path.relative(CURATA_ROOT, REPORT_FILE)}`);

  if (isStrict && unusedList.length > 0) {
    process.exit(1);
  }
}

main();
