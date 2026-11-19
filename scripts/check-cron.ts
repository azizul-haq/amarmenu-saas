import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl });

async function main() {
  const ext = await pool.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron'"
  );
  console.log("pg_cron extension on staging:", ext.rows);

  if (ext.rows.length > 0) {
    const jobs = await pool.query("SELECT * FROM cron.job;");
    console.log("Existing cron jobs:", jobs.rows);
  } else {
    // Check if pg_cron is available in pg_available_extensions
    const avail = await pool.query(
      "SELECT name, default_version, installed_version, comment FROM pg_available_extensions WHERE name = 'pg_cron';"
    );
    console.log("pg_cron availability:", avail.rows);
  }

  await pool.end();
}

main().catch(console.error);
