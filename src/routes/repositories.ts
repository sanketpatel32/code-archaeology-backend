import path from "node:path";
import type { FastifyInstance } from "fastify";
import { query } from "../lib/db.js";
import { ensureWorkdir, cloneOrFetchRepo, runCommand } from "../services/git.js";
import { parseRepoUrl } from "../services/repoMeta.js";
import { startQualityAnalysis } from "../services/quality.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_BRANCHES = 6;
const MAX_BRANCHES = 12;
const DEFAULT_WEEKS = 24;
const MAX_WEEKS = 104;
const COMMIT_CLASSIFICATION_SQL = `CASE
  WHEN classification = 'bugfix' THEN 'fix'
  WHEN classification = 'feature' THEN 'feat'
  WHEN classification = 'maintenance' THEN 'build'
  WHEN classification <> 'unknown' THEN classification
  WHEN lower(message) ~ '^(feat|feature)(\\([^)]+\\))?!?:' THEN 'feat'
  WHEN lower(message) ~ '^(fix|bugfix)(\\([^)]+\\))?!?:' THEN 'fix'
  WHEN lower(message) ~ '^(docs|doc)(\\([^)]+\\))?!?:' THEN 'docs'
  WHEN lower(message) ~ '^(style|styles)(\\([^)]+\\))?!?:' THEN 'style'
  WHEN lower(message) ~ '^(refactor)(\\([^)]+\\))?!?:' THEN 'refactor'
  WHEN lower(message) ~ '^(perf)(\\([^)]+\\))?!?:' THEN 'perf'
  WHEN lower(message) ~ '^(test|tests)(\\([^)]+\\))?!?:' THEN 'test'
  WHEN lower(message) ~ '^(build)(\\([^)]+\\))?!?:' THEN 'build'
  WHEN lower(message) ~ '^(ci)(\\([^)]+\\))?!?:' THEN 'ci'
  WHEN lower(message) ~ '^(revert)(\\([^)]+\\))?!?:' THEN 'revert'
  WHEN lower(message) ~ '^(chore)(\\([^)]+\\))?!?:' THEN 'chore'
  ELSE 'unknown'
END`;

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

function parseOffset(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.floor(value), 0);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(parsed, 0);
    }
  }

  return 0;
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

