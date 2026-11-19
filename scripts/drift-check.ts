import fs from "fs";
import { Pool } from "pg";

const OLD_DB_URL =
  "postgresql://postgres.<INITIAL_PROJECT_REF>:NaVvC2VBQiO8wMVW@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

const env = fs.readFileSync(".env.staging", "utf8");
const NEW_DB_URL = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];

const DRIFT_QUERY = `
select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable as entry
  from information_schema.columns where table_schema='public'
union all
select 'policy|'||tablename||'|'||policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') as entry
  from pg_policies where schemaname='public'
union all
select 'grant|'||table_name||'|'||grantee||'|'||privilege_type as entry
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
union all
select 'colgrant|'||table_name||'|'||column_name||'|'||grantee||'|'||privilege_type as entry
  from information_schema.column_privileges
  where table_schema='public' and grantee in ('anon','authenticated')
union all
select 'func|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||p.prosecdef||'|'||coalesce(p.proacl::text,'') as entry
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all
select 'trigger|'||event_object_table||'|'||trigger_name||'|'||event_manipulation||'|'||action_timing as entry
  from information_schema.triggers where trigger_schema='public'
order by 1;
`;

async function runDriftCheck() {
  console.log("Connecting to old database (read-only)...");
  const oldPool = new Pool({ connectionString: OLD_DB_URL, ssl: { rejectUnauthorized: false } });
  const oldRes = await oldPool.query<{ entry: string }>(DRIFT_QUERY);
  await oldPool.end();
  const oldLines = oldRes.rows.map((r) => r.entry);
  fs.writeFileSync("drift_old_project.txt", oldLines.join("\n"), "utf8");
  console.log(`Old project catalog entries: ${oldLines.length}`);

  console.log("Connecting to new staging database...");
  const newPool = new Pool({ connectionString: NEW_DB_URL, ssl: { rejectUnauthorized: false } });
  const newRes = await newPool.query<{ entry: string }>(DRIFT_QUERY);
  await newPool.end();
  const newLines = newRes.rows.map((r) => r.entry);
  fs.writeFileSync("drift_new_project.txt", newLines.join("\n"), "utf8");
  console.log(`New staging project catalog entries: ${newLines.length}`);

  // Diff
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const inOldOnly = oldLines.filter((l) => !newSet.has(l));
  const inNewOnly = newLines.filter((l) => !oldSet.has(l));

  console.log(`\n================== DRIFT REPORT ==================`);
  console.log(`Entries in Old Project ONLY (${inOldOnly.length}):`);
  for (const line of inOldOnly) {
    console.log(` - ${line}`);
  }

  console.log(`\nEntries in New Staging Project ONLY (${inNewOnly.length}):`);
  for (const line of inNewOnly) {
    console.log(` + ${line}`);
  }
  console.log(`==================================================\n`);
}

runDriftCheck().catch((err) => {
  console.error("Drift check fatal error:", err);
  process.exit(1);
});
