import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";
import { query } from "../lib/db.js";
import {
  cloneOrFetchRepo,
  ensureWorkdir,
  resolveDefaultBranch,
  runCommand,
} from "./git.js";
import { parseRepoUrl } from "./repoMeta.js";

type QualitySeverity = "info" | "warning" | "error";
type QualityCategory = "bug" | "security" | "code_smell" | "performance";

export type QualityFinding = {
  file_path: string;
  line_start: number;
  line_end: number | null;
  rule_id: string;
  severity: QualitySeverity;
  category: QualityCategory;
  message: string;
  language?: string | null;
};

type QualityRunStats = {
  filesAnalyzed: number;
  linesAnalyzed: number;
  languagesAnalyzed: string[];
};

const EXCLUDED_DIRS = new Set([
  // Package managers & dependencies
  "node_modules",
  "vendor",
  "bower_components",
  "jspm_packages",
  ".pnpm",
  ".yarn",
  ".npm",
  "packages",
  // Python
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "site-packages",
  ".eggs",
  "egg-info",
  // Build outputs
  "dist",
  "build",
  "out",
  "output",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".netlify",
  ".serverless",
  // Compiled/generated
  "target",
  "bin",
  "obj",
  "lib",
  "libs",
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".swc",
  // Version control
  ".git",
  ".svn",
  ".hg",
  // IDE/Editor
  ".idea",
  ".vscode",
  ".vs",
  // Coverage & testing
  "coverage",
  ".nyc_output",
  "__snapshots__",
  // Documentation
  "docs",
  "doc",
  "documentation",
  // Misc generated
  ".docusaurus",
  ".storybook",
  "storybook-static",
  ".expo",
  ".gradle",
  ".maven",
  // Temporary
  "tmp",
  "temp",
  ".temp",
  ".tmp",
]);
const EXCLUDED_PATHS = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/spec/",
  "/specs/",
  "/__mocks__/",
  "/mocks/",
  "/fixtures/",
  "/__fixtures__/",
  "/e2e/",
  "/cypress/",
  "/playwright/",
  "/.storybook/",
  "/stories/",
  "/__stories__/",
  "/examples/",
  "/demo/",
  "/demos/",
  "/benchmark/",
  "/benchmarks/",
];
const EXCLUDED_FILE_MATCHERS = [
  // Test files
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /_test\.[jt]sx?$/i,
  /\.e2e\.[jt]sx?$/i,
  /\.integration\.[jt]sx?$/i,
  // Type definitions
  /\.d\.ts$/i,
  /\.d\.tsx$/i,
  // Minified/bundled
  /\.min\.[jt]s$/i,
  /\.bundle\.[jt]s$/i,
  /\.chunk\.[jt]s$/i,
  /-bundle\.[jt]s$/i,
  // Generated/config
  /\.generated\.[jt]sx?$/i,
  /\.config\.[jt]s$/i,
  /\.conf\.[jt]s$/i,
  /rc\.[jt]s$/i,
  // Lock files & package files (skip these)
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /bun\.lockb$/i,
  /package\.json$/i,
  /tsconfig.*\.json$/i,
  // Stories
  /\.stories?\.[jt]sx?$/i,
  // Mocks
  /\.mock\.[jt]sx?$/i,
  /__mocks?__/i,
];

const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const LARGE_FILE_LINES = 600;
const LARGE_FUNCTION_LINES = 80;
const MAX_FILE_BYTES = 100_000; // 100KB max per file
const MAX_FILES_TO_ANALYZE = 500; // Safety limit
const TODO_REGEX = /\b(TODO|FIXME|HACK)\b/i;

function resolveWorkdir(): string {
  return process.env.WORKDIR || "./.data";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function getLanguageForExtension(ext: string): string {
  if (ext === ".ts" || ext === ".tsx") {
    return "typescript";
  }
  return "javascript";
}

function shouldSkipPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  for (const segment of normalized.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIRS.has(segment)) {
      return true;
    }
  }
  for (const marker of EXCLUDED_PATHS) {
    if (normalized.includes(marker)) {
      return true;
    }
  }
  for (const matcher of EXCLUDED_FILE_MATCHERS) {
    if (matcher.test(normalized)) {
      return true;
    }
  }
  return false;
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.relative(root, entryPath);

      if (shouldSkipPath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        continue;
      }

      files.push(entryPath);
    }
  }

  return files;
}

