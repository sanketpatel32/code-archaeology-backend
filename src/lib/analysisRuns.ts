import { query } from "./db.js";

export type AnalysisRunStatus = "queued" | "running" | "succeeded" | "failed";

export async function createAnalysisRun(
  repositoryId: string,
  options: Record<string, unknown> = {},
): Promise<string> {
  const result = await query<{ id: string }>(
    "INSERT INTO analysis_runs (repository_id, status, options) VALUES ($1, $2, $3) RETURNING id",
    [repositoryId, "queued", JSON.stringify(options)],
  );

  return result.rows[0]?.id ?? "";
}

export async function updateAnalysisRunStatus(
  runId: string,
  status: AnalysisRunStatus,
  errorMessage: string | null = null,
): Promise<void> {
  if (!runId) {
    return;
  }

  if (status === "running") {
    await query(
      "UPDATE analysis_runs SET status = $2, started_at = COALESCE(started_at, now()) WHERE id = $1",
      [runId, status],
    );
    return;
  }

  if (status === "succeeded") {
    await query(
      "UPDATE analysis_runs SET status = $2, completed_at = now(), error_message = NULL WHERE id = $1",
      [runId, status],
    );
    return;
  }

  await query(
    "UPDATE analysis_runs SET status = $2, completed_at = now(), error_message = $3 WHERE id = $1",
    [runId, status, errorMessage],
  );
}

export async function getAnalysisRun(runId: string) {
  const result = await query<{
    id: string;
    status: AnalysisRunStatus;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    options: Record<string, unknown>;
  }>(
    "SELECT id, status, created_at, started_at, completed_at, error_message, options FROM analysis_runs WHERE id = $1",
    [runId],
  );

  return result.rows[0] ?? null;
}
