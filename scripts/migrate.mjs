// Applies pending SQL migrations from ./drizzle. Runs on every Vercel build (see "vercel-build").
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\n[migrate] DATABASE_URL is not set.\n" +
      "On Vercel: Project → Storage → add a Neon Postgres database, then redeploy.\n" +
      "Locally: copy .env.example to .env.local and start Postgres (docker compose up -d).\n",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] Database is up to date.");
} catch (err) {
  console.error("[migrate] Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
