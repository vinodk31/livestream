import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { __setDbForTesting } from "@/server/db";

/** Spins up an in-process Postgres (PGlite), applies the real migrations and installs it as the app DB. */
export async function setupTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  __setDbForTesting(db);
  return {
    db,
    async reset() {
      await db.execute(
        sql`TRUNCATE users, refresh_tokens, email_tokens, streams, stream_sessions, viewer_stats, reports, audit_logs CASCADE`,
      );
    },
    async close() {
      await client.close();
    },
  };
}
