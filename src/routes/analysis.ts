import type { FastifyInstance } from "fastify";
import { createAnalysisRun, getAnalysisRun } from "../lib/analysisRuns.js";
import { query } from "../lib/db.js";
import { upsertRepository } from "../lib/repositories.js";
import { enqueueAnalysisJob } from "../queue/analysis.js";
import { parseRepoUrl } from "../services/repoMeta.js";

type AnalysisRequestBody = {
  repoUrl: string;
  branch?: string;
  maxCommits?: number;
};

export async function analysisRoutes(app: FastifyInstance) {
  app.post<{ Body: AnalysisRequestBody }>(
    "/api/analysis",
    {
      schema: {
        body: {
          type: "object",
          required: ["repoUrl"],
          properties: {
            repoUrl: { type: "string" },
            branch: { type: "string" },
            maxCommits: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const { repoUrl, branch, maxCommits } = request.body;
      const normalizedMaxCommits =
        typeof maxCommits === "number" && maxCommits > 0
          ? Math.floor(maxCommits)
          : undefined;

      if (!app.config.DATABASE_URL || !app.config.REDIS_URL) {
        return reply.badRequest(
          "DATABASE_URL and REDIS_URL must be set to start analysis.",
        );
      }

      const meta = parseRepoUrl(repoUrl);
      const repositoryId = await upsertRepository(
        meta.name,
        repoUrl,
        branch || "main",
      );

      const existingRun = await query<{ id: string }>(
        `SELECT id
         FROM analysis_runs
         WHERE repository_id = $1
           AND status IN ('queued', 'running')
         ORDER BY created_at DESC
         LIMIT 1`,
        [repositoryId],
      );

      if (existingRun.rows[0]?.id) {
        return reply.code(202).send({
          runId: existingRun.rows[0].id,
          repositoryId,
        });
      }

      const runId = await createAnalysisRun(repositoryId, {
        branch,
        maxCommits: normalizedMaxCommits,
      });

      await enqueueAnalysisJob({
        runId,
        repoUrl,
        branch,
        options: { maxCommits: normalizedMaxCommits },
      });

      return reply.code(202).send({ runId, repositoryId });
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/api/analysis/:runId",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read analysis.");
      }

      const run = await getAnalysisRun(request.params.runId);
      if (!run) {
        return reply.notFound("Analysis run not found.");
      }

      return reply.send(run);
    },
  );
}
