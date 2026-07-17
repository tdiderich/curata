import { db } from "@/lib/db";

export interface ContentRule {
  id: string;
  text: string;
  mode: "warn" | "block";
  patterns?: string[];
}

export interface ResolvedRule extends ContentRule {
  scope: string;
}

export interface RuleViolation {
  ruleId: string;
  scope: string;
  message: string;
  matches?: string[];
  suggestion?: string;
}

export interface RulesResponse {
  inherited: ResolvedRule[];
  page: ResolvedRule[];
}

export interface ValidationResult {
  warnings: RuleViolation[];
  violations: RuleViolation[];
}

function parseRules(json: unknown): ContentRule[] {
  if (!json || !Array.isArray(json)) return [];
  return json.filter(
    (r): r is ContentRule =>
      typeof r === "object" &&
      r !== null &&
      typeof r.id === "string" &&
      typeof r.text === "string"
  ).map((r) => ({
    id: r.id,
    text: r.text,
    mode: r.mode === "block" ? "block" : "warn",
    patterns: Array.isArray(r.patterns) ? r.patterns.filter((p: unknown) => typeof p === "string") : undefined,
  }));
}

function tagRules(rules: ContentRule[], scope: string): ResolvedRule[] {
  return rules.map((r) => ({ ...r, scope }));
}

export async function resolveRules(
  orgId: string,
  folderId: string | null,
  pageRulesJson: unknown
): Promise<RulesResponse> {
  const inherited: ResolvedRule[] = [];

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { rules: true },
  });
  if (org?.rules) {
    inherited.push(...tagRules(parseRules(org.rules), "global"));
  }

  if (folderId) {
    const folders = await db.folder.findMany({
      where: { orgId },
      select: { id: true, parentId: true, name: true, rules: true },
    });
    const folderMap = new Map(folders.map((f) => [f.id, f]));

    const ancestry: typeof folders = [];
    let current = folderMap.get(folderId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      ancestry.unshift(current);
      current = current.parentId ? folderMap.get(current.parentId) : undefined;
    }

    for (const folder of ancestry) {
      const folderRules = parseRules(folder.rules);
      if (folderRules.length > 0) {
        inherited.push(...tagRules(folderRules, `folder:${folder.name}`));
      }
    }
  }

  const pageRules = tagRules(parseRules(pageRulesJson), "page");

  return { inherited, page: pageRules };
}

export function validateContentRules(
  content: string,
  rules: ResolvedRule[]
): ValidationResult {
  const warnings: RuleViolation[] = [];
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    if (!rule.patterns || rule.patterns.length === 0) continue;

    const matches: string[] = [];
    for (const pattern of rule.patterns) {
      try {
        const re = new RegExp(pattern, "gi");
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
          if (!matches.includes(match[0])) {
            matches.push(match[0]);
          }
          if (!re.global) break;
        }
      } catch {
        // invalid regex pattern - skip
      }
    }

    if (matches.length === 0) continue;

    const violation: RuleViolation = {
      ruleId: rule.id,
      scope: rule.scope,
      message: rule.text,
      matches,
    };

    if (rule.mode === "block") {
      violations.push(violation);
    } else {
      warnings.push(violation);
    }
  }

  return { warnings, violations };
}

export const DEFAULT_CONTENT_RULES: ContentRule[] = [
  {
    id: "no-emdash",
    text: "Never use em dashes. Use commas, periods, colons, or hyphens instead.",
    mode: "block",
    patterns: ["—"],
  },
  {
    id: "no-latin-abbrev",
    text: "Do not use e.g. or i.e. Use 'like' or name examples directly.",
    mode: "block",
    patterns: ["\\be\\.g\\.?", "\\bi\\.e\\.?"],
  },
  {
    id: "no-ai-slop-words",
    text: "Do not use AI slop words: delve, moreover, furthermore, holistic, paradigm, synergy, transformative, commence, endeavor, a myriad of, a plethora of, spearhead, elevate, foster, empower, plays a crucial role, in the realm of, the landscape of, stands as a testament to.",
    mode: "block",
    patterns: [
      "\\bdelve[sd]?\\b", "\\bmoreover\\b", "\\bfurthermore\\b", "\\bholistic\\b",
      "\\bparadigm\\b", "\\bsynergy\\b", "\\btransformative\\b", "\\bcommence[sd]?\\b",
      "\\bendeavor[s]?\\b", "a myriad of", "a plethora of", "\\bspearhead",
      "\\belevate[sd]?\\b", "\\bfoster(s|ed|ing)?\\b", "\\bempower(s|ed|ing)?\\b",
      "plays a crucial role", "in the realm of", "the landscape of", "stands as a testament",
    ],
  },
  {
    id: "flag-ai-words",
    text: "Review usage of these words - they often signal AI voice: pivotal, innovative, cutting-edge, state-of-the-art, best-in-class, world-class, game-changer, showcase, resonate, harness.",
    mode: "warn",
    patterns: [
      "\\bpivotal\\b", "\\binnovative\\b", "\\bcutting-edge\\b", "\\bstate-of-the-art\\b",
      "\\bbest-in-class\\b", "\\bworld-class\\b", "\\bgame.changer\\b",
      "\\bshowcase[sd]?\\b", "\\bresonate[sd]?\\b", "\\bharness(es|ed|ing)?\\b",
    ],
  },
  {
    id: "no-ai-voice-patterns",
    text: "Avoid AI voice patterns: bolded lead-in lists, header inflation, bullet overuse, decorative emoji, summary sandwiches, thesis openers, grandiose scene-setting, prompt echoes, empty affirmations, assistant-speak closers, throat-clearing, rhetorical questions, transition words, hedge stacking. Use contractions.",
    mode: "warn",
  },
  {
    id: "no-qualifiers",
    text: "Cut unnecessary qualifiers: quite, rather, somewhat, arguably, essentially, basically, fundamentally.",
    mode: "warn",
    patterns: [
      "\\bquite\\b", "\\brather\\b", "\\bsomewhat\\b", "\\barguably\\b",
      "\\bessentially\\b", "\\bbasically\\b", "\\bfundamentally\\b",
    ],
  },
  {
    id: "exact-numbers",
    text: "Never round numbers when raw data exists. 51.3% stays 51.3%.",
    mode: "warn",
  },
];

export async function detectFolderCycle(
  orgId: string,
  folderId: string,
  newParentId: string | null
): Promise<boolean> {
  if (!newParentId) return false;
  if (newParentId === folderId) return true;

  const folders = await db.folder.findMany({
    where: { orgId },
    select: { id: true, parentId: true },
  });
  const folderMap = new Map(folders.map((f) => [f.id, f]));

  const visited = new Set<string>();
  let current = folderMap.get(newParentId);
  while (current) {
    if (current.id === folderId) return true;
    if (visited.has(current.id)) break;
    visited.add(current.id);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  return false;
}
