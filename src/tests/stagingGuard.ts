import fs from "fs";
import path from "path";

/**
 * Strict Staging Guard for AmarMenu Test Suite and Database Seeds
 * Prevents accidental execution against production databases or misconfigured environments.
 */

export function loadEnvStaging(envFilePath?: string): Record<string, string> {
  const filePath = envFilePath || path.resolve(process.cwd(), ".env.staging");
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[SECURITY FATAL] .env.staging file not found at: ${filePath}. Tests refuse to run without explicit staging configuration.`
    );
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const parsed: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
    // Explicitly override in process.env so tests strictly use .env.staging
    process.env[key] = val;
  }

  return parsed;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT token format");
    }
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(jsonStr);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[SECURITY FATAL] Failed to decode token payload: ${msg}`);
  }
}

export function assertStagingEnvironment(customEnvPath?: string): void {
  // 1. Explicitly load .env.staging
  loadEnvStaging(customEnvPath);

  // 2. STAGING_PROJECT_REF must be explicitly set
  const stagingProjectRef = process.env.STAGING_PROJECT_REF;
  if (!stagingProjectRef || !stagingProjectRef.trim()) {
    throw new Error(
      "[SECURITY FATAL] STAGING_PROJECT_REF must be set in .env.staging. Tests refuse to run without an explicit staging ref."
    );
  }

  // 3. BLOCKED_PROJECT_REFS must be explicitly set in environment or .env.staging
  const blockedRefsEnv = process.env.BLOCKED_PROJECT_REFS;
  if (!blockedRefsEnv || !blockedRefsEnv.trim()) {
    throw new Error(
      "[SECURITY FATAL] BLOCKED_PROJECT_REFS must be set in environment. Tests refuse to run without an explicit blocked list."
    );
  }

  const blockedRefs = blockedRefsEnv
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  // Check if staging ref itself is blocked
  if (blockedRefs.includes(stagingProjectRef.toLowerCase())) {
    throw new Error(
      `[SECURITY FATAL] Target staging ref '${stagingProjectRef}' is listed in BLOCKED_PROJECT_REFS! Immediate abort.`
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("[SECURITY FATAL] Missing SUPABASE_URL in staging environment.");
  }

  // 4. Require exact host <ref>.supabase.co
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(`[SECURITY FATAL] Malformed SUPABASE_URL: ${supabaseUrl}`);
  }

  const expectedHost = `${stagingProjectRef}.supabase.co`;
  if (parsedUrl.host !== expectedHost) {
    throw new Error(
      `[SECURITY FATAL] SUPABASE_URL host '${parsedUrl.host}' does not equal expected host '${expectedHost}' exactly!`
    );
  }

  // Check URL host against blocked refs
  for (const blocked of blockedRefs) {
    if (parsedUrl.host.toLowerCase().includes(blocked)) {
      throw new Error(
        `[SECURITY FATAL] SUPABASE_URL host contains blocked ref '${blocked}'! Immediate abort.`
      );
    }
  }

  // 5. Check SUPABASE_DB_URL host / username
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error("[SECURITY FATAL] Missing SUPABASE_DB_URL in staging environment.");
  }

  if (!dbUrl.includes(stagingProjectRef)) {
    throw new Error(
      `[SECURITY FATAL] SUPABASE_DB_URL does not reference staging project ref '${stagingProjectRef}'!`
    );
  }

  // 6. Decode service-role key or anon key and verify its "ref" claim matches stagingProjectRef
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SECRET_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY;
  }
  if (!process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_PUBLISHABLE_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  }

  const jwtKey = [
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  ].find((k) => k && k.split(".").length === 3);

  if (jwtKey) {
    const payload = decodeJwtPayload(jwtKey);
    const tokenRef = payload.ref as string;

    if (!tokenRef) {
      throw new Error("[SECURITY FATAL] Provided JWT token does not contain a 'ref' claim.");
    }

    if (tokenRef !== stagingProjectRef) {
      throw new Error(
        `[SECURITY FATAL] JWT token ref '${tokenRef}' does not match staging ref '${stagingProjectRef}'!`
      );
    }

    if (blockedRefs.includes(tokenRef.toLowerCase())) {
      throw new Error(
        `[SECURITY FATAL] JWT token ref '${tokenRef}' is listed in BLOCKED_PROJECT_REFS! Immediate abort.`
      );
    }
  }
}

// Automatically enforce on import
assertStagingEnvironment();
