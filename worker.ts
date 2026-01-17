import {
  createAnalysisQueueEvents,
  createAnalysisWorker,
} from "./src/queue/analysis.js";

const worker = createAnalysisWorker();
const events = createAnalysisQueueEvents();

events.on("completed", ({ jobId }) => {
  console.log(`[analysis] job ${jobId} completed`);
});

events.on("failed", ({ jobId, failedReason }) => {
  console.log(`[analysis] job ${jobId} failed: ${failedReason ?? "unknown"}`);
});

const shutdown = async () => {
  await worker.close();
  await events.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
