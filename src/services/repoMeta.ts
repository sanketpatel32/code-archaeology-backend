export type RepoMeta = {
  owner: string;
  repo: string;
  name: string;
  slug: string;
};

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseRepoUrl(repoUrl: string): RepoMeta {
  let path = repoUrl.trim();

  if (path.startsWith("git@")) {
    const match = path.match(/:(.+)$/);
    path = match ? (match[1] ?? path) : path;
  } else {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch {
      // treat as path-like input
    }
  }

  path = path.replace(/^\/+/, "").replace(/\.git$/i, "");
  const parts = path.split("/").filter(Boolean);

  const owner = parts.length > 1 ? (parts[0] ?? "unknown") : "unknown";
  const repo = parts.length > 1 ? (parts[1] ?? "repo") : (parts[0] ?? "repo");
  const name = `${owner}/${repo}`;
  const slug = sanitizeSlug(`${owner}-${repo}`);

  return { owner, repo, name, slug };
}
