export type CommitClassification =
  | "bugfix"
  | "feature"
  | "refactor"
  | "maintenance"
  | "chore"
  | "unknown";

const RULES: Array<{ label: CommitClassification; keywords: string[] }> = [
  { label: "bugfix", keywords: ["fix", "bug", "patch", "hotfix"] },
  { label: "feature", keywords: ["add", "implement", "feature", "support"] },
  {
    label: "refactor",
    keywords: ["refactor", "cleanup", "rename", "restructure"],
  },
  {
    label: "maintenance",
    keywords: ["maintenance", "upgrade", "bump", "deps"],
  },
  { label: "chore", keywords: ["chore", "ci", "build"] },
];

export function classifyCommit(message: string): CommitClassification {
  const normalized = message.toLowerCase();

  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.label;
    }
  }

  return "unknown";
}
