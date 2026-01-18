import { touchRepositoryAnalyzed } from "../lib/repositories.js";
import { computeComplexitySnapshots } from "./complexity.js";
import { ingestRepository } from "./ingestion.js";
import { generateInsights } from "./insights.js";
import { computeFileMetrics } from "./metrics.js";
import { computeOwnership } from "./ownership.js";
import { runQualityAnalysis } from "./quality.js";

export type AnalysisInput = {
  repoUrl: string;
  branch?: string;
  maxCommits?: number;
  analysisRunId?: string;
};

export type AnalysisSummary = {
  repositoryId: string;
  defaultBranch: string;
  commitCount: number;
  fileChangeCount: number;
};

export async function runAnalysis(
  input: AnalysisInput,
): Promise<AnalysisSummary> {
  const ingestion = await ingestRepository(input.repoUrl, {
    branch: input.branch,
    maxCommits: input.maxCommits,
  });

  const recentDays =
    Number.parseInt(process.env.ANALYSIS_RECENT_DAYS || "90", 10) || 90;

  await computeFileMetrics(ingestion.repositoryId, recentDays);
  await computeOwnership(ingestion.repositoryId);
  await computeComplexitySnapshots(ingestion.repositoryId, ingestion.repoPath);
  await generateInsights(ingestion.repositoryId, input.analysisRunId);
  await touchRepositoryAnalyzed(ingestion.repositoryId);
  try {
    await runQualityAnalysis(
      ingestion.repositoryId,
      ingestion.repoPath,
      input.branch ?? ingestion.defaultBranch,
    );
  } catch (error) {
    console.warn(
      "Quality analysis skipped:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    repositoryId: ingestion.repositoryId,
    defaultBranch: ingestion.defaultBranch,
    commitCount: ingestion.commitCount,
    fileChangeCount: ingestion.fileChangeCount,
  };
}