async function getLatestQualityRunId(repositoryId: string) {
  const result = await query<{ id: string }>(
    `SELECT id
     FROM quality_runs
     WHERE repository_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [repositoryId],
  );

  return result.rows[0]?.id ?? null;
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
    "/api/repositories/:id/quality",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read quality.");
      }

      const repositoryId = request.params.id;
      const runResult = await query<{
        id: string;
        status: string;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
        files_analyzed: number | null;
        lines_analyzed: number | null;
        quality_grade: string | null;
        error_message: string | null;
        duration_seconds: number | null;
      }>(
        `SELECT
            id,
            status,
            created_at,
            started_at,
            completed_at,
            files_analyzed,
            lines_analyzed,
            quality_grade,
            error_message,
            CASE
              WHEN started_at IS NULL OR completed_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (completed_at - started_at))::int
            END AS duration_seconds
         FROM quality_runs
         WHERE repository_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [repositoryId],
      );

      const run = runResult.rows[0] ?? null;
      if (!run) {
        return {
          run: null,
          counts: {
            total: 0,
            bugs: 0,
            security_issues: 0,
            code_smells: 0,
            performance: 0,
            info: 0,
            warning: 0,
            error: 0,
          },
          languages: [],
        };
      }

      const countsResult = await query<{
        total: number;
        bugs: number;
        security_issues: number;
        code_smells: number;
        performance: number;
        info: number;
        warning: number;
        error: number;
      }>(
        `SELECT
            COUNT(*)::int AS total,
            SUM(CASE WHEN category = 'bug' THEN 1 ELSE 0 END)::int AS bugs,
            SUM(CASE WHEN category = 'security' THEN 1 ELSE 0 END)::int AS security_issues,
            SUM(CASE WHEN category = 'code_smell' THEN 1 ELSE 0 END)::int AS code_smells,
            SUM(CASE WHEN category = 'performance' THEN 1 ELSE 0 END)::int AS performance,
            SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END)::int AS info,
            SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END)::int AS warning,
            SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END)::int AS error
         FROM quality_findings
         WHERE quality_run_id = $1`,
        [run.id],
      );

      const languageResult = await query<{ language: string }>(
        `SELECT DISTINCT language
         FROM quality_findings
         WHERE quality_run_id = $1
           AND language IS NOT NULL
         ORDER BY language`,
        [run.id],
      );

      const severityMatrixResult = await query<{
        category: string;
        error: number;
        warning: number;
        info: number;
      }>(
        `SELECT
            category,
            SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END)::int AS error,
            SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END)::int AS warning,
            SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END)::int AS info
         FROM quality_findings
         WHERE quality_run_id = $1
         GROUP BY category
         ORDER BY category`,
        [run.id],
      );

      const topRulesResult = await query<{
        rule_id: string;
        count: number;
      }>(
        `SELECT rule_id, COUNT(*)::int AS count
         FROM quality_findings
         WHERE quality_run_id = $1
         GROUP BY rule_id
         ORDER BY count DESC
         LIMIT 8`,
        [run.id],
      );

      const topFilesResult = await query<{
        file_path: string;
        language: string | null;
        lines_of_code: number | null;
        findings_count: number;
        bugs: number;
        security_issues: number;
        code_smells: number;
      }>(
        `SELECT file_path, language, lines_of_code, findings_count, bugs, security_issues, code_smells
         FROM quality_file_stats
         WHERE quality_run_id = $1
         ORDER BY findings_count DESC
         LIMIT 8`,
        [run.id],
      );

      return {
        run,
        counts: countsResult.rows[0],
        languages: languageResult.rows.map((row) => row.language),
        severity_matrix: severityMatrixResult.rows,
        top_rules: topRulesResult.rows,
        top_files: topFilesResult.rows,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/quality/findings",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read findings.");
      }

      const repositoryId = request.params.id;
      const runId = await getLatestQualityRunId(repositoryId);
      if (!runId) {
        return { findings: [] };
      }

      const queryParams = request.query as {
        limit?: string | number;
        offset?: string | number;
        severity?: string;
        category?: string;
        file?: string;
      };

      const limit = parseLimit(queryParams?.limit, 120);
      const offset = parseOffset(queryParams?.offset);
      const severity = queryParams?.severity?.trim();
      const category = queryParams?.category?.trim();
      const file = queryParams?.file?.trim();

      const conditions: string[] = ["quality_run_id = $1"];
      const params: Array<string | number> = [runId];

      if (severity) {
        params.push(severity);
        conditions.push(`severity = $${params.length}`);
      }
      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (file) {
        params.push(`%${file}%`);
        conditions.push(`file_path ILIKE $${params.length}`);
      }

      params.push(limit);
      params.push(offset);

      const result = await query<{
        file_path: string;
        line_start: number;
        line_end: number | null;
        rule_id: string;
        severity: string;
        category: string;
        message: string;
        language: string | null;
      }>(
        `SELECT file_path, line_start, line_end, rule_id, severity, category, message, language
         FROM quality_findings
         WHERE ${conditions.join(" AND ")}
         ORDER BY severity DESC, category ASC, file_path ASC, line_start ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return { findings: result.rows };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/repositories/:id/quality/files",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to read file stats.");
      }

      const repositoryId = request.params.id;
      const runId = await getLatestQualityRunId(repositoryId);
      if (!runId) {
        return { files: [] };
      }

      const limit = parseLimit(
        (request.query as { limit?: string | number })?.limit,
        20,
      );

      const result = await query<{
        file_path: string;
        language: string | null;
        lines_of_code: number | null;
        findings_count: number;
        bugs: number;
        security_issues: number;
        code_smells: number;
      }>(
        `SELECT file_path, language, lines_of_code, findings_count, bugs, security_issues, code_smells
         FROM quality_file_stats
         WHERE quality_run_id = $1
         ORDER BY findings_count DESC
         LIMIT $2`,
        [runId, limit],
      );

      return { files: result.rows };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/repositories/:id/quality/run",
    async (request, reply) => {
      if (!app.config.DATABASE_URL) {
        return reply.badRequest("DATABASE_URL must be set to run quality scan.");
      }

      const repositoryId = request.params.id;
      const repoResult = await query<{
        url: string;
        default_branch: string | null;
      }>(
        `SELECT url, default_branch
         FROM repositories
         WHERE id = $1`,
        [repositoryId],
      );

      const repo = repoResult.rows[0];
      if (!repo?.url) {
        return reply.notFound("Repository not found.");
      }

      const body = request.body as { branch?: string | null } | undefined;
      const branch =
        typeof body?.branch === "string" && body.branch.trim()
          ? body.branch.trim()
          : repo.default_branch ?? null;

      const result = await startQualityAnalysis(
        repositoryId,
        repo.url,
        branch,
      );
      return result;
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
        `SELECT
            sha,
            author_name,
            author_email,
            committed_at,
            message,
            ${COMMIT_CLASSIFICATION_SQL} AS classification
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
          `WITH classified AS (
              SELECT
                date_trunc('week', committed_at) AS bucket,
                ${COMMIT_CLASSIFICATION_SQL} AS classification_effective
              FROM commits
              WHERE repository_id = $1
           )
           SELECT
              bucket,
              SUM(CASE WHEN classification_effective = 'feat' THEN 1 ELSE 0 END)::int AS feat,
              SUM(CASE WHEN classification_effective = 'fix' THEN 1 ELSE 0 END)::int AS fix,
              SUM(CASE WHEN classification_effective = 'docs' THEN 1 ELSE 0 END)::int AS docs,
              SUM(CASE WHEN classification_effective = 'style' THEN 1 ELSE 0 END)::int AS style,
              SUM(CASE WHEN classification_effective = 'refactor' THEN 1 ELSE 0 END)::int AS refactor,
              SUM(CASE WHEN classification_effective = 'perf' THEN 1 ELSE 0 END)::int AS perf,
              SUM(CASE WHEN classification_effective = 'test' THEN 1 ELSE 0 END)::int AS test,
              SUM(CASE WHEN classification_effective = 'build' THEN 1 ELSE 0 END)::int AS build,
              SUM(CASE WHEN classification_effective = 'ci' THEN 1 ELSE 0 END)::int AS ci,
              SUM(CASE WHEN classification_effective = 'revert' THEN 1 ELSE 0 END)::int AS revert,
              SUM(CASE WHEN classification_effective = 'chore' THEN 1 ELSE 0 END)::int AS chore,
              SUM(CASE WHEN classification_effective = 'unknown' THEN 1 ELSE 0 END)::int AS unknown
           FROM classified
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
