import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../config/supabase";
import type { Restaurant, RestaurantStaff, PlatformAdmin } from "../config/supabase";

export type UserRole = "super_admin" | "owner" | "manager" | "cashier" | "kitchen" | "waiter" | null;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: [
    "view_reports",
    "edit_menu",
    "delete_menu",
    "toggle_availability",
    "confirm_order",
    "update_kitchen_status",
    "settle_bill",
    "apply_discount",
    "void_order",
    "void_settled_bill",
    "manage_shifts",
    "manage_staff",
    "change_settings",
    "manage_subscription",
    "view_financials",
    "view_order_financials",
  ],
  manager: [
    "view_reports",
    "edit_menu",
    "toggle_availability",
    "confirm_order",
    "update_kitchen_status",
    "settle_bill",
    "apply_discount",
    "void_order",
    "manage_shifts",
    "view_financials",
    "view_order_financials",
  ],
  cashier: [
    "confirm_order",
    "settle_bill",
    "manage_shifts",
    "view_order_financials",
  ],
  kitchen: [
    "update_kitchen_status",
    "toggle_availability",
  ],
  waiter: [
    "confirm_order",
    "toggle_availability",
  ],
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: RestaurantStaff | null;
  platformAdmin: PlatformAdmin | null;
  role: UserRole;
  restaurantId: string | null;
  restaurant: Restaurant | null;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  loading: boolean;
  mustChangePassword: boolean;
  signIn: (identifier: string, password: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Safely parse JSON strictly from sessionStorage (tab-isolated); purges corrupted items on error
function safeStorageGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw === "undefined" || raw === "null") return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`Purging corrupted storage item for "${key}":`, err);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

// Safely remove all cached auth state
function safeClearAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("admin");
    sessionStorage.removeItem("current_restaurant");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("permissions");
    localStorage.removeItem("user");
    localStorage.removeItem("admin");
    localStorage.removeItem("current_restaurant");
    localStorage.removeItem("role");
    localStorage.removeItem("permissions");
  } catch {
    // ignore
  }
}

