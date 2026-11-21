import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertStagingEnvironment } from "../src/tests/stagingGuard";

async function runCleanup() {
  console.log("=== STARTING COMPLETE CLEAN SLATE RESET ===");

  assertStagingEnvironment();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const dbUrl = process.env.SUPABASE_DB_URL!;

  if (!dbUrl) {
    throw new Error("Missing SUPABASE_DB_URL in environment.");
  }
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase URL or Service Role Key in environment.");
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const client = await pool.connect();
  try {
    console.log("Connected to staging database. Checking current state...");

    // 1. Log current counts
    const tablesToCheck = [
      "restaurants",
      "restaurant_staff",
      "registration_requests",
      "orders",
      "order_items",
      "payments",
      "cash_shifts",
      "subscriptions",
      "subscription_invoices",
      "menu_items",
      "menu_categories",
      "restaurant_tables",
      "audit_logs",
      "platform_audit_logs",
      "platform_admins",
      "plans",
    ];

    console.log("\n--- PRE-CLEANUP RECORD COUNTS ---");
    for (const tbl of tablesToCheck) {
      try {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${tbl}`);
        console.log(`  ${tbl.padEnd(26)} : ${rows[0].count}`);
      } catch (err: any) {
        console.log(`  ${tbl.padEnd(26)} : (table not found or error: ${err.message})`);
      }
    }

    console.log("\nExecuting safe cascade deletion of restaurant demo data...");

    // 2. Temporarily suspend append-only audit triggers to allow clean truncation
    await client.query(`
      DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON audit_logs;
      DROP TRIGGER IF EXISTS trg_platform_audit_block_mutation ON public.platform_audit_logs;
      DROP TRIGGER IF EXISTS trg_platform_audit_block_truncate ON public.platform_audit_logs;

      ALTER TABLE restaurant_staff DISABLE TRIGGER USER;
      ALTER TABLE orders DISABLE TRIGGER USER;
      ALTER TABLE menu_items DISABLE TRIGGER USER;
      ALTER TABLE restaurants DISABLE TRIGGER USER;

      DELETE FROM audit_logs;
      DELETE FROM platform_audit_logs;
      DELETE FROM online_payment_sessions;
      DELETE FROM payments;
      DELETE FROM order_items;
      DELETE FROM order_status_history;
      DELETE FROM orders;
      DELETE FROM cash_shifts;
      DELETE FROM subscription_invoices;
      DELETE FROM subscriptions;
      DELETE FROM menu_items;
      DELETE FROM menu_categories;
      DELETE FROM restaurant_tables;
      DELETE FROM restaurant_admin_notes;
      DELETE FROM restaurant_invoice_sequences;
      DELETE FROM restaurant_order_sequences;
      DELETE FROM restaurant_staff;
      DELETE FROM registration_requests;
      DELETE FROM rate_limits;
      DELETE FROM restaurants;

      ALTER TABLE restaurant_staff ENABLE TRIGGER USER;
      ALTER TABLE orders ENABLE TRIGGER USER;
      ALTER TABLE menu_items ENABLE TRIGGER USER;
      ALTER TABLE restaurants ENABLE TRIGGER USER;

      CREATE TRIGGER trg_prevent_audit_log_mutation
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_mutation();

      CREATE TRIGGER trg_platform_audit_block_mutation
        BEFORE UPDATE OR DELETE ON public.platform_audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION public.prevent_platform_audit_mutation();

      CREATE TRIGGER trg_platform_audit_block_truncate
        BEFORE TRUNCATE ON public.platform_audit_logs
        FOR EACH STATEMENT
        EXECUTE FUNCTION public.prevent_platform_audit_mutation();
    `);

    console.log("Database tables cleaned. Triggers restored and active.");

    // 3. Clean auth.users (delete all users EXCEPT superadmin@amarmenu.com)
    console.log("\nSyncing auth.users: removing all demo restaurant users...");
    const SUPERADMIN_EMAIL = "superadmin@amarmenu.com";
    const SUPERADMIN_PASSWORD = "SuperAdmin@2026!";

    const { data: userListData, error: listErr } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listErr) {
      throw new Error(`Failed to list auth users: ${listErr.message}`);
    }

    const allUsers = userListData?.users || [];
    let deletedCount = 0;
    let superAdminUser = null;

    for (const u of allUsers) {
      const email = u.email?.toLowerCase();
      if (email === SUPERADMIN_EMAIL.toLowerCase()) {
        superAdminUser = u;
      } else {
        try {
          await adminClient.auth.admin.deleteUser(u.id);
          deletedCount++;
          console.log(`  Deleted auth user: ${email} (${u.id})`);
        } catch (delErr: any) {
          console.warn(`  Failed to delete ${email}: ${delErr.message}`);
        }
      }
    }
    console.log(`Deleted ${deletedCount} non-superadmin auth user(s).`);

    // Ensure Super Admin exists and credentials are valid
    let superAdminUid = superAdminUser?.id;
    if (!superAdminUid) {
      console.log("Super Admin not found in auth.users. Creating fresh account...");
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email: SUPERADMIN_EMAIL,
        password: SUPERADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "System Administrator" },
      });
      if (createErr) throw createErr;
      superAdminUid = created.user.id;
    } else {
      // Ensure password and confirmation
      await adminClient.auth.admin.updateUserById(superAdminUid, {
        password: SUPERADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "System Administrator" },
      });
    }

    // Ensure platform_admins table contains active super_admin record
    await client.query(
      `INSERT INTO platform_admins (auth_user_id, email, full_name, role, is_active, updated_at)
       VALUES ($1, $2, 'System Administrator', 'super_admin', TRUE, NOW())
       ON CONFLICT (email) DO UPDATE SET
         auth_user_id = $1,
         role = 'super_admin',
         is_active = TRUE,
         updated_at = NOW()`,
      [superAdminUid, SUPERADMIN_EMAIL]
    );

    console.log("\n--- POST-CLEANUP RECORD COUNTS ---");
    for (const tbl of tablesToCheck) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${tbl}`);
      console.log(`  ${tbl.padEnd(26)} : ${rows[0].count}`);
    }

    // 4. Test Super Admin login directly
    console.log("\nTesting Super Admin login authentication...");
    const testAuthClient = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });

    const { data: loginData, error: loginErr } = await testAuthClient.auth.signInWithPassword({
      email: SUPERADMIN_EMAIL,
      password: SUPERADMIN_PASSWORD,
    });

    if (loginErr || !loginData.user) {
      throw new Error(`Super Admin login test failed: ${loginErr?.message}`);
    }

    console.log(" Super Admin login SUCCESSFUL!");
    console.log(`   User ID: ${loginData.user.id}`);
    console.log(`   Email: ${loginData.user.email}`);

    // Verify platform admin record via RPC / query
    const { rows: adminCheck } = await client.query(
      `SELECT role, is_active FROM platform_admins WHERE auth_user_id = $1`,
      [loginData.user.id]
    );
    console.log(`   Platform Admin Role: ${adminCheck[0]?.role}, Active: ${adminCheck[0]?.is_active}`);

    const { rows: restCheck } = await client.query(`SELECT COUNT(*)::int AS c FROM restaurants`);
    console.log(`   Total Restaurants in Database: ${restCheck[0].c}`);

    console.log("\n=======================================================");
    console.log(" DATABASE RESET TO CLEAN SLATE COMPLETED SUCCESSFULLY!");
    console.log(" Restaurants: 0");
    console.log(" Super Admin is intact and verified.");
    console.log(" You can now register new restaurants from scratch!");
    console.log("=======================================================\n");
  } finally {
    client.release();
    await pool.end();
  }
}

runCleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
