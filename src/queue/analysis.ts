import { type Job, type JobsOptions, Queue, QueueEvents, Worker } from "bullmq";
import { updateAnalysisRunStatus } from "../lib/analysisRuns.js";
import { runAnalysis } from "../services/analysis.js";
import { getRedisConnection } from "./connection.js";

export const ANALYSIS_QUEUE_NAME = "analysis";

export type AnalysisJobData = {
  runId: string;
  repoUrl: string;
  branch?: string;
  options?: Record<string, unknown>;
};

let analysisQueue: Queue<AnalysisJobData> | null = null;

export function getAnalysisQueue(): Queue<AnalysisJobData> {
  if (!analysisQueue) {
    analysisQueue = new Queue(ANALYSIS_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }

  return analysisQueue;
}

export function createAnalysisQueueEvents(): QueueEvents {
  return new QueueEvents(ANALYSIS_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
}

export async function enqueueAnalysisJob(
  data: AnalysisJobData,
  options: JobsOptions = {},
) {
  const queue = getAnalysisQueue();
  return queue.add("analyze", data, {
    jobId: data.runId,
    removeOnComplete: 100,
    removeOnFail: 100,
    ...options,
  });
}

export function createAnalysisWorker() {
  return new Worker<AnalysisJobData>(
    ANALYSIS_QUEUE_NAME,
    async (job: Job<AnalysisJobData>) => {
      await updateAnalysisRunStatus(job.data.runId, "running");

      try {
        await runAnalysis({
          repoUrl: job.data.repoUrl,
          branch: job.data.branch,
          maxCommits: Number(job.data.options?.maxCommits ?? 0) || undefined,
          analysisRunId: job.data.runId,
        });
        await updateAnalysisRunStatus(job.data.runId, "succeeded");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown analysis error";
        await updateAnalysisRunStatus(job.data.runId, "failed", message);
        throw error;
      }
    },
    { connection: getRedisConnection() },
  );
}
