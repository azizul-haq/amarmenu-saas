import crypto from "crypto";
import { Pool } from "pg";
import { assertStagingEnvironment } from "../src/tests/stagingGuard";

/**
 * AmarMenu Staging Database Seed Script
 * Strictly guarded to run only against the designated Supabase Staging environment.
 */

// 1. Enforce Staging Guard
assertStagingEnvironment();

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  throw new Error("SUPABASE_DB_URL must be defined in .env.staging");
}

const pool = new Pool({
  connectionString: DB_URL,
  max: 5,
});

function generatePassword(length = 12): string {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  let pwd = "";
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return pwd;
}

export async function seedStaging() {
  console.log(`=======================================================`);
  console.log(` Starting AmarMenu Staging Seed`);
  console.log(` Target Ref: ${process.env.STAGING_PROJECT_REF}`);
  console.log(`=======================================================\n`);

  const client = await pool.connect();
  const credentials: Record<string, string> = {};

  try {
    // 2. Check if staging is already seeded
    const existingRest = await client.query(
      `SELECT id, name FROM restaurants WHERE slug = 'staging-demo' LIMIT 1`
    );

    if (existingRest.rows.length > 0) {
      console.log(`[INFO] Staging Demo Restaurant ('staging-demo') is already seeded.`);
      console.log(`Restaurant ID: ${existingRest.rows[0].id}`);
      console.log(`Refusing re-seed to prevent overwriting staging state. Run with clean staging to re-seed.`);
      return { seeded: false, restaurantId: existingRest.rows[0].id };
    }

    await client.query("BEGIN;");

    // 3. Super Admin in platform_admins
    console.log(`[1/6] Seeding Super Admin in platform_admins...`);
    const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@amarmenu.com";
    const superAdminPassword = generatePassword(14);
    credentials["super_admin"] = superAdminPassword;
    await client.query(
      `INSERT INTO platform_admins (full_name, email, role, is_active)
       VALUES ('Platform Super Admin', $1, 'super_admin', true)
       ON CONFLICT (email) DO NOTHING;`,
      [superAdminEmail]
    );

    // 4. Demo Restaurant
    console.log(`[2/6] Seeding Staging Demo Restaurant (VAT unit: 5.00%)...`);
    const restRes = await client.query(
      `INSERT INTO restaurants (
         name, name_bn, slug, phone, email,
         address, vat_bin_no, trade_license_no,
         default_vat_rate, subscription_plan,
         status, is_active, currency, currency_symbol
       ) VALUES (
         'AmarMenu Staging Demo', 'আমারমেনু স্টেজ ডেমো', 'staging-demo', '+8801711000000', 'staging-demo@amarmenu.com',
         'House 12, Road 4, Dhanmondi, Dhaka-1205', 'BIN-123456789-001', 'TRAD/DN/2026/00918',
         5.00, 'growth',
         'active', true, 'BDT', '৳'
       ) RETURNING id;`
    );
    const restaurantId = restRes.rows[0].id;

    // 5. 20 Restaurant Tables
    console.log(`[3/6] Seeding 20 Dine-In Tables with secure QR tokens...`);
    for (let i = 1; i <= 20; i++) {
      const tableNo = i.toString();
      const qrToken = `STG-TBL-${i.toString().padStart(2, "0")}-${crypto.randomBytes(4).toString("hex")}`;
      await client.query(
        `INSERT INTO restaurant_tables (
           restaurant_id, table_number, capacity, qr_token, status, is_active
         ) VALUES ($1, $2, $3, $4, 'available', true);`,
        [restaurantId, tableNo, i <= 10 ? 4 : 6, qrToken]
      );
    }

    // 6. 3 Categories (Bilingual)
    console.log(`[4/6] Seeding 3 Bilingual Categories...`);
    const catRes = await client.query(
      `INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order, is_active)
       VALUES 
         ($1, 'Starters', 'স্টার্টার', 1, true),
         ($1, 'Main Course', 'প্রধান খাবার', 2, true),
         ($1, 'Beverages & Desserts', 'পানীয় ও ডেজার্ট', 3, true)
       RETURNING id, name;`,
      [restaurantId]
    );

    const catMap: Record<string, string> = {};
    for (const row of catRes.rows) {
      catMap[row.name] = row.id;
    }

    // 7. 10 Bilingual Menu Items (with sizes/addons, 1 out of stock)
    console.log(`[5/6] Seeding 10 Bilingual Menu Items (including sizes/addons and 1 out-of-stock item)...`);
    const items = [
      {
        cat: "Main Course",
        name: "Beef Kacchi Biryani",
        name_bn: "বিফ কাচ্চি বিরিয়ানি",
        desc: "Fragrant Chinigura rice cooked with marinated tender beef chunks and potatoes.",
        price: 350.0,
        sizes: [
          { name: "Half", price: 250.0 },
          { name: "Full", price: 350.0 },
        ],
        addons: [
          { name: "Extra Borhani", price: 50.0 },
          { name: "Extra Egg", price: 20.0 },
        ],
        available: true,
      },
      {
        cat: "Main Course",
        name: "Chicken Roast",
        name_bn: "মুরগির রোস্ট",
        desc: "Traditional Bengali wedding-style tender chicken roast in rich caramelized onion gravy.",
        price: 150.0,
        available: true,
      },
      {
        cat: "Main Course",
        name: "Plain Polao",
        name_bn: "সাদা পোলাও",
        desc: "Aromatic ghee-infused Chinigura rice polao with whole spices.",
        price: 120.0,
        available: true,
      },
      {
        cat: "Main Course",
        name: "Morog Polao",
        name_bn: "মোরগ পোলাও",
        desc: "Traditional Dhaka style spiced chicken buried in fragrant rice.",
        price: 280.0,
        available: true,
      },
      {
        cat: "Starters",
        name: "Shami Kebab",
        name_bn: "শামী কাবাব",
        desc: "Finely minced beef and lentil patties pan-fried with whole spices (2 pcs).",
        price: 80.0,
        available: true,
      },
      {
        cat: "Starters",
        name: "Chicken Wings",
        name_bn: "চিকেন উইংস",
        desc: "Crispy coated spicy chicken wings glazed in garlic chili sauce (6 pcs).",
        price: 180.0,
        available: true,
      },
      {
        cat: "Beverages & Desserts",
        name: "Special Borhani",
        name_bn: "স্পেশাল বোরহানী",
        desc: "Traditional savory yogurt drink blended with mint, coriander, and black mustard.",
        price: 60.0,
        sizes: [
          { name: "Glass (250ml)", price: 40.0 },
          { name: "Bottle (500ml)", price: 60.0 },
        ],
        available: true,
      },
      {
        cat: "Beverages & Desserts",
        name: "Sweet Laban",
        name_bn: "মিষ্টি লাবাং",
        desc: "Refreshing lightly salted yogurt drink served chilled.",
        price: 70.0,
        available: true,
      },
      {
        cat: "Beverages & Desserts",
        name: "Shahi Firni",
        name_bn: "শাহী ফিরনি",
        desc: "Slow-cooked creamy ground rice pudding topped with pistachios and saffron.",
        price: 80.0,
        available: true,
      },
      {
        cat: "Beverages & Desserts",
        name: "Royal Faluda",
        name_bn: "রয়্যাল ফালুদা",
        desc: "Layered rose syrup, vermicelli, sabja seeds, and premium kulfi ice cream.",
        price: 160.0,
        available: false, // OUT OF STOCK ITEM
      },
    ];

    for (const item of items) {
      await client.query(
        `INSERT INTO menu_items (
           restaurant_id, category_id, name, name_bn, description,
           base_price, sizes, addons, is_available
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        [
          restaurantId,
          catMap[item.cat],
          item.name,
          item.name_bn,
          item.desc,
          item.price,
          item.sizes ? JSON.stringify(item.sizes) : null,
          item.addons ? JSON.stringify(item.addons) : null,
          item.available,
        ]
      );
    }

    // 8. Staff Users (1 per role: owner, manager, cashier, kitchen, waiter)
    console.log(`[6/6] Seeding Staff accounts for all 5 roles...`);
    const roles = ["owner", "manager", "cashier", "kitchen", "waiter"] as const;

    // Temporarily bypass trigger for clean initial seed
    await client.query(`ALTER TABLE restaurant_staff DISABLE TRIGGER USER;`);

    for (const role of roles) {
      const email = `staging.${role}@amarmenu.com`;
      const phone = `+880170000000${roles.indexOf(role) + 1}`;
      const password = generatePassword(12);
      credentials[role] = password;

      await client.query(
        `INSERT INTO restaurant_staff (
           restaurant_id, full_name, email, phone, role, is_active
         ) VALUES ($1, $2, $3, $4, $5, true);`,
        [restaurantId, `Staging ${role.charAt(0).toUpperCase() + role.slice(1)}`, email, phone, role]
      );
    }

    await client.query(`ALTER TABLE restaurant_staff ENABLE TRIGGER USER;`);

    await client.query("COMMIT;");

    console.log(`\n=======================================================`);
    console.log(` STAGING SEED COMPLETE!`);
    console.log(` Restaurant ID: ${restaurantId}`);
    console.log(` Slug: staging-demo`);
    console.log(` VAT Rate: 5.00%`);
    console.log(` Tables: 20 seeded`);
    console.log(` Menu Items: 10 seeded (9 active, 1 out of stock)`);
    console.log(`-------------------------------------------------------`);
    console.log(` GENERATED PASSWORDS (PRINTED ONCE):`);
    console.log(`   super_admin: ${superAdminEmail} | ${credentials["super_admin"]}`);
    for (const role of roles) {
      console.log(`   ${role.padEnd(8)}: staging.${role}@amarmenu.com | ${credentials[role]}`);
    }
    console.log(`=======================================================\n`);

    return { seeded: true, restaurantId, credentials };
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("[FATAL] Staging seed failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.includes("seed-staging")) {
  seedStaging()
    .then(() => pool.end())
    .catch(() => {
      pool.end();
      process.exit(1);
    });
}
