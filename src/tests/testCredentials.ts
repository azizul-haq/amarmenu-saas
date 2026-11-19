import fs from "fs";
import path from "path";

export interface StagingCredentialsFile {
  super_admin: { email: string; password: string };
  manager_pin: string;
  restaurant_a: {
    id: string;
    slug: string;
    owner: { email: string; password: string };
    manager: { email: string; password: string };
    cashier: { email: string; password: string };
    kitchen: { email: string; password: string };
    waiter: { email: string; password: string };
  };
  restaurant_b: {
    id: string;
    slug: string;
    owner: { email: string; password: string };
  };
}

let cachedCreds: StagingCredentialsFile | null = null;

export function getTestCredentials(): StagingCredentialsFile {
  if (cachedCreds) return cachedCreds;

  const credsPath = path.resolve(process.cwd(), ".staging-credentials.json");
  if (fs.existsSync(credsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      cachedCreds = data;
      return cachedCreds!;
    } catch {
      // fallback
    }
  }

  // Safe fallback structure if file not yet written
  const defaultPw = process.env.TEST_USER_PASSWORD || "password123";
  const superAdminEmail = (process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@amarmenu.com").trim().toLowerCase();

  return {
    super_admin: { email: superAdminEmail, password: defaultPw },
    manager_pin: "4827",
    restaurant_a: {
      id: "",
      slug: "demo-restaurant",
      owner: { email: "owner@demo.example.com", password: defaultPw },
      manager: { email: "manager@demo.example.com", password: defaultPw },
      cashier: { email: "cashier@demo.example.com", password: defaultPw },
      kitchen: { email: "kitchen@demo.example.com", password: defaultPw },
      waiter: { email: "waiter@demo.example.com", password: defaultPw },
    },
    restaurant_b: {
      id: "",
      slug: "dhanmondi-treat",
      owner: { email: "owner@restaurant-b.example.com", password: defaultPw },
    },
  };
}
