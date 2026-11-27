import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __il_db?: Database; __il_pool?: Pool };

function createDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const pool =
    globalForDb.__il_pool ??
    new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
    });
  globalForDb.__il_pool = pool;
  return drizzle(pool, { schema });
}

/** Lazily-created shared database client (reused across hot reloads and warm invocations). */
export function getDb(): Database {
  globalForDb.__il_db ??= createDb();
  return globalForDb.__il_db;
}

/** Test-only: swap in another Drizzle instance (e.g. PGlite). */
export function __setDbForTesting(db: unknown) {
  globalForDb.__il_db = db as Database;
}

export { schema };
