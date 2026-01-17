import { upsertContributors } from "../lib/contributors.js";
import { query } from "../lib/db.js";
import {
  type FileOwnershipInsert,
  upsertFileOwnership,
} from "../lib/ownership.js";

type OwnershipRow = {
  file_path: string;
  author_name: string | null;
  author_email: string | null;
  touches: number;
  churn: number;
};

type ContributorKey = {
  name: string;
  email: string | null;
};

function contributorKey(name: string, email: string | null): string {
  return `${name}|${email ?? ""}`;
}

export async function computeOwnership(repositoryId: string) {
  const result = await query<OwnershipRow>(
    `SELECT
        fc.file_path,
        c.author_name,
        c.author_email,
        COUNT(*)::int AS touches,
        SUM(fc.additions + fc.deletions)::int AS churn
     FROM file_changes fc
     JOIN commits c ON c.id = fc.commit_id
     WHERE c.repository_id = $1
     GROUP BY fc.file_path, c.author_name, c.author_email`,
    [repositoryId],
  );

  if (!result.rows.length) {
    return;
  }

  const contributors: ContributorKey[] = [];
  const totals = new Map<string, number>();

  for (const row of result.rows) {
    const name = row.author_name?.trim() || "Unknown";
    const email = row.author_email?.trim() || null;
    contributors.push({ name, email });
    totals.set(row.file_path, (totals.get(row.file_path) ?? 0) + row.touches);
  }

  const contributorMap = await upsertContributors(repositoryId, contributors);

  await query("DELETE FROM file_ownership WHERE repository_id = $1", [
    repositoryId,
  ]);

  const ownershipRows: FileOwnershipInsert[] = result.rows.map((row) => {
    const name = row.author_name?.trim() || "Unknown";
    const email = row.author_email?.trim() || null;
    const key = contributorKey(name, email);
    const contributorId = contributorMap.get(key);
    const totalTouches = totals.get(row.file_path) ?? 0;
    const share = totalTouches > 0 ? row.touches / totalTouches : 0;

    return {
      repositoryId,
      filePath: row.file_path,
      contributorId: contributorId ?? "",
      touches: row.touches,
      churn: row.churn,
      contributionShare: Number(share.toFixed(4)),
    };
  });

  const filteredRows = ownershipRows.filter((row) => row.contributorId);
  await upsertFileOwnership(filteredRows);
}
