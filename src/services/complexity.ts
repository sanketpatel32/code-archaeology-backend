import * as ts from "typescript";
import { query } from "../lib/db.js";
import { runCommand } from "./git.js";

type CommitRow = { sha: string };

type SnapshotInsert = {
  repositoryId: string;
  commitSha: string;
  filePath: string;
  functions: number;
  conditionals: number;
  maxNesting: number;
  lines: number;
};

const SCRIPT_KIND_MAP: Record<string, ts.ScriptKind> = {
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
};

function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return SCRIPT_KIND_MAP[ext] ?? ts.ScriptKind.TS;
}

function isFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function isConditionalNode(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isSwitchStatement(node)
  );
}

function isNestingNode(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isCatchClause(node)
  );
}

function analyzeSource(source: string, filePath: string) {
  const scriptKind = getScriptKind(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  let functions = 0;
  let conditionals = 0;
  let maxNesting = 0;

  const visit = (node: ts.Node, depth: number) => {
    if (isFunctionNode(node)) {
      functions += 1;
    }
    if (isConditionalNode(node)) {
      conditionals += 1;
    }

    const nextDepth = isNestingNode(node) ? depth + 1 : depth;
    if (nextDepth > maxNesting) {
      maxNesting = nextDepth;
    }

    ts.forEachChild(node, (child) => visit(child, nextDepth));
  };

  visit(sourceFile, 0);

  const lines = source ? source.split(/\r?\n/).length : 0;

  return { functions, conditionals, maxNesting, lines };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export async function computeComplexitySnapshots(
  repositoryId: string,
  repoPath: string,
) {
  const snapshotInterval = parseNumberEnv(
    process.env.COMPLEXITY_SNAPSHOT_INTERVAL,
    50,
  );
  const maxSnapshots = parseNumberEnv(process.env.COMPLEXITY_MAX_SNAPSHOTS, 20);
  const maxFiles = parseNumberEnv(process.env.COMPLEXITY_MAX_FILES, 200);
  const maxFileBytes = parseNumberEnv(
    process.env.COMPLEXITY_MAX_FILE_BYTES,
    200000,
  );

  if (snapshotInterval <= 0 || maxSnapshots === 0) {
    return;
  }

  const commitRows = await query<CommitRow>(
    "SELECT sha FROM commits WHERE repository_id = $1 ORDER BY committed_at ASC",
    [repositoryId],
  );

  const allShas = commitRows.rows.map((row) => row.sha);
  if (!allShas.length) {
    return;
  }

  let snapshotShas: string[] = [];
  for (let i = 0; i < allShas.length; i += snapshotInterval) {
    const sha = allShas[i];
    if (sha) snapshotShas.push(sha);
  }

  const lastSha = allShas[allShas.length - 1];
  if (lastSha && !snapshotShas.includes(lastSha)) {
    snapshotShas.push(lastSha);
  }

  if (maxSnapshots > 0 && snapshotShas.length > maxSnapshots) {
    const step = Math.ceil(snapshotShas.length / maxSnapshots);
    const reduced: string[] = [];
    for (let i = 0; i < snapshotShas.length; i += step) {
      const sha = snapshotShas[i];
      if (sha) reduced.push(sha);
    }
    if (lastSha && !reduced.includes(lastSha)) {
      reduced.push(lastSha);
    }
    snapshotShas = reduced;
  }

  await query("DELETE FROM complexity_snapshots WHERE repository_id = $1", [
    repositoryId,
  ]);

  for (const sha of snapshotShas) {
    const tree = await runCommand(
      "git",
      ["-C", repoPath, "ls-tree", "-r", "--name-only", sha],
      { trimOutput: true },
    );

    const files = tree
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file) => {
        const lower = file.toLowerCase();
        if (lower.endsWith(".d.ts")) {
          return false;
        }
        return (
          lower.endsWith(".js") ||
          lower.endsWith(".jsx") ||
          lower.endsWith(".ts") ||
          lower.endsWith(".tsx")
        );
      });

    const limitedFiles =
      maxFiles > 0 ? files.slice(0, maxFiles) : files.slice();

    const inserts: SnapshotInsert[] = [];

    for (const filePath of limitedFiles) {
      let content = "";
      try {
        content = await runCommand(
          "git",
          ["-C", repoPath, "show", `${sha}:${filePath}`],
          { trimOutput: false },
        );
      } catch {
        continue;
      }

      if (!content || content.length > maxFileBytes) {
        continue;
      }

      const metrics = analyzeSource(content, filePath);
      inserts.push({
        repositoryId,
        commitSha: sha,
        filePath,
        functions: metrics.functions,
        conditionals: metrics.conditionals,
        maxNesting: metrics.maxNesting,
        lines: metrics.lines,
      });
    }

    const chunks = chunkArray(inserts, 300);
    for (const chunk of chunks) {
      const values: string[] = [];
      const params: Array<string | number> = [];

      chunk.forEach((row, index) => {
        const base = index * 7;
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
        );
        params.push(
          row.repositoryId,
          row.commitSha,
          row.filePath,
          row.functions,
          row.conditionals,
          row.maxNesting,
          row.lines,
        );
      });

      await query(
        `INSERT INTO complexity_snapshots (
            repository_id,
            commit_sha,
            file_path,
            functions,
            conditionals,
            max_nesting,
            lines
         )
         VALUES ${values.join(",")}`,
        params,
      );
    }
  }
}
