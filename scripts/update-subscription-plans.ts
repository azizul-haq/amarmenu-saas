import pg from "pg";
import { assertStagingEnvironment } from "../src/tests/stagingGuard";

async function updatePlans() {
  console.log("=== UPDATING SUBSCRIPTION PLANS IN STAGING DATABASE ===");

  assertStagingEnvironment();

  const dbUrl = process.env.SUPABASE_DB_URL!;
  if (!dbUrl) {
    throw new Error("Missing SUPABASE_DB_URL in environment.");
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  try {
    const plansData = [
      {
        name: "starter",
        display_name: "Starter",
        description: "Ideal for small cafes, fast food shops, and food carts.",
        price_monthly: 1499.0,
        price_yearly: 14388.0,
        max_tables: 15,
        max_staff: 3,
        features: [
          "Up to 15 tables & 3 staff accounts",
          "Bilingual QR Menu (Bangla & English)",
          "Live Order Management & Printable Receipts",
          "Cash, bKash, Nagad & Card (SSLCommerz) Checkout",
          "Daily Sales Summary",
          "Email Support",
        ],
      },
      {
        name: "growth",
        display_name: "Growth",
        description: "Full features for dine-in restaurants, biryani houses, and busy eateries.",
        price_monthly: 2999.0,
        price_yearly: 28788.0,
        max_tables: null,
        max_staff: 10,
        features: [
          "Unlimited tables & up to 10 staff accounts",
          "Everything in Starter (including bKash, Nagad & SSLCommerz)",
          "Real-time Kitchen Display (KDS)",
          "Waiter & Cashier POS Mode",
          "NBR Mushak-6.3 VAT Receipts & Reports",
          "Cashier Shift Management & Z-Report",
        ],
      },
      {
        name: "enterprise",
        display_name: "Enterprise",
        description: "Advanced multi-branch chain and cloud kitchen operations.",
        price_monthly: 5999.0,
        price_yearly: 57588.0,
        max_tables: null,
        max_staff: null,
        features: [
          "Unlimited tables & unlimited staff",
          "Everything in Growth plan (all payment channels included)",
          "Manager PIN Void & Fraud Protection",
          "Tamper-Proof Security Audit Logs",
          "Advanced Analytics & CSV Exports",
          "Priority Onboarding & 24/7 Support",
        ],
      },
    ];

    for (const plan of plansData) {
      console.log(`Updating plan: ${plan.display_name} (${plan.name})...`);
      const { rows } = await client.query(
        `INSERT INTO plans (name, display_name, description, price_monthly, price_yearly, max_tables, max_staff, features, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, TRUE)
         ON CONFLICT (name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           price_monthly = EXCLUDED.price_monthly,
           price_yearly = EXCLUDED.price_yearly,
           max_tables = EXCLUDED.max_tables,
           max_staff = EXCLUDED.max_staff,
           features = EXCLUDED.features,
           is_active = TRUE
         RETURNING id, name, display_name, price_monthly, features`,
        [
          plan.name,
          plan.display_name,
          plan.description,
          plan.price_monthly,
          plan.price_yearly,
          plan.max_tables,
          plan.max_staff,
          JSON.stringify(plan.features),
        ]
      );
      console.log(`  Updated ${rows[0].display_name}: ৳${rows[0].price_monthly}/mo with ${rows[0].features.length} features.`);
    }

    console.log("\n--- VERIFYING CURRENT PLANS IN DATABASE ---");
    const { rows: allPlans } = await client.query(
      `SELECT name, display_name, price_monthly, max_tables, max_staff, features FROM plans ORDER BY price_monthly ASC`
    );
    for (const p of allPlans) {
      console.log(`\n• ${p.display_name} (৳${p.price_monthly}/mo):`);
      for (const f of p.features) {
        console.log(`   - ${f}`);
      }
    }

    console.log("\n=======================================================");
    console.log(" SUBSCRIPTION PLANS UPDATED SUCCESSFULLY IN DATABASE!");
    console.log("=======================================================\n");
  } finally {
    client.release();
    await pool.end();
  }
}

updatePlans().catch((err) => {
  console.error("Plan update failed:", err);
  process.exit(1);
});
