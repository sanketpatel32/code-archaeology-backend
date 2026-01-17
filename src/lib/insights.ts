import { query } from "./db.js";

export type InsightInput = {
  category: string;
  severity: "info" | "warning" | "risk";
  message: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function replaceInsights(
  repositoryId: string,
  insights: InsightInput[],
  analysisRunId?: string,
) {
  await query("DELETE FROM insights WHERE repository_id = $1", [repositoryId]);

  if (!insights.length) {
    return;
  }

  const chunks = chunkArray(insights, 200);
  for (const chunk of chunks) {
    const values: string[] = [];
    const params: Array<string | null> = [];

    chunk.forEach((insight, index) => {
      const base = index * 5;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
      );
      params.push(
        repositoryId,
        analysisRunId ?? null,
        insight.category,
        insight.severity,
        insight.message,
      );
    });

    await query(
      `INSERT INTO insights (
          repository_id,
          analysis_run_id,
          category,
          severity,
          message
       )
       VALUES ${values.join(",")}`,
      params,
    );
  }
}
