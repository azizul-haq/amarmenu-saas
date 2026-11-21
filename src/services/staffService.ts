import { supabase } from "../config/supabase";

export interface StaffActionPayload {
  action?: "invite" | "create" | "update" | "toggle_active" | "reset_password" | "delete";
  staff_id?: string;
  restaurant_id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: string;
  is_active?: boolean;
}

/**
 * Invokes the staff management edge function with explicit Authorization headers
 * and unwraps the real JSON error message from the response if a non-2xx status code occurs.
 */
export async function invokeStaffAction(payload: StaffActionPayload): Promise<any> {
  // Get active session token (sessionStorage aware)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const { data, error: fnError } = await supabase.functions.invoke("invite-staff", {
    headers,
    body: payload,
  });

  if (fnError) {
    let unwrappedMessage = "";

    // Supabase FunctionsHttpError attaches the fetch Response object on `context`
    if (fnError.context) {
      try {
        const resp = typeof fnError.context.clone === "function" ? fnError.context.clone() : fnError.context;
        // Try reading JSON first
        try {
          const bodyJson = await resp.json();
          if (bodyJson && typeof bodyJson === "object") {
            unwrappedMessage = bodyJson.error || bodyJson.message || bodyJson.msg || "";
          }
        } catch {
          // If JSON parse fails, try reading text
          try {
            const resp2 = typeof fnError.context.clone === "function" ? fnError.context.clone() : fnError.context;
            const text = await resp2.text();
            if (text) {
              try {
                const parsed = JSON.parse(text);
                unwrappedMessage = parsed.error || parsed.message || parsed.msg || text;
              } catch {
                unwrappedMessage = text;
              }
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // Fallback to error message
      }
    }

    if (!unwrappedMessage || unwrappedMessage === "Edge Function returned a non-2xx status code") {
      unwrappedMessage =
        fnError.message && fnError.message !== "Edge Function returned a non-2xx status code"
          ? fnError.message
          : "Failed to process staff operation. Please check your inputs and try again.";
    }

    throw new Error(unwrappedMessage);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}