function scriptKindForExtension(ext: string): ts.ScriptKind {
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function getLineInfo(source: ts.SourceFile, position: number) {
  const { line } = source.getLineAndCharacterOfPosition(position);
  return line + 1;
}

function buildFinding(
  filePath: string,
  lineStart: number,
  lineEnd: number | null,
  ruleId: string,
  severity: QualitySeverity,
  category: QualityCategory,
  message: string,
  language: string,
): QualityFinding {
  return {
    file_path: filePath,
    line_start: lineStart,
    line_end: lineEnd,
    rule_id: ruleId,
    severity,
    category,
    message,
    language,
  };
}

function analyzeSource(
  relativePath: string,
  content: string,
  language: string,
): { findings: QualityFinding[]; lines: number } {
  const findings: QualityFinding[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    if (TODO_REGEX.test(lineText)) {
      findings.push(
        buildFinding(
          relativePath,
          index + 1,
          index + 1,
          "todo-fixme",
          "info",
          "code_smell",
          "TODO/FIXME markers present.",
          language,
        ),
      );
    }
  });

  if (lines.length >= LARGE_FILE_LINES) {
    findings.push(
      buildFinding(
        relativePath,
        1,
        lines.length,
        "large-file",
        "warning",
        "code_smell",
        "File exceeds recommended line count.",
        language,
      ),
    );
  }

  const ext = path.extname(relativePath).toLowerCase();
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForExtension(ext),
  );

  const visit = (node: ts.Node, loopDepth: number) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const startLine = getLineInfo(sourceFile, node.getStart(sourceFile));
      const endLine = getLineInfo(sourceFile, node.end);
      if (endLine - startLine + 1 >= LARGE_FUNCTION_LINES) {
        findings.push(
          buildFinding(
            relativePath,
            startLine,
            endLine,
            "large-function",
            "warning",
            "code_smell",
            "Function exceeds recommended length.",
            language,
          ),
        );
      }
    }

    if (ts.isDebuggerStatement(node)) {
      const line = getLineInfo(sourceFile, node.getStart(sourceFile));
      findings.push(
        buildFinding(
          relativePath,
          line,
          line,
          "no-debugger",
          "warning",
          "code_smell",
          "Debugger statement left in code.",
          language,
        ),
      );
    }

    if (ts.isThrowStatement(node) && node.expression) {
      if (ts.isStringLiteral(node.expression)) {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "throw-string",
            "warning",
            "bug",
            "Throwing raw strings reduces stack trace context.",
            language,
          ),
        );
      }
    }

    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const line = getLineInfo(sourceFile, node.getStart(sourceFile));
      findings.push(
        buildFinding(
          relativePath,
          line,
          line,
          "empty-catch",
          "warning",
          "bug",
          "Empty catch blocks hide errors.",
          language,
        ),
      );
    }

    if (ts.isBinaryExpression(node)) {
      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "no-loose-eq",
            "warning",
            "code_smell",
            "Use strict equality operators.",
            language,
          ),
        );
      }
      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const leftIsNaN =
          ts.isIdentifier(node.left) && node.left.text === "NaN";
        const rightIsNaN =
          ts.isIdentifier(node.right) && node.right.text === "NaN";
        if (leftIsNaN || rightIsNaN) {
          const line = getLineInfo(sourceFile, node.getStart(sourceFile));
          findings.push(
            buildFinding(
              relativePath,
              line,
              line,
              "no-nan-compare",
              "error",
              "bug",
              "Comparing to NaN always returns false.",
              language,
            ),
          );
        }
      }

      if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "innerHTML"
      ) {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "no-innerhtml",
            "warning",
            "security",
            "Setting innerHTML can introduce XSS.",
            language,
          ),
        );
      }
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const line = getLineInfo(sourceFile, node.getStart(sourceFile));
      findings.push(
        buildFinding(
          relativePath,
          line,
          line,
          "no-explicit-any",
          "warning",
          "code_smell",
          "Explicit any type weakens type safety.",
          language,
        ),
      );
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "eval") {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "no-eval",
            "error",
            "security",
            "Avoid eval for security reasons.",
            language,
          ),
        );
      }

      if (ts.isPropertyAccessExpression(expression)) {
        const objectName = ts.isIdentifier(expression.expression)
          ? expression.expression.text
          : "";
        const method = expression.name.text;
        if (
          objectName === "console" &&
          ["log", "debug", "info", "warn", "error"].includes(method)
        ) {
          const line = getLineInfo(sourceFile, node.getStart(sourceFile));
          findings.push(
            buildFinding(
              relativePath,
              line,
              line,
              "no-console",
              "info",
              "code_smell",
              "Console output left in production code.",
              language,
            ),
          );
        }

        if (["exec", "execSync", "spawn", "spawnSync", "fork"].includes(method)) {
          const line = getLineInfo(sourceFile, node.getStart(sourceFile));
          findings.push(
            buildFinding(
              relativePath,
              line,
              line,
              "child-process",
              "warning",
              "security",
              "Process execution should validate inputs carefully.",
              language,
            ),
          );
        }
      }

      if (ts.isIdentifier(expression) && expression.text === "Function") {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "no-function-constructor",
            "error",
            "security",
            "Avoid Function constructor for security reasons.",
            language,
          ),
        );
      }
    }

    if (
      ts.isForStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
    ) {
      if (loopDepth >= 1) {
        const line = getLineInfo(sourceFile, node.getStart(sourceFile));
        findings.push(
          buildFinding(
            relativePath,
            line,
            line,
            "nested-loop",
            "warning",
            "performance",
            "Nested loops can cause performance hotspots.",
            language,
          ),
        );
      }
      ts.forEachChild(node, (child) => visit(child, loopDepth + 1));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, loopDepth));
  };

  visit(sourceFile, 0);

  return { findings, lines: lines.length };
}

