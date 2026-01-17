import { query } from "./db.js";

export type FileOwnershipInsert = {
  repositoryId: string;
  filePath: string;
  contributorId: string;
  touches: number;
  churn: number;
  contributionShare: number;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function upsertFileOwnership(rows: FileOwnershipInsert[]) {
  if (!rows.length) {
    return;
  }

  const chunks = chunkArray(rows, 500);

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
        row.filePath,
        row.contributorId,
        row.touches,
        row.churn,
        row.contributionShare,
        new Date().toISOString(),
      );
    });

    await query(
      `INSERT INTO file_ownership (
          repository_id,
          file_path,
          contributor_id,
          touches,
          churn,
          contribution_share,
          updated_at
       )
       VALUES ${values.join(",")}
       ON CONFLICT (repository_id, file_path, contributor_id)
       DO UPDATE SET
          touches = EXCLUDED.touches,
          churn = EXCLUDED.churn,
          contribution_share = EXCLUDED.contribution_share,
          updated_at = EXCLUDED.updated_at`,
      params,
    );
  }
}
