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
    let unwrappedMessage = fnError.message;

    // Supabase FunctionsHttpError attaches the fetch Response object on `context`
    if (fnError.context) {
      try {
        if (typeof fnError.context.json === "function") {
          const bodyJson = await fnError.context.json();
          if (bodyJson?.error) {
            unwrappedMessage = bodyJson.error;
          } else if (bodyJson?.message) {
            unwrappedMessage = bodyJson.message;
          }
        } else if (typeof fnError.context.text === "function") {
          const text = await fnError.context.text();
          try {
            const bodyJson = JSON.parse(text);
            if (bodyJson?.error) unwrappedMessage = bodyJson.error;
            else if (bodyJson?.message) unwrappedMessage = bodyJson.message;
          } catch {
            if (text) unwrappedMessage = text;
          }
        }
      } catch {
        // Fallback to error message
      }
    }

    if (unwrappedMessage === "Edge Function returned a non-2xx status code") {
      unwrappedMessage = "Operation failed on server. Please check your input and try again.";
    }

    throw new Error(unwrappedMessage);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}
