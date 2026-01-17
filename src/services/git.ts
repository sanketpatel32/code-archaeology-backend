import { mkdir } from "node:fs/promises";

type CommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  trimOutput?: boolean;
};

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<string> {
  const trimOutput = options.trimOutput ?? true;
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command} ${args.join(" ")}\n${stderr}`,
    );
  }

  return trimOutput ? stdout.trim() : stdout;
}

export async function ensureWorkdir(workdir: string) {
  await mkdir(workdir, { recursive: true });
}

export async function cloneOrFetchRepo(
  repoUrl: string,
  repoPath: string,
): Promise<void> {
  try {
    await runCommand("git", [
      "-C",
      repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    await runCommand("git", ["-C", repoPath, "fetch", "origin", "--prune"]);
  } catch {
    await runCommand("git", ["clone", repoUrl, repoPath]);
  }
}

export async function resolveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const ref = await runCommand("git", [
      "-C",
      repoPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    const parts = ref.split("/");
    return parts[parts.length - 1] ?? "main";
  } catch {
    // fall through
  }

  for (const candidate of ["main", "master"]) {
    try {
      await runCommand("git", [
        "-C",
        repoPath,
        "rev-parse",
        "--verify",
        `origin/${candidate}`,
      ]);
      return candidate;
    } catch {
      // ignore
    }
  }

  return "main";
}

export type GitCommitLog = {
  sha: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
  fileChanges: Array<{
    filePath: string;
    additions: number;
    deletions: number;
  }>;
};

export async function getGitLogWithNumstat(
  repoPath: string,
  ref: string,
  maxCommits?: number,
): Promise<GitCommitLog[]> {
  const format = "%H%x1f%an%x1f%ae%x1f%ad%x1f%s";
  const args = [
    "-C",
    repoPath,
    "log",
    ref,
    "--date=iso-strict",
    `--pretty=format:${format}`,
    "--numstat",
  ];

  if (maxCommits && maxCommits > 0) {
    args.push(`--max-count=${maxCommits}`);
  }

  const output = await runCommand("git", args);
  if (!output) {
    return [];
  }

  const commits: GitCommitLog[] = [];
  let current: GitCommitLog | null = null;
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    if (line.includes("\x1f")) {
      if (current) {
        commits.push(current);
      }

      const [sha, authorName, authorEmail, committedAt, message] =
        line.split("\x1f");
      current = {
        sha: sha ?? "",
        authorName: authorName ?? "",
        authorEmail: authorEmail ?? "",
        committedAt: committedAt ?? "",
        message: message ?? "",
        fileChanges: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const additionsRaw = parts[0] ?? "";
    const deletionsRaw = parts[1] ?? "";
    const filePath = parts.slice(2).join("\t");

    const additions =
      additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw, 10) || 0;
    const deletions =
      deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw, 10) || 0;

    current.fileChanges.push({ filePath, additions, deletions });
  }

  if (current) {
    commits.push(current);
  }

  return commits;
}
