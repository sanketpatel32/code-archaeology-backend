import { Pool, type QueryResult } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  if (!pool) {
    pool = new Pool({ connectionString });
  }

  return pool;
}

export async function query<T>(
  text: string,
  params: Array<string | number | boolean | null | object> = [],
): Promise<QueryResult<T>> {
  return getPool().query(text, params);
}
