CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL UNIQUE,
  default_branch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_analyzed_at timestamptz
);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

CREATE INDEX analysis_runs_repository_id_idx ON analysis_runs(repository_id);
CREATE INDEX analysis_runs_status_idx ON analysis_runs(status);

CREATE TABLE commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha text NOT NULL,
  author_name text,
  author_email text,
  committed_at timestamptz NOT NULL,
  message text NOT NULL,
  classification text NOT NULL DEFAULT 'unknown'
    CHECK (classification IN ('bugfix', 'feature', 'refactor', 'maintenance', 'chore', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX commits_repository_sha_idx ON commits(repository_id, sha);
CREATE INDEX commits_repository_committed_at_idx ON commits(repository_id, committed_at);

CREATE TABLE file_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_id uuid NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  additions integer NOT NULL DEFAULT 0,
  deletions integer NOT NULL DEFAULT 0
);

CREATE INDEX file_changes_commit_id_idx ON file_changes(commit_id);
CREATE INDEX file_changes_file_path_idx ON file_changes(file_path);
CREATE UNIQUE INDEX file_changes_commit_path_idx ON file_changes(commit_id, file_path);

CREATE TABLE file_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  touches integer NOT NULL DEFAULT 0,
  churn integer NOT NULL DEFAULT 0,
  hotspot_score numeric(6, 4) NOT NULL DEFAULT 0,
  fragility_index numeric(6, 4) NOT NULL DEFAULT 0,
  bugfix_ratio numeric(6, 4) NOT NULL DEFAULT 0,
  last_touched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX file_metrics_repository_path_idx
  ON file_metrics(repository_id, file_path);
CREATE INDEX file_metrics_repository_hotspot_idx
  ON file_metrics(repository_id, hotspot_score DESC);
CREATE INDEX file_metrics_repository_fragility_idx
  ON file_metrics(repository_id, fragility_index DESC);

CREATE TABLE contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contributors_repository_name_email_idx
  ON contributors(repository_id, name, email);

CREATE TABLE file_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  contributor_id uuid NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  touches integer NOT NULL DEFAULT 0,
  churn integer NOT NULL DEFAULT 0,
  contribution_share numeric(6, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX file_ownership_repo_file_contributor_idx
  ON file_ownership(repository_id, file_path, contributor_id);
CREATE INDEX file_ownership_repo_file_idx
  ON file_ownership(repository_id, file_path);

CREATE TABLE complexity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  file_path text NOT NULL,
  functions integer NOT NULL DEFAULT 0,
  conditionals integer NOT NULL DEFAULT 0,
  max_nesting integer NOT NULL DEFAULT 0,
  lines integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX complexity_snapshots_repo_commit_idx
  ON complexity_snapshots(repository_id, commit_sha);
CREATE INDEX complexity_snapshots_repo_file_idx
  ON complexity_snapshots(repository_id, file_path);

CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  analysis_run_id uuid REFERENCES analysis_runs(id) ON DELETE SET NULL,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'risk')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX insights_repository_id_idx ON insights(repository_id);
CREATE INDEX insights_analysis_run_id_idx ON insights(analysis_run_id);
