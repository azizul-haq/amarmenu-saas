import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const migrationFile = "supabase/migrations/20261118000068_chunk22_super_admin_ops_hardening.sql";
  const version = "20261118000068";
  const sql = fs.readFileSync(migrationFile, "utf8");
  console.log(`Applying migration ${version} to database...`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    await client.query(sql);
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING;`,
      [version]
    );
    await client.query("COMMIT;");
    console.log(`Migration ${version} successfully applied and recorded!`);
  } catch (err) {
    await client.query("ROLLBACK;");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error("Migration error:", e);
  pool.end();
});
