import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function grantBase() {
  await pool.query(`
    GRANT SELECT ON public.restaurant_staff TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items, public.menu_categories, public.restaurant_tables TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.orders, public.order_items, public.order_status_history TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.payments, public.cash_shifts, public.audit_logs TO authenticated;
    GRANT SELECT ON public.plans, public.subscriptions, public.subscription_invoices, public.role_permissions TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins, public.registration_requests TO authenticated;
  `);
  console.log("Successfully granted authenticated base table privileges");
  await pool.end();
}

grantBase().catch((e) => {
  console.error("Fatal:", e);
  pool.end();
});
