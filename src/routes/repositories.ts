import type { FastifyInstance } from "fastify";
import { query } from "../lib/db.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function parseLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.min(Math.max(parsed, 1), MAX_LIMIT);
    }
  }

  return fallback;
}

export async function repositoryRoutes(app: FastifyInstance) {
  app.get("/api/repositories", async (request) => {
    if (!app.config.DATABASE_URL) {
      return [];
    }

    const limit = parseLimit(
      (request.query as { limit?: string | number })?.limit,
      50,
    );

    const result = await query<{
      id: string;
      name: string;
      url: string;
      default_branch: string;
      last_analyzed_at: string | null;
      updated_at: string;
    }>(
      `SELECT id, name, url, default_branch, last_analyzed_at, updated_at
       FROM repositories
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows;
  });

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest(
          "DATABASE_URL must be set to read repositories.",
        );
      }

      const result = await query<{
        id: string;
        name: string;
        url: string;
        default_branch: string;
        last_analyzed_at: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, name, url, default_branch, last_analyzed_at, created_at, updated_at
       FROM repositories
       WHERE id = $1`,
        [request.params.id],
      );

      const repo = result.rows[0];
      if (!repo) {
        return reply.notFound("Repository not found.");
      }

      return repo;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/summary",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read summary.");
      }

      const repositoryId = request.params.id;
      const repoResult = await query<{
        id: string;
        name: string;
        url: string;
        default_branch: string;
        last_analyzed_at: string | null;
      }>(
        `SELECT id, name, url, default_branch, last_analyzed_at
         FROM repositories
         WHERE id = $1`,
        [repositoryId],
      );

      const repo = repoResult.rows[0];
      if (!repo) {
        return reply.notFound("Repository not found.");
      }

      const counts = await query<{
        commit_count: number;
        file_count: number;
        last_commit_at: string | null;
      }>(
        `SELECT
            (SELECT COUNT(*) FROM commits WHERE repository_id = $1)::int AS commit_count,
            (SELECT COUNT(*) FROM file_metrics WHERE repository_id = $1)::int AS file_count,
            (SELECT MAX(committed_at) FROM commits WHERE repository_id = $1) AS last_commit_at`,
        [repositoryId],
      );

      const latestRun = await query<{
        id: string;
        status: string;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
      }>(
        `SELECT id, status, created_at, started_at, completed_at
         FROM analysis_runs
         WHERE repository_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [repositoryId],
      );

      return {
        repository: repo,
        counts: counts.rows[0],
        latestRun: latestRun.rows[0] ?? null,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/hotspots",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read hotspots.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
      );

      const result = await query<{
        file_path: string;
        touches: number;
        churn: number;
        hotspot_score: number;
      }>(
        `SELECT file_path, touches, churn, hotspot_score
         FROM file_metrics
         WHERE repository_id = $1
         ORDER BY hotspot_score DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/fragility",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read fragility.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
      );

      const result = await query<{
        file_path: string;
        touches: number;
        churn: number;
        fragility_index: number;
      }>(
        `SELECT file_path, touches, churn, fragility_index
         FROM file_metrics
         WHERE repository_id = $1
         ORDER BY fragility_index DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/ownership",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read ownership.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
      );

      const result = await query<{
        file_path: string;
        contributor_name: string;
        touches: number;
        churn: number;
        contribution_share: number;
      }>(
        `SELECT file_path, contributor_name, touches, churn, contribution_share
         FROM (
            SELECT DISTINCT ON (fo.file_path)
              fo.file_path,
              c.name AS contributor_name,
              fo.touches,
              fo.churn,
              fo.contribution_share
            FROM file_ownership fo
            JOIN contributors c ON c.id = fo.contributor_id
            WHERE fo.repository_id = $1
            ORDER BY fo.file_path, fo.contribution_share DESC
         ) ranked
         ORDER BY contribution_share DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/insights",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read insights.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
        50,
      );

      const result = await query<{
        category: string;
        severity: string;
        message: string;
        created_at: string;
      }>(
        `SELECT category, severity, message, created_at
         FROM insights
         WHERE repository_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/runs",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read runs.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
        10,
      );

      const result = await query<{
        id: string;
        status: string;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
        error_message: string | null;
      }>(
        `SELECT id, status, created_at, started_at, completed_at, error_message
         FROM analysis_runs
         WHERE repository_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/bus-factor",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read bus factor.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
        10,
      );

      const touchThreshold = app.config.BUS_FACTOR_TOUCH_THRESHOLD;
      const shareThreshold = app.config.BUS_FACTOR_SHARE_THRESHOLD;

      const result = await query<{
        file_path: string;
        contributor_name: string;
        contribution_share: number;
        touches: number;
        churn: number;
      }>(
        `SELECT
            fo.file_path,
            c.name AS contributor_name,
            fo.contribution_share,
            fm.touches,
            fm.churn
         FROM file_ownership fo
         JOIN contributors c ON c.id = fo.contributor_id
         JOIN file_metrics fm
           ON fm.repository_id = fo.repository_id
          AND fm.file_path = fo.file_path
         WHERE fo.repository_id = $1
           AND fm.touches >= $2
           AND fo.contribution_share >= $3
         ORDER BY fo.contribution_share DESC, fm.touches DESC
         LIMIT $4`,
        [request.params.id, touchThreshold, shareThreshold, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/complexity",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read complexity.");
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
        100,
      );

      const result = await query<{
        file_path: string;
        commit_sha: string;
        functions: number;
        conditionals: number;
        max_nesting: number;
        lines: number;
      }>(
        `SELECT file_path, commit_sha, functions, conditionals, max_nesting, lines
         FROM (
           SELECT DISTINCT ON (cs.file_path)
             cs.file_path,
             cs.commit_sha,
             cs.functions,
             cs.conditionals,
             cs.max_nesting,
             cs.lines,
             cs.created_at
           FROM complexity_snapshots cs
           WHERE cs.repository_id = $1
           ORDER BY cs.file_path, cs.created_at DESC
         ) latest
         ORDER BY lines DESC
         LIMIT $2`,
        [request.params.id, limit],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/timeline",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read timeline.");
      }

      const result = await query<{
        bucket: string;
        commit_count: number;
        additions: number | null;
        deletions: number | null;
      }>(
        `SELECT
            date_trunc('week', c.committed_at) AS bucket,
            COUNT(DISTINCT c.id)::int AS commit_count,
            COALESCE(SUM(fc.additions), 0)::int AS additions,
            COALESCE(SUM(fc.deletions), 0)::int AS deletions
         FROM commits c
         LEFT JOIN file_changes fc ON fc.commit_id = c.id
         WHERE c.repository_id = $1
         GROUP BY bucket
         ORDER BY bucket`,
        [request.params.id],
      );

      return result.rows;
    },
  );
}