// Synchronously read stored session cache on mount so that initial render has profile & role
const getStoredAuthState = () => {
  const parsedUser = safeStorageGet<RestaurantStaff>("user");
  const parsedAdmin = safeStorageGet<PlatformAdmin>("admin");
  const parsedRest = safeStorageGet<Restaurant>("current_restaurant");
  const rawRole = safeStorageGet<string>("role") || parsedUser?.role || "";

  let initialRole: UserRole = null;
  if (parsedAdmin) initialRole = "super_admin";
  else if (rawRole) initialRole = rawRole.toLowerCase().trim() as UserRole;

  const cachedPerms = safeStorageGet<string[]>("permissions");
  const initialPermissions: string[] =
    cachedPerms && Array.isArray(cachedPerms) && cachedPerms.length > 0
      ? cachedPerms
      : initialRole && DEFAULT_ROLE_PERMISSIONS[initialRole]
      ? DEFAULT_ROLE_PERMISSIONS[initialRole]
      : [];

  return {
    profile: parsedUser,
    admin: parsedAdmin,
    role: initialRole,
    restaurant: parsedRest,
    restaurantId: (parsedRest?.id || parsedUser?.restaurant_id || null) as string | null,
    permissions: initialPermissions,
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialCache = getStoredAuthState();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<RestaurantStaff | null>(initialCache.profile);
  const [platformAdmin, setPlatformAdmin] = useState<PlatformAdmin | null>(initialCache.admin);
  const [role, setRole] = useState<UserRole>(initialCache.role);
  const [restaurantId, setRestaurantId] = useState<string | null>(initialCache.restaurantId);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(initialCache.restaurant);
  const [permissions, setPermissions] = useState<string[]>(initialCache.permissions);
  const [loading, setLoading] = useState<boolean>(true);

  const isBootDoneRef = useRef(false);

  // Load user profile & role from the database with multi-layer fallbacks
  const loadUserProfile = useCallback(async (currentUser: User): Promise<{
    role: UserRole;
    restaurant: Restaurant | null;
    restaurantId: string | null;
  }> => {
    try {
      // 1. Check if user is a platform admin (Super Admin)
      let adminData: PlatformAdmin | null = null;
      try {
        const { data: admAuth } = await supabase
          .from("platform_admins")
          .select("*")
          .eq("auth_user_id", currentUser.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (admAuth) {
          adminData = admAuth as PlatformAdmin;
        } else if (currentUser.email) {
          const { data: admEmail } = await supabase
            .from("platform_admins")
            .select("*")
            .ilike("email", currentUser.email.trim())
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (admEmail) adminData = admEmail as PlatformAdmin;
        }
      } catch (adminErr) {
        console.warn("Failed checking platform_admins:", adminErr);
      }

      if (adminData) {
        setPlatformAdmin(adminData);
        setRole("super_admin");
        setProfile(null);
        setRestaurantId(null);
        setRestaurant(null);

        try {
          sessionStorage.setItem("admin", JSON.stringify(adminData));
          sessionStorage.setItem("role", "super_admin");
        } catch {
          // ignore
        }

        // Super Admin gets all permissions dynamically from role_permissions
        try {
          const { data: allPerms } = await supabase
            .from("role_permissions")
            .select("permission");
          const uniquePerms = Array.from(
            new Set((allPerms || []).map((p: { permission: string }) => p.permission))
          );
          setPermissions(uniquePerms);
        } catch {
          // fallback
        }

        return { role: "super_admin", restaurant: null, restaurantId: null };
      }

      // 2. Check if user is a restaurant staff member (Owner, Manager, Cashier, Kitchen, Waiter)
      let staffData: RestaurantStaff | null = null;

      // 2a. Match by auth_user_id first (most direct & secure)
      if (currentUser.id) {
        try {
          const { data: sByAuth } = await supabase
            .from("restaurant_staff")
            .select("id, auth_user_id, restaurant_id, full_name, phone, email, role, is_active, created_at, updated_at")
            .eq("auth_user_id", currentUser.id)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (sByAuth) {
            staffData = sByAuth as RestaurantStaff;
          }
        } catch (e) {
          console.warn("Error finding staff by auth_user_id:", e);
        }
      }

      // 2b. Fallback: match by email and self-heal auth_user_id link
      if (!staffData && currentUser.email) {
        try {
          const { data: sByEmail } = await supabase
            .from("restaurant_staff")
            .select("id, auth_user_id, restaurant_id, full_name, phone, email, role, is_active, created_at, updated_at")
            .ilike("email", currentUser.email.trim())
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (sByEmail) {
            staffData = sByEmail as RestaurantStaff;
            // Self-heal auth_user_id link if missing
            if (!sByEmail.auth_user_id) {
              await supabase
                .from("restaurant_staff")
                .update({ auth_user_id: currentUser.id })
                .eq("id", sByEmail.id);
            }
          }
        } catch (e) {
          console.warn("Error finding staff by email:", e);
        }
      }

      // 2c. Fallback: check app_metadata
      const metaRole = (currentUser.app_metadata?.role as UserRole) || null;
      const metaRestaurantId = (currentUser.app_metadata?.restaurant_id as string) || null;

      if (staffData || (metaRole && metaRestaurantId)) {
        const rawRole = staffData?.role || metaRole;
        const effectiveRole = (rawRole ? String(rawRole).toLowerCase().trim() : null) as UserRole;
        const effectiveRestaurantId = staffData?.restaurant_id || metaRestaurantId;

        const staffObj = staffData || ({
          id: currentUser.id,
          auth_user_id: currentUser.id,
          restaurant_id: effectiveRestaurantId!,
          full_name: (currentUser.user_metadata?.full_name as string) || currentUser.email || "Staff Member",
          phone: (currentUser.user_metadata?.phone as string) || null,
          email: currentUser.email || null,
          role: effectiveRole as any,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as RestaurantStaff);

        setProfile(staffObj);
        setRole(effectiveRole);
        setRestaurantId(effectiveRestaurantId);
        setPlatformAdmin(null);

        try {
          sessionStorage.setItem("user", JSON.stringify({ ...staffObj, restaurant_id: effectiveRestaurantId }));
          sessionStorage.setItem("role", effectiveRole || "");
        } catch {
          // ignore
        }

        // Fetch dynamic permissions for this role from the database with reliable fallback
        if (effectiveRole) {
          try {
            const { data: permData, error: permErr } = await supabase
              .from("role_permissions")
              .select("permission")
              .eq("role", effectiveRole);

            if (!permErr && permData && permData.length > 0) {
              const rolePerms = permData.map((p: { permission: string }) => p.permission);
              setPermissions(rolePerms);
              try {
                sessionStorage.setItem("permissions", JSON.stringify(rolePerms));
              } catch {
                // ignore
              }
            } else if (DEFAULT_ROLE_PERMISSIONS[effectiveRole]) {
              const fallbackPerms = DEFAULT_ROLE_PERMISSIONS[effectiveRole];
              setPermissions(fallbackPerms);
              try {
                sessionStorage.setItem("permissions", JSON.stringify(fallbackPerms));
              } catch {
                // ignore
              }
            }
          } catch (pErr) {
            console.warn("Failed fetching role permissions:", pErr);
            if (DEFAULT_ROLE_PERMISSIONS[effectiveRole]) {
              const fallbackPerms = DEFAULT_ROLE_PERMISSIONS[effectiveRole];
              setPermissions(fallbackPerms);
              try {
                sessionStorage.setItem("permissions", JSON.stringify(fallbackPerms));
              } catch {
                // ignore
              }
            }
          }
        }

        // Load associated restaurant details via get_my_restaurant() RPC with direct table fallback
        let loadedRestaurant: Restaurant | null = null;
        if (effectiveRestaurantId) {
          try {
            const { data: restData, error: restErr } = await supabase.rpc("get_my_restaurant");
            if (!restErr && restData) {
              loadedRestaurant = restData as Restaurant;
            }
          } catch (rErr) {
            console.warn("get_my_restaurant RPC failed:", rErr);
          }

          if (!loadedRestaurant) {
            try {
              const { data: directRest } = await supabase
                .from("restaurants")
                .select("id, name, name_bn, slug, phone, email, address, city, logo_url, qr_code_url, currency, currency_symbol, default_vat_rate, service_charge_rate, is_active, status, subscription_plan")
                .eq("id", effectiveRestaurantId)
                .maybeSingle();

              if (directRest) {
                loadedRestaurant = directRest as Restaurant;
              }
            } catch (dErr) {
              console.warn("Direct restaurant fetch fallback error:", dErr);
            }
          }

          if (!loadedRestaurant) {
            // Restore from cache if available
            const cachedRest = safeStorageGet<Restaurant>("current_restaurant");
            if (cachedRest) loadedRestaurant = cachedRest;
          }

          if (loadedRestaurant) {
            setRestaurant(loadedRestaurant);
            try {
              sessionStorage.setItem("current_restaurant", JSON.stringify(loadedRestaurant));
            } catch {
              // ignore
            }
          }
        }

        return {
          role: effectiveRole,
          restaurant: loadedRestaurant,
          restaurantId: effectiveRestaurantId,
        };
      }

      // 3. Fallback: Check if user owns a restaurant directly by email
      if (currentUser.email) {
        try {
          const { data: restOwner } = await supabase
            .from("restaurants")
            .select("*")
            .ilike("email", currentUser.email.trim())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (restOwner) {
            const rest = restOwner as Restaurant;
            setRestaurant(rest);
            setRestaurantId(rest.id);
            setRole("owner");
            try {
              sessionStorage.setItem("current_restaurant", JSON.stringify(rest));
              sessionStorage.setItem("role", "owner");
            } catch {
              // ignore
            }
            return { role: "owner", restaurant: rest, restaurantId: rest.id };
          }
        } catch (oErr) {
          console.warn("Owner fallback error:", oErr);
        }
      }

      // No role found
      safeClearAuthStorage();
      setRole(null);
      setProfile(null);
      setPlatformAdmin(null);
      setRestaurantId(null);
      setRestaurant(null);
      setPermissions([]);
      return { role: null, restaurant: null, restaurantId: null };
    } catch (err) {
      console.error("Error loading user profile:", err);
      return { role: null, restaurant: null, restaurantId: null };
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      const normRole = (role || "").toLowerCase().trim();
      if (normRole === "super_admin" || normRole === "owner") return true;
      if (permissions.includes(permission)) return true;
      if (normRole && DEFAULT_ROLE_PERMISSIONS[normRole]?.includes(permission)) {
        return true;
      }
      return false;
    },
    [role, permissions]
  );

  const refreshProfile = useCallback(async () => {
    if (user) {
      await loadUserProfile(user);
    }
  }, [user, loadUserProfile]);

  // Initial Session Boot & Auth State Listener
  useEffect(() => {
    let mounted = true;

    // Hard 3-second safety timeout: GUARANTEED to stop loading spinner and unblock UI
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        isBootDoneRef.current = true;
        setLoading(false);
      }
    }, 3000);

    // Initial session probe
    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.warn("Error getting initial session:", error);
        }

        const bootSession = data?.session;
        if (bootSession?.user) {
          setSession(bootSession);
          setUser(bootSession.user);

          try {
            await loadUserProfile(bootSession.user);
          } catch (profileErr) {
            console.error("Failed to load user profile on boot:", profileErr);
          }
        } else {
          // If no active session returned yet by GoTrue, check if we have cached profile in sessionStorage
          const hasCached = safeStorageGet("user") || safeStorageGet("admin");
          if (!hasCached) {
            setSession(null);
            setUser(null);
            setProfile(null);
            setPlatformAdmin(null);
            setRole(null);
            setRestaurantId(null);
            setRestaurant(null);
            setPermissions([]);
          }
        }
      })
      .catch((err) => {
        console.warn("Unexpected error in getSession:", err);
      })
      .finally(() => {
        isBootDoneRef.current = true;
        if (mounted) {
          setLoading(false);
          clearTimeout(safetyTimer);
        }
      });

    // Subscribe to auth state changes (SIGN_IN, SIGN_OUT, TOKEN_REFRESHED)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT" || !newSession?.user) {
        setSession(null);
        setUser(null);
        setProfile(null);
        setPlatformAdmin(null);
        setRole(null);
        setRestaurantId(null);
        setRestaurant(null);
        setPermissions([]);
        safeClearAuthStorage();
        isBootDoneRef.current = true;
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setSession(newSession);
        setUser(newSession.user);

        // Avoid re-running profile lookup if already resolving on boot
        try {
          await loadUserProfile(newSession.user);
        } finally {
          isBootDoneRef.current = true;
          setLoading(false);
        }
      } else if (event === "TOKEN_REFRESHED") {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  // Sign In with automatic phone/email resolution (no lock contention)
  const signIn = async (identifier: string, password: string) => {
    setLoading(true);
    try {
      let loginEmail = identifier.trim().toLowerCase();

      // Handle phone login: if identifier does NOT contain '@', resolve phone to staff email
      if (!loginEmail.includes("@")) {
        const digits = identifier.replace(/\D/g, "");
        let normPhone = digits;
        if (normPhone.startsWith("880") && normPhone.length === 13) {
          normPhone = `+${normPhone}`;
        } else if (normPhone.startsWith("01") && normPhone.length === 11) {
          normPhone = `+88${normPhone}`;
        } else if (normPhone.startsWith("1") && normPhone.length === 10) {
          normPhone = `+880${normPhone}`;
        }

        // Check if there is an active staff record with this phone number
        try {
          const { data: staffByPhone } = await supabase
            .from("restaurant_staff")
            .select("email")
            .eq("phone", normPhone)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (staffByPhone?.email) {
            loginEmail = staffByPhone.email.toLowerCase();
          } else {
            loginEmail = `${normPhone.replace(/\D/g, "")}@staff.amarmenu.internal`;
          }
        } catch {
          loginEmail = `${normPhone.replace(/\D/g, "")}@staff.amarmenu.internal`;
        }
      }

      // Authenticate directly with Supabase - no preceding signOut() to avoid web-lock deadlock
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data.user) {
        return { success: false, error: "Failed to authenticate user." };
      }

      setUser(data.user);
      setSession(data.session);

      const profileRes = await loadUserProfile(data.user);
      return { success: true, role: profileRes.role };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to sign in";
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  // Sign Out with guaranteed state clearing and timeout race
  const signOut = async () => {
    setLoading(true);
    try {
      safeClearAuthStorage();
      setUser(null);
      setSession(null);
      setProfile(null);
      setPlatformAdmin(null);
      setRole(null);
      setRestaurantId(null);
      setRestaurant(null);
      setPermissions([]);

      // Call Supabase signOut with a 2-second timeout race to prevent network freeze
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setLoading(false);
    }
  };

  const mustChangePassword = !!user?.app_metadata?.must_change_password;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        platformAdmin,
        role,
        restaurantId,
        restaurant,
        permissions,
        hasPermission,
        loading,
        mustChangePassword,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
