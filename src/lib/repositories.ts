import { query } from "./db.js";

export async function upsertRepository(
  name: string,
  url: string,
  defaultBranch: string,
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO repositories (name, url, default_branch, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (url)
     DO UPDATE SET name = EXCLUDED.name, default_branch = EXCLUDED.default_branch, updated_at = now()
     RETURNING id`,
    [name, url, defaultBranch],
  );

  return result.rows[0]?.id ?? "";
}

export async function touchRepositoryAnalyzed(repositoryId: string) {
  if (!repositoryId) {
    return;
  }

  await query(
    "UPDATE repositories SET last_analyzed_at = now(), updated_at = now() WHERE id = $1",
    [repositoryId],
  );
}
