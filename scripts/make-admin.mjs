// Usage: DATABASE_URL=... npm run db:make-admin -- someone@example.com
import pg from "pg";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run db:make-admin -- <email>");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
await client.connect();
const res = await client.query("UPDATE users SET role = 'admin' WHERE lower(email) = lower($1) RETURNING id", [email]);
console.log(res.rowCount ? `${email} is now an admin.` : `No user found with email ${email}.`);
await client.end();
