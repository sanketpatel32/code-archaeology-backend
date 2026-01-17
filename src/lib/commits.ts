import type { CommitClassification } from "../services/classification.js";
import { query } from "./db.js";

export type CommitInsert = {
  sha: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
  classification: CommitClassification;
};

export type FileChangeInsert = {
  commitId: string;
  filePath: string;
  additions: number;
  deletions: number;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function insertCommits(
  repositoryId: string,
  commits: CommitInsert[],
): Promise<Map<string, string>> {
  if (!commits.length) {
    return new Map();
  }

  const insertChunks = chunkArray(commits, 1000);

  for (const chunk of insertChunks) {
    const values: string[] = [];
    const params: Array<string | number | null> = [];

    chunk.forEach((commit, index) => {
      const base = index * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      params.push(
        repositoryId,
        commit.sha,
        commit.authorName,
        commit.authorEmail,
        commit.committedAt,
        commit.message,
        commit.classification,
      );
    });

    await query(
      `INSERT INTO commits (repository_id, sha, author_name, author_email, committed_at, message, classification)
       VALUES ${values.join(",")}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }

  const shas = commits.map((commit) => commit.sha);
  const selectChunks = chunkArray(shas, 5000);
  const map = new Map<string, string>();

  for (const chunk of selectChunks) {
    const result = await query<{ id: string; sha: string }>(
      "SELECT id, sha FROM commits WHERE repository_id = $1 AND sha = ANY($2)",
      [repositoryId, chunk],
    );
    for (const row of result.rows) {
      map.set(row.sha, row.id);
    }
  }

  return map;
}

export async function insertFileChanges(fileChanges: FileChangeInsert[]) {
  if (!fileChanges.length) {
    return;
  }

  const chunks = chunkArray(fileChanges, 500);

  for (const chunk of chunks) {
    const values: string[] = [];
    const params: Array<string | number> = [];

    chunk.forEach((change, index) => {
      const base = index * 4;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(
        change.commitId,
        change.filePath,
        change.additions,
        change.deletions,
      );
    });

    await query(
      `INSERT INTO file_changes (commit_id, file_path, additions, deletions)
       VALUES ${values.join(",")}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }
}
