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
    } catch (e) {
      throw new Error(`Failed to parse .staging-credentials.json: ${(e as Error).message}`);
    }
  }

  throw new Error(
    "[SECURITY FATAL] .staging-credentials.json does not exist. Run the seed script ('npx tsx supabase/seed-staging/seed.ts') first to generate random staging credentials."
  );
}
