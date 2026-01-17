import { query } from "../lib/db.js";

type FileMetricRow = {
  file_path: string;
  touches: number;
  churn: number;
  bugfix_touches: number;
  last_touched_at: string | null;
};

type RecentMetricRow = {
  file_path: string;
  recent_touches: number;
  recent_churn: number;
};

type FileMetricInput = {
  filePath: string;
  touches: number;
  churn: number;
  bugfixTouches: number;
  lastTouchedAt: string | null;
  recentTouches: number;
  recentChurn: number;
};

function normalize(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.min(value / max, 1);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function computeFileMetrics(
  repositoryId: string,
  recentWindowDays = 90,
) {
  const allMetrics = await query<FileMetricRow>(
    `SELECT
        fc.file_path,
        COUNT(*)::int AS touches,
        SUM(fc.additions + fc.deletions)::int AS churn,
        SUM(CASE WHEN c.classification IN ('fix', 'bugfix') THEN 1 ELSE 0 END)::int AS bugfix_touches,
        MAX(c.committed_at) AS last_touched_at
     FROM file_changes fc
     JOIN commits c ON c.id = fc.commit_id
     WHERE c.repository_id = $1
     GROUP BY fc.file_path`,
    [repositoryId],
  );

  const recentMetrics = await query<RecentMetricRow>(
    `SELECT
        fc.file_path,
        COUNT(*)::int AS recent_touches,
        SUM(fc.additions + fc.deletions)::int AS recent_churn
     FROM file_changes fc
     JOIN commits c ON c.id = fc.commit_id
     WHERE c.repository_id = $1
       AND c.committed_at >= now() - ($2 || ' days')::interval
     GROUP BY fc.file_path`,
    [repositoryId, String(recentWindowDays)],
  );

  const recentMap = new Map<string, RecentMetricRow>(
    recentMetrics.rows.map((row) => [row.file_path, row]),
  );

  const inputs: FileMetricInput[] = allMetrics.rows.map((row) => {
    const recent = recentMap.get(row.file_path);
    return {
      filePath: row.file_path,
      touches: row.touches,
      churn: row.churn,
      bugfixTouches: row.bugfix_touches,
      lastTouchedAt: row.last_touched_at,
      recentTouches: recent?.recent_touches ?? 0,
      recentChurn: recent?.recent_churn ?? 0,
    };
  });

  if (!inputs.length) {
    return;
  }

  const maxTouches = Math.max(...inputs.map((item) => item.touches));
  const maxChurn = Math.max(...inputs.map((item) => item.churn));
  const maxRecentTouches = Math.max(
    ...inputs.map((item) => item.recentTouches),
  );
  const maxRecentChurn = Math.max(...inputs.map((item) => item.recentChurn));

  const chunks = chunkArray(inputs, 400);

  for (const chunk of chunks) {
    const values: string[] = [];
    const params: Array<string | number | null> = [];

    chunk.forEach((input, index) => {
      const bugfixRatio =
        input.touches > 0 ? input.bugfixTouches / input.touches : 0;
      const hotspotScore =
        0.6 * normalize(input.touches, maxTouches) +
        0.4 * normalize(input.churn, maxChurn);
      const fragilityIndex =
        0.5 * normalize(input.recentTouches, maxRecentTouches) +
        0.3 * normalize(input.recentChurn, maxRecentChurn) +
        0.2 * bugfixRatio;

      const base = index * 9;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`,
      );
      params.push(
        repositoryId,
        input.filePath,
        input.touches,
        input.churn,
        round(hotspotScore),
        round(fragilityIndex),
        round(bugfixRatio),
        input.lastTouchedAt,
        new Date().toISOString(),
      );
    });

    await query(
      `INSERT INTO file_metrics (
          repository_id,
          file_path,
          touches,
          churn,
          hotspot_score,
          fragility_index,
          bugfix_ratio,
          last_touched_at,
          updated_at
       )
       VALUES ${values.join(",")}
       ON CONFLICT (repository_id, file_path)
       DO UPDATE SET
          touches = EXCLUDED.touches,
          churn = EXCLUDED.churn,
          hotspot_score = EXCLUDED.hotspot_score,
          fragility_index = EXCLUDED.fragility_index,
          bugfix_ratio = EXCLUDED.bugfix_ratio,
          last_touched_at = EXCLUDED.last_touched_at,
          updated_at = EXCLUDED.updated_at`,
      params,
    );
  }
}
