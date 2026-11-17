import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimulatePaymentPayload {
  action?: "complete" | "fail";
  session_id: string;
  gateway_trx_id?: string;
  val_id?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Strict Environment Guard: BOTH ENABLE_PAYMENT_SIMULATOR === 'true' AND APP_ENV !== 'production'
    const enableSimulator = Deno.env.get("ENABLE_PAYMENT_SIMULATOR");
    const appEnv = Deno.env.get("APP_ENV");

    if (enableSimulator !== "true" || appEnv === "production") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Payment simulator is disabled in production environments",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase server configuration");
    }

    const body: SimulatePaymentPayload = await req.json();
    const { action = "complete", session_id, gateway_trx_id, val_id, reason, payload } = body;

    if (!session_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Session ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Initialize Supabase Admin using SERVICE_ROLE_KEY
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "fail") {
      const { data, error } = await supabaseAdmin.rpc("fail_online_payment", {
        p_session_id: session_id,
        p_reason: reason || "User cancelled payment in simulator",
      });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default: action === "complete"
    const { data, error } = await supabaseAdmin.rpc("complete_online_payment", {
      p_session_id: session_id,
      p_gateway_trx_id: gateway_trx_id || `TRX-SIM-${Date.now()}`,
      p_val_id: val_id || null,
      p_payload: payload || {},
    });

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal simulation error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
