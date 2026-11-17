import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../config/config";

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres.djpyapgqqbdgdbqktabx:NaVvC2VBQiO8wMVW@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

// Reuse pool across test calls for sub-100ms query performance
const dbPool = new pg.Pool({
  connectionString: DB_URL,
  max: 5,
  idleTimeoutMillis: 30000,
});

export interface ServiceRoleRpcResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
}

export interface ServiceRoleClientInterface {
  rpc: <T = unknown>(
    funcName: string,
    params?: Record<string, unknown>
  ) => Promise<ServiceRoleRpcResult<T>>;
  query: <R = unknown>(sql: string, params?: unknown[]) => Promise<R[]>;
  adminQuery: <R = unknown>(sql: string, params?: unknown[]) => Promise<R[]>;
}

export function getServiceRoleClient(): ServiceRoleClientInterface {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (serviceKey) {
    const supabase = createClient(SUPABASE_URL, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return {
      async rpc<T = unknown>(
        funcName: string,
        params: Record<string, unknown> = {}
      ) {
        const { data, error } = await supabase.rpc(funcName, params);
        if (error) {
          return {
            data: null,
            error: {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
            },
          };
        }
        return { data: data as T, error: null };
      },
      async query<R = unknown>(sql: string, params: unknown[] = []) {
        const client = await dbPool.connect();
        try {
          await client.query("SET ROLE service_role;");
          const res = await client.query(sql, params);
          return res.rows as R[];
        } finally {
          await client.query("RESET ROLE;");
          client.release();
        }
      },
      async adminQuery<R = unknown>(sql: string, params: unknown[] = []) {
        const client = await dbPool.connect();
        try {
          const res = await client.query(sql, params);
          return res.rows as R[];
        } finally {
          client.release();
        }
      },
    };
  }

  // Direct PostgreSQL execution as authoritative database role 'service_role'
  return {
    async rpc<T = unknown>(
      funcName: string,
      params: Record<string, unknown> = {}
    ) {
      const client = await dbPool.connect();
      try {
        await client.query("SET ROLE service_role;");
        const keys = Object.keys(params);
        const argsList = keys.map((_, i) => `$${i + 1}`).join(", ");
        const values = keys.map((k) => {
          const val = params[k];
          return val !== null && typeof val === "object"
            ? JSON.stringify(val)
            : val;
        });
        const queryText = `SELECT ${funcName}(${argsList}) AS result;`;
        const res = await client.query(queryText, values);
        return { data: res.rows[0]?.result as T, error: null };
      } catch (err: unknown) {
        const error = err as {
          message: string;
          code?: string;
          detail?: string;
          hint?: string;
        };
        return {
          data: null,
          error: {
            message: error.message,
            code: error.code,
            details: error.detail,
            hint: error.hint,
          },
        };
      } finally {
        await client.query("RESET ROLE;");
        client.release();
      }
    },
    async query<R = unknown>(sql: string, params: unknown[] = []) {
      const client = await dbPool.connect();
      try {
        await client.query("SET ROLE service_role;");
        const res = await client.query(sql, params);
        return res.rows as R[];
      } finally {
        await client.query("RESET ROLE;");
        client.release();
      }
    },
    async adminQuery<R = unknown>(sql: string, params: unknown[] = []) {
      const client = await dbPool.connect();
      try {
        const res = await client.query(sql, params);
        return res.rows as R[];
      } finally {
        client.release();
      }
    },
  };
}