function computeQualityGrade(findings: QualityFinding[], linesAnalyzed: number) {
  const safeLines = Math.max(linesAnalyzed, 1);
  const kloc = safeLines / 1000;
  const bugCount = findings.filter((f) => f.category === "bug").length;
  const securityCount = findings.filter((f) => f.category === "security").length;
  const smellCount = findings.filter((f) => f.category === "code_smell").length;

  const bugsPer = bugCount / kloc;
  const securityPer = securityCount / kloc;
  const smellsPer = smellCount / kloc;

  if (bugsPer <= 1 && securityPer === 0 && smellsPer <= 5) return "A";
  if (bugsPer <= 3 && securityPer <= 1 && smellsPer <= 15) return "B";
  if (bugsPer <= 5 && securityPer <= 3 && smellsPer <= 30) return "C";
  if (bugsPer <= 10 && securityPer <= 5 && smellsPer <= 50) return "D";
  return "F";
}

function buildFileStats(
  findings: QualityFinding[],
  fileLines: Map<string, number>,
) {
  const stats = new Map<
    string,
    {
      file_path: string;
      language: string | null;
      lines_of_code: number | null;
      findings_count: number;
      bugs: number;
      security_issues: number;
      code_smells: number;
    }
  >();

  for (const finding of findings) {
    const entry = stats.get(finding.file_path) ?? {
      file_path: finding.file_path,
      language: finding.language ?? null,
      lines_of_code: fileLines.get(finding.file_path) ?? null,
      findings_count: 0,
      bugs: 0,
      security_issues: 0,
      code_smells: 0,
    };
    entry.findings_count += 1;
    if (finding.category === "bug") entry.bugs += 1;
    if (finding.category === "security") entry.security_issues += 1;
    if (finding.category === "code_smell") entry.code_smells += 1;
    stats.set(finding.file_path, entry);
  }

  return Array.from(stats.values());
}

async function insertQualityRun(repositoryId: string) {
  const result = await query<{ id: string }>(
    `INSERT INTO quality_runs (repository_id, status, started_at)
     VALUES ($1, 'running', now())
     RETURNING id`,
    [repositoryId],
  );
  return result.rows[0]?.id ?? "";
}

async function failQualityRun(runId: string, message: string) {
  await query(
    `UPDATE quality_runs
     SET status = 'failed', completed_at = now(), error_message = $2
     WHERE id = $1`,
    [runId, message],
  );
}

async function completeQualityRun(
  runId: string,
  stats: QualityRunStats,
  grade: string,
) {
  await query(
    `UPDATE quality_runs
     SET status = 'succeeded',
         completed_at = now(),
         files_analyzed = $2,
         lines_analyzed = $3,
         quality_grade = $4,
         error_message = NULL
     WHERE id = $1`,
    [runId, stats.filesAnalyzed, stats.linesAnalyzed, grade],
  );
}

async function insertQualityFindings(runId: string, findings: QualityFinding[]) {
  if (!findings.length) {
    return;
  }

  const values: string[] = [];
  const params: Array<string | number | null> = [];

  findings.forEach((finding, index) => {
    const base = index * 9;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
    params.push(
      runId,
      finding.file_path,
      finding.line_start,
      finding.line_end,
      finding.rule_id,
      finding.severity,
      finding.category,
      finding.message,
      finding.language ?? null,
    );
  });

  await query(
    `INSERT INTO quality_findings (
        quality_run_id,
        file_path,
        line_start,
        line_end,
        rule_id,
        severity,
        category,
        message,
        language
     )
     VALUES ${values.join(",")}`,
    params,
  );
}

