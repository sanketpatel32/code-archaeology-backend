import path from "node:path";
import {
  type CommitInsert,
  insertCommits,
  insertFileChanges,
} from "../lib/commits.js";
import { upsertRepository } from "../lib/repositories.js";
import { classifyCommit } from "./classification.js";
import {
  cloneOrFetchRepo,
  ensureWorkdir,
  getGitLogWithNumstat,
  resolveDefaultBranch,
} from "./git.js";
import { parseRepoUrl } from "./repoMeta.js";

function resolveWorkdir(): string {
  return process.env.WORKDIR || "./.data";
}

export type IngestionOptions = {
  branch?: string;
  maxCommits?: number;
};

export type IngestionResult = {
  repositoryId: string;
  repoPath: string;
  defaultBranch: string;
  commitCount: number;
  fileChangeCount: number;
};

export async function ingestRepository(
  repoUrl: string,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const meta = parseRepoUrl(repoUrl);
  const workdir = resolveWorkdir();
  const repoPath = path.resolve(workdir, meta.slug);

  await ensureWorkdir(workdir);

  await cloneOrFetchRepo(repoUrl, repoPath);

  const defaultBranch =
    options.branch || (await resolveDefaultBranch(repoPath));
  const repositoryId = await upsertRepository(
    meta.name,
    repoUrl,
    defaultBranch,
  );

  const envMaxCommits = Number.parseInt(
    process.env.ANALYSIS_MAX_COMMITS || "5000",
    10,
  );
  const maxCommits =
    options.maxCommits && options.maxCommits > 0
      ? options.maxCommits
      : Number.isNaN(envMaxCommits)
        ? 5000
        : envMaxCommits;

  const commits = await getGitLogWithNumstat(
    repoPath,
    `origin/${defaultBranch}`,
    maxCommits,
  );

  const commitRows: CommitInsert[] = commits.map((commit) => ({
    sha: commit.sha,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    committedAt: commit.committedAt,
    message: commit.message,
    classification: classifyCommit(commit.message),
  }));

  const commitMap = await insertCommits(repositoryId, commitRows);

  const fileChanges = commits.flatMap((commit) => {
    const commitId = commitMap.get(commit.sha);
    if (!commitId) {
      return [];
    }

    return commit.fileChanges.map((change) => ({
      commitId,
      filePath: change.filePath,
      additions: change.additions,
      deletions: change.deletions,
    }));
  });

  await insertFileChanges(fileChanges);

  return {
    repositoryId,
    repoPath,
    defaultBranch,
    commitCount: commits.length,
    fileChangeCount: fileChanges.length,
  };
}
