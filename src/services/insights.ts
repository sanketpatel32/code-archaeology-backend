import { query } from "../lib/db.js";
import { type InsightInput, replaceInsights } from "../lib/insights.js";

type HotspotRow = { file_path: string; hotspot_score: number };
type FragilityRow = { file_path: string; fragility_index: number };
type OwnershipRow = {
  file_path: string;
  contribution_share: number;
  contributor_name: string;
  touches: number;
};

function parseNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export async function generateInsights(
  repositoryId: string,
  analysisRunId?: string,
) {
  const maxPerCategory = parseIntEnv(process.env.INSIGHTS_MAX_PER_CATEGORY, 5);
  const hotspotThreshold = parseNumberEnv(process.env.HOTSPOT_THRESHOLD, 0.6);
  const fragilityThreshold = parseNumberEnv(
    process.env.FRAGILITY_THRESHOLD,
    0.6,
  );
  const busFactorShareThreshold = parseNumberEnv(
    process.env.BUS_FACTOR_SHARE_THRESHOLD,
    0.7,
  );
  const busFactorTouchThreshold = parseIntEnv(
    process.env.BUS_FACTOR_TOUCH_THRESHOLD,
    10,
  );

  const insights: InsightInput[] = [];

  const hotspots = await query<HotspotRow>(
    `SELECT file_path, hotspot_score::float AS hotspot_score
     FROM file_metrics
     WHERE repository_id = $1 AND hotspot_score >= $2
     ORDER BY hotspot_score DESC
     LIMIT $3`,
    [repositoryId, hotspotThreshold, maxPerCategory],
  );

  for (const row of hotspots.rows) {
    insights.push({
      category: "hotspot",
      severity: row.hotspot_score >= 0.8 ? "risk" : "warning",
      message: `Hotspot: ${row.file_path} has high churn and change frequency (score ${row.hotspot_score.toFixed(
        2,
      )}).`,
    });
  }

  const fragility = await query<FragilityRow>(
    `SELECT file_path, fragility_index::float AS fragility_index
     FROM file_metrics
     WHERE repository_id = $1 AND fragility_index >= $2
     ORDER BY fragility_index DESC
     LIMIT $3`,
    [repositoryId, fragilityThreshold, maxPerCategory],
  );

  for (const row of fragility.rows) {
    insights.push({
      category: "fragility",
      severity: row.fragility_index >= 0.8 ? "risk" : "warning",
      message: `Fragility: ${row.file_path} shows recent instability (index ${row.fragility_index.toFixed(
        2,
      )}).`,
    });
  }

  const ownershipRows = await query<OwnershipRow>(
    `SELECT
        fo.file_path,
        fo.contribution_share::float AS contribution_share,
        c.name AS contributor_name,
        fm.touches
     FROM file_ownership fo
     JOIN contributors c ON c.id = fo.contributor_id
     JOIN file_metrics fm
       ON fm.repository_id = fo.repository_id
      AND fm.file_path = fo.file_path
     WHERE fo.repository_id = $1
     ORDER BY fo.file_path, fo.contribution_share DESC`,
    [repositoryId],
  );

  const seenFiles = new Set<string>();
  let busFactorCount = 0;
  for (const row of ownershipRows.rows) {
    if (seenFiles.has(row.file_path)) {
      continue;
    }
    seenFiles.add(row.file_path);

    if (
      row.touches >= busFactorTouchThreshold &&
      row.contribution_share >= busFactorShareThreshold
    ) {
      insights.push({
        category: "bus_factor",
        severity: row.contribution_share >= 0.85 ? "risk" : "warning",
        message: `Bus factor risk: ${row.file_path} is dominated by ${row.contributor_name} (${formatPercent(
          row.contribution_share,
        )} of changes).`,
      });
      busFactorCount += 1;
    }

    if (maxPerCategory > 0 && busFactorCount >= maxPerCategory) {
      break;
    }
  }

  await replaceInsights(repositoryId, insights, analysisRunId);
}
