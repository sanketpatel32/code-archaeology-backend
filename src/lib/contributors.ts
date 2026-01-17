import { query } from "./db.js";

export type ContributorInput = {
  name: string;
  email: string | null;
};

type ContributorRow = {
  id: string;
  name: string;
  email: string | null;
};

function contributorKey(name: string, email: string | null): string {
  return `${name}|${email ?? ""}`;
}

function uniqueContributors(inputs: ContributorInput[]): ContributorInput[] {
  const map = new Map<string, ContributorInput>();
  for (const input of inputs) {
    const name = input.name?.trim() || "Unknown";
    const email = input.email?.trim() || null;
    const key = contributorKey(name, email);
    if (!map.has(key)) {
      map.set(key, { name, email });
    }
  }
  return Array.from(map.values());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function upsertContributors(
  repositoryId: string,
  inputs: ContributorInput[],
): Promise<Map<string, string>> {
  const uniqueInputs = uniqueContributors(inputs);
  if (!uniqueInputs.length) {
    return new Map();
  }

  const chunks = chunkArray(uniqueInputs, 500);
  for (const chunk of chunks) {
    const values: string[] = [];
    const params: Array<string | null> = [];

    chunk.forEach((input, index) => {
      const base = index * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(repositoryId, input.name, input.email);
    });

    await query(
      `INSERT INTO contributors (repository_id, name, email)
       VALUES ${values.join(",")}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }

  const rows = await query<ContributorRow>(
    "SELECT id, name, email FROM contributors WHERE repository_id = $1",
    [repositoryId],
  );

  const map = new Map<string, string>();
  for (const row of rows.rows) {
    map.set(contributorKey(row.name, row.email), row.id);
  }

  return map;
}
