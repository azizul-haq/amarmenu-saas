import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl });

async function main() {
  try {
    console.log("Attempting CREATE EXTENSION pg_cron...");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_cron;");
    console.log("Successfully created extension pg_cron!");
  } catch (err: any) {
    console.log("Error creating extension pg_cron:", err.message);
  }
  await pool.end();
}

main().catch(console.error);