async function insertQualityFileStats(
  runId: string,
  stats: ReturnType<typeof buildFileStats>,
) {
  if (!stats.length) {
    return;
  }

  const values: string[] = [];
  const params: Array<string | number | null> = [];

  stats.forEach((stat, index) => {
    const base = index * 8;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
    );
    params.push(
      runId,
      stat.file_path,
      stat.language,
      stat.lines_of_code,
      stat.findings_count,
      stat.bugs,
      stat.security_issues,
      stat.code_smells,
    );
  });

  await query(
    `INSERT INTO quality_file_stats (
        quality_run_id,
        file_path,
        language,
        lines_of_code,
        findings_count,
        bugs,
        security_issues,
        code_smells
     )
     VALUES ${values.join(",")}`,
    params,
  );
}

async function executeQualityAnalysis(
  runId: string,
  repoPath: string,
  branch?: string | null,
) {
  try {
    if (branch) {
      try {
        await runCommand("git", ["-C", repoPath, "checkout", branch]);
      } catch {
        try {
          await runCommand("git", [
            "-C",
            repoPath,
            "checkout",
            "-B",
            branch,
            `origin/${branch}`,
          ]);
        } catch {
          // keep existing checkout if branch is unavailable
        }
      }
    }

    const allFiles = await collectSourceFiles(repoPath);
    // Apply safety limit
    const files = allFiles.slice(0, MAX_FILES_TO_ANALYZE);
    if (allFiles.length > MAX_FILES_TO_ANALYZE) {
      console.log(`[Quality] Limiting analysis to ${MAX_FILES_TO_ANALYZE} of ${allFiles.length} files`);
    }
    console.log(`[Quality] Starting analysis of ${files.length} files...`);

    const findings: QualityFinding[] = [];
    const fileLines = new Map<string, number>();
    const languages = new Set<string>();
    let linesAnalyzed = 0;

    for (const filePath of files) {
      const relativePath = normalizePath(path.relative(repoPath, filePath));
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_BYTES) {
        findings.push(
          buildFinding(
            relativePath,
            1,
            null,
            "large-file-bytes",
            "warning",
            "code_smell",
            "File exceeds size threshold for analysis.",
            getLanguageForExtension(path.extname(filePath).toLowerCase()),
          ),
        );
        continue;
      }

      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        findings.push(
          buildFinding(
            relativePath,
            1,
            null,
            "file-read-failed",
            "warning",
            "code_smell",
            "File could not be read for analysis.",
            getLanguageForExtension(path.extname(filePath).toLowerCase()),
          ),
        );
        continue;
      }
      const language = getLanguageForExtension(
        path.extname(filePath).toLowerCase(),
      );
      languages.add(language);
      const { findings: fileFindings, lines } = analyzeSource(
        relativePath,
        content,
        language,
      );
      fileLines.set(relativePath, lines);
      linesAnalyzed += lines;
      findings.push(...fileFindings);
    }

    const fileStats = buildFileStats(findings, fileLines);
    await insertQualityFindings(runId, findings);
    await insertQualityFileStats(runId, fileStats);

    const grade = computeQualityGrade(findings, linesAnalyzed);
    await completeQualityRun(
      runId,
      {
        filesAnalyzed: files.length,
        linesAnalyzed,
        languagesAnalyzed: Array.from(languages),
      },
      grade,
    );

    return {
      runId,
      filesAnalyzed: files.length,
      linesAnalyzed,
      languagesAnalyzed: Array.from(languages),
      findingsCount: findings.length,
      grade,
    };
  } catch (error) {
    await failQualityRun(
      runId,
      error instanceof Error ? error.message : "Quality analysis failed.",
    );
    throw error;
  }
}

async function prepareRepository(
  repoUrl: string,
  branch?: string | null,
): Promise<{ repoPath: string; branch: string }> {
  const workdir = resolveWorkdir();
  await ensureWorkdir(workdir);
  const meta = parseRepoUrl(repoUrl);
  const repoPath = path.resolve(workdir, meta.slug);
  await cloneOrFetchRepo(repoUrl, repoPath);
  const resolvedBranch =
    branch && branch.trim()
      ? branch.trim()
      : await resolveDefaultBranch(repoPath);
  return { repoPath, branch: resolvedBranch };
}

export async function runQualityAnalysis(
  repositoryId: string,
  repoPath: string,
  branch?: string | null,
) {
  const runId = await insertQualityRun(repositoryId);
  if (!runId) {
    throw new Error("Unable to create quality run.");
  }
  return executeQualityAnalysis(runId, repoPath, branch);
}

export async function startQualityAnalysis(
  repositoryId: string,
  repoUrl: string,
  branch?: string | null,
) {
  const runId = await insertQualityRun(repositoryId);
  if (!runId) {
    throw new Error("Unable to create quality run.");
  }
  const { repoPath, branch: resolvedBranch } = await prepareRepository(
    repoUrl,
    branch,
  );
  void executeQualityAnalysis(runId, repoPath, resolvedBranch).catch(() => {
    // errors are recorded on the run
  });
  return { runId };
}
