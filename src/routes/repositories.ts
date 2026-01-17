import path from "node:path";
import type { FastifyInstance } from "fastify";
import { query } from "../lib/db.js";
import { ensureWorkdir, cloneOrFetchRepo, runCommand } from "../services/git.js";
import { parseRepoUrl } from "../services/repoMeta.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_BRANCHES = 6;
const MAX_BRANCHES = 12;
const DEFAULT_WEEKS = 24;
const MAX_WEEKS = 104;

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

function parseBranchLimit(value: unknown): number {
  return Math.min(parseLimit(value, DEFAULT_BRANCHES), MAX_BRANCHES);
}

function parseWeeks(value: unknown, fallback = DEFAULT_WEEKS): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(raw), 1), MAX_WEEKS);
}

function resolveWorkdir(): string {
  return process.env.WORKDIR || "./.data";
}

function startOfWeekUtc(date: Date): Date {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const bucket = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  bucket.setUTCDate(bucket.getUTCDate() - diff);
  bucket.setUTCHours(0, 0, 0, 0);
  return bucket;
}

function buildWeeklyBuckets(start: Date, end: Date): string[] {
  const buckets: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    buckets.push(cursor.toISOString());
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return buckets;
}

async function getBranchCommitCounts(
  repoPath: string,
  branch: string,
  sinceIso: string,
): Promise<Map<string, number>> {
  const output = await runCommand("git", [
    "-C",
    repoPath,
    "log",
    `origin/${branch}`,
    "--date=iso-strict",
    "--pretty=format:%ad",
    `--since=${sinceIso}`,
  ]);

  const buckets = new Map<string, number>();
  if (!output) {
    return buckets;
  }

  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const committedAt = new Date(trimmed);
    if (Number.isNaN(committedAt.getTime())) {
      continue;
    }
    const bucket = startOfWeekUtc(committedAt).toISOString();
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  return buckets;
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
    "/api/repositories/:id/commits",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read commits.");
      }

      const queryParams = request.query as {
        limit?: string | number;
        before?: string;
      };

      const limit = parseLimit(queryParams?.limit, 100);
      const before = queryParams?.before?.trim()
        ? new Date(queryParams.before)
        : null;

      const result = await query<{
        sha: string;
        author_name: string | null;
        author_email: string | null;
        committed_at: string;
        message: string;
        classification: string;
      }>(
        `SELECT sha, author_name, author_email, committed_at, message, classification
         FROM commits
         WHERE repository_id = $1
           AND ($2::timestamptz IS NULL OR committed_at < $2)
         ORDER BY committed_at DESC
         LIMIT $3`,
        [request.params.id, before ? before.toISOString() : null, limit],
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

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/timeline-classification",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest(
          "DATABASE_URL must be set to read classification timeline.",
        );
      }

        const result = await query<{
          bucket: string;
          feat: number;
          fix: number;
          docs: number;
          style: number;
          refactor: number;
          perf: number;
          test: number;
          build: number;
          ci: number;
          revert: number;
          chore: number;
          unknown: number;
        }>(
          `SELECT
              date_trunc('week', committed_at) AS bucket,
              SUM(CASE WHEN classification IN ('feat', 'feature') THEN 1 ELSE 0 END)::int AS feat,
              SUM(CASE WHEN classification IN ('fix', 'bugfix') THEN 1 ELSE 0 END)::int AS fix,
              SUM(CASE WHEN classification = 'docs' THEN 1 ELSE 0 END)::int AS docs,
              SUM(CASE WHEN classification = 'style' THEN 1 ELSE 0 END)::int AS style,
              SUM(CASE WHEN classification = 'refactor' THEN 1 ELSE 0 END)::int AS refactor,
              SUM(CASE WHEN classification = 'perf' THEN 1 ELSE 0 END)::int AS perf,
              SUM(CASE WHEN classification = 'test' THEN 1 ELSE 0 END)::int AS test,
              SUM(CASE WHEN classification IN ('build', 'maintenance') THEN 1 ELSE 0 END)::int AS build,
              SUM(CASE WHEN classification = 'ci' THEN 1 ELSE 0 END)::int AS ci,
              SUM(CASE WHEN classification = 'revert' THEN 1 ELSE 0 END)::int AS revert,
              SUM(CASE WHEN classification = 'chore' THEN 1 ELSE 0 END)::int AS chore,
              SUM(CASE WHEN classification = 'unknown' THEN 1 ELSE 0 END)::int AS unknown
           FROM commits
           WHERE repository_id = $1
           GROUP BY bucket
           ORDER BY bucket`,
        [request.params.id],
      );

      return result.rows;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/timeline-branches",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest(
          "DATABASE_URL must be set to read branch timeline.",
        );
      }

      const { id } = request.params;
      const queryParams = request.query as {
        limit?: string | number;
        weeks?: string | number;
      };

      const limit = parseBranchLimit(queryParams?.limit);
      const weeks = parseWeeks(queryParams?.weeks);

      const repoResult = await query<{ url: string }>(
        `SELECT url
         FROM repositories
         WHERE id = $1`,
        [id],
      );

      const repoUrl = repoResult.rows[0]?.url;
      if (!repoUrl) {
        return reply.notFound("Repository not found.");
      }

      const workdir = resolveWorkdir();
      await ensureWorkdir(workdir);

      const meta = parseRepoUrl(repoUrl);
      const repoPath = path.resolve(workdir, meta.slug);

      await cloneOrFetchRepo(repoUrl, repoPath);

      const branchSample = Math.min(limit * 3, 30);
      const branchOutput = await runCommand("git", [
        "-C",
        repoPath,
        "for-each-ref",
        `--count=${branchSample}`,
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/remotes/origin/*",
      ]);

      const branches = branchOutput
        .split("\n")
        .map((branch) => branch.trim())
        .filter(Boolean)
        .map((branch) => branch.replace(/^origin\//, ""))
        .filter((branch) => branch && branch !== "HEAD" && branch !== "origin");

      const endBucket = startOfWeekUtc(new Date());
      const startBucket = new Date(endBucket);
      startBucket.setUTCDate(startBucket.getUTCDate() - (weeks - 1) * 7);
      const bucketKeys = buildWeeklyBuckets(startBucket, endBucket);

      const branchRows: Array<{
        name: string;
        totalCommits: number;
        weeks: Array<{ bucket: string; commit_count: number }>;
      }> = [];

      for (const branch of branches) {
        const counts = await getBranchCommitCounts(
          repoPath,
          branch,
          startBucket.toISOString(),
        );
        const weeksData = bucketKeys.map((bucket) => ({
          bucket,
          commit_count: counts.get(bucket) ?? 0,
        }));
        const totalCommits = weeksData.reduce(
          (sum, row) => sum + row.commit_count,
          0,
        );

        if (totalCommits > 0) {
          branchRows.push({
            name: branch,
            totalCommits,
            weeks: weeksData,
          });
        }
      }

      const sorted = branchRows
        .sort((a, b) => b.totalCommits - a.totalCommits)
        .slice(0, limit);

      return {
        range: {
          start: bucketKeys[0] ?? startBucket.toISOString(),
          end:
            bucketKeys[bucketKeys.length - 1] ?? endBucket.toISOString(),
        },
        branches: sorted,
      };
    },
  );
}
