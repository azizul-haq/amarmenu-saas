import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const migrationFile = "supabase/migrations/20261119000069_chunk22b_rbac_privileges_and_vault_cleanup.sql";
  const version = "20261119000069";
  const sql = fs.readFileSync(migrationFile, "utf8");
  console.log(`Applying migration ${version} to staging database...`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    await client.query(sql);
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING;`,
      [version, "chunk22b_rbac_privileges_and_vault_cleanup"]
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
  process.exit(1);
});
