-- ==============================================================================
-- scripts/catalog-dump.sql
-- Deterministic, diffable catalog dump for AmarMenu Supabase databases.
-- Format: kind|object|detail (one row per line, sorted alphabetically).
-- Excludes volatile values (timestamps, OIDs, internal IDs) so diff is exact.
-- ==============================================================================

WITH catalog_lines AS (
  -- 1. Table Columns
  SELECT 
    'TABLE_COLUMN'::text AS kind,
    (c.table_name || '.' || c.column_name)::text AS object,
    (c.data_type || '|nullable=' || c.is_nullable || '|default=' || COALESCE(c.column_default, 'none'))::text AS detail
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'

  UNION ALL

  -- 2. Table RLS Flags
  SELECT 
    'TABLE_RLS'::text AS kind,
    c.relname::text AS object,
    ('rls_enabled=' || c.relrowsecurity::text || '|rls_forced=' || c.relforcerowsecurity::text)::text AS detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'

  UNION ALL

  -- 3. RLS Policies
  SELECT 
    'RLS_POLICY'::text AS kind,
    (p.tablename || '.' || p.policyname)::text AS object,
    ('cmd=' || p.cmd::text || '|roles=' || p.roles::text || '|qual=' || COALESCE(regexp_replace(p.qual, '\s+', ' ', 'g'), 'none') || '|with_check=' || COALESCE(regexp_replace(p.with_check, '\s+', ' ', 'g'), 'none'))::text AS detail
  FROM pg_policies p
  WHERE p.schemaname = 'public'

  UNION ALL

  -- 4. Constraints
  SELECT 
    'CONSTRAINT'::text AS kind,
    (rel.relname || '.' || con.conname)::text AS object,
    ('type=' || con.contype::text || '|def=' || regexp_replace(pg_get_constraintdef(con.oid), '\s+', ' ', 'g'))::text AS detail
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = con.connamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- 5. Indexes
  SELECT 
    'INDEX'::text AS kind,
    (i.tablename || '.' || i.indexname)::text AS object,
    ('def=' || regexp_replace(i.indexdef, '\s+', ' ', 'g'))::text AS detail
  FROM pg_indexes i
  WHERE i.schemaname = 'public'

  UNION ALL

  -- 6. Functions (Public schema)
  SELECT 
    'FUNCTION'::text AS kind,
    (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text AS object,
    ('returns=' || pg_get_function_result(p.oid) || '|secdef=' || p.prosecdef::text || '|body_md5=' || md5(p.prosrc))::text AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- 7. Table-level Privileges (anon & authenticated)
  SELECT 
    'TABLE_PRIVILEGE'::text AS kind,
    (r.rolname || '.' || c.relname)::text AS object,
    ('select=' || has_table_privilege(r.rolname, c.oid, 'SELECT')::text ||
    '|insert=' || has_table_privilege(r.rolname, c.oid, 'INSERT')::text ||
    '|update=' || has_table_privilege(r.rolname, c.oid, 'UPDATE')::text ||
    '|delete=' || has_table_privilege(r.rolname, c.oid, 'DELETE')::text ||
    '|truncate=' || has_table_privilege(r.rolname, c.oid, 'TRUNCATE')::text)::text AS detail
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (SELECT 'anon' AS rolname UNION ALL SELECT 'authenticated') r
  WHERE n.nspname = 'public' AND c.relkind = 'r'

  UNION ALL

  -- 8. Column-level Privileges (anon & authenticated)
  SELECT 
    'COLUMN_PRIVILEGE'::text AS kind,
    (r.rolname || '.' || c.table_name || '.' || c.column_name)::text AS object,
    ('select=' || has_column_privilege(r.rolname, 'public.' || c.table_name, c.column_name, 'SELECT')::text ||
    '|insert=' || has_column_privilege(r.rolname, 'public.' || c.table_name, c.column_name, 'INSERT')::text ||
    '|update=' || has_column_privilege(r.rolname, 'public.' || c.table_name, c.column_name, 'UPDATE')::text)::text AS detail
  FROM information_schema.columns c
  CROSS JOIN (SELECT 'anon' AS rolname UNION ALL SELECT 'authenticated') r
  WHERE c.table_schema = 'public'

  UNION ALL

  -- 9. Triggers
  SELECT 
    'TRIGGER'::text AS kind,
    (rel.relname || '.' || trg.tgname)::text AS object,
    ('def=' || regexp_replace(pg_get_triggerdef(trg.oid), '\s+', ' ', 'g'))::text AS detail
  FROM pg_trigger trg
  JOIN pg_class rel ON rel.oid = trg.tgrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  WHERE n.nspname = 'public' AND NOT trg.tgisinternal

  UNION ALL

  -- 10. Realtime Publications
  SELECT 
    'PUBLICATION'::text AS kind,
    (pub.pubname || '.' || c.relname)::text AS object,
    'published=true'::text AS detail
  FROM pg_publication_tables pub
  JOIN pg_class c ON c.relname = pub.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE pub.schemaname = 'public'

  UNION ALL

  -- 11. Cron Jobs (non-volatile: jobname, schedule, command, active)
  SELECT 
    'CRON_JOB'::text AS kind,
    j.jobname::text AS object,
    ('schedule=' || j.schedule::text || '|command=' || regexp_replace(j.command, '\s+', ' ', 'g') || '|active=' || j.active::text)::text AS detail
  FROM cron.job j
)
SELECT kind || '|' || object || '|' || detail AS dump_line
FROM catalog_lines
ORDER BY kind, object, detail;
