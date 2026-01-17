export type CommitClassification =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "revert"
  | "chore"
  | "unknown";

const PREFIX_MAP: Record<string, CommitClassification> = {
  feat: "feat",
  feature: "feat",
  fix: "fix",
  bugfix: "fix",
  docs: "docs",
  doc: "docs",
  style: "style",
  styles: "style",
  refactor: "refactor",
  perf: "perf",
  test: "test",
  tests: "test",
  build: "build",
  ci: "ci",
  revert: "revert",
  chore: "chore",
};

const RULES: Array<{
  label: CommitClassification;
  keywords: string[];
  match: "word" | "partial";
}> = [
  { label: "revert", keywords: ["revert"], match: "word" },
  { label: "fix", keywords: ["fix", "bug", "hotfix", "patch"], match: "word" },
  {
    label: "feat",
    keywords: ["feat", "feature", "add", "implement", "support"],
    match: "partial",
  },
  {
    label: "docs",
    keywords: ["docs", "doc", "documentation", "readme"],
    match: "partial",
  },
  {
    label: "style",
    keywords: ["style", "format", "lint", "prettier"],
    match: "partial",
  },
  {
    label: "refactor",
    keywords: ["refactor", "cleanup", "rename", "restructure"],
    match: "partial",
  },
  {
    label: "perf",
    keywords: ["perf", "performance", "optimiz"],
    match: "partial",
  },
  {
    label: "test",
    keywords: ["test", "tests", "testing", "spec"],
    match: "partial",
  },
  {
    label: "build",
    keywords: ["build", "deps", "dependency", "dependencies", "bump", "upgrade"],
    match: "partial",
  },
  {
    label: "ci",
    keywords: ["ci", "pipeline", "workflow"],
    match: "word",
  },
  {
    label: "chore",
    keywords: ["chore", "maintenance", "meta", "housekeeping"],
    match: "partial",
  },
];

const PREFIX_RE = /^(\w+)(?:\([^)]+\))?(?:!)?:/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(
  normalized: string,
  keyword: string,
  match: "word" | "partial",
) {
  if (match === "partial") {
    return normalized.includes(keyword);
  }
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(normalized);
}

export function classifyCommit(message: string): CommitClassification {
  const normalized = message.toLowerCase();
  const prefixMatch = normalized.match(PREFIX_RE);

  if (prefixMatch) {
    const mapped = PREFIX_MAP[prefixMatch[1]];
    if (mapped) {
      return mapped;
    }
  }

  for (const rule of RULES) {
    if (
      rule.keywords.some((keyword) =>
        matchesKeyword(normalized, keyword, rule.match),
      )
    ) {
      return rule.label;
    }
  }

  return "unknown";
}
