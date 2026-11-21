import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../config/supabase";
import type { Restaurant, RestaurantStaff, PlatformAdmin } from "../config/supabase";

export type UserRole = "super_admin" | "owner" | "manager" | "cashier" | "kitchen" | "waiter" | null;

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

// Synchronously read stored session cache on mount so that initial render has profile & role
const getStoredAuthState = () => {
  if (typeof window === "undefined") {
    return { profile: null, admin: null, role: null, restaurant: null, restaurantId: null };
  }
  try {
    const rawUser = sessionStorage.getItem("user");
    const rawAdmin = sessionStorage.getItem("admin");
    const rawRest = sessionStorage.getItem("current_restaurant");
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    const parsedAdmin = rawAdmin ? JSON.parse(rawAdmin) : null;
    const parsedRest = rawRest ? JSON.parse(rawRest) : null;

    let initialRole: UserRole = null;
    if (parsedAdmin) initialRole = "super_admin";
    else if (parsedUser?.role) initialRole = parsedUser.role as UserRole;

    return {
      profile: parsedUser as RestaurantStaff | null,
      admin: parsedAdmin as PlatformAdmin | null,
      role: initialRole,
      restaurant: parsedRest as Restaurant | null,
      restaurantId: (parsedRest?.id || parsedUser?.restaurant_id || null) as string | null,
    };
  } catch {
    return { profile: null, admin: null, role: null, restaurant: null, restaurantId: null };
  }
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
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const isBootDoneRef = useRef(false);

  // Load user profile & role from the database
  const loadUserProfile = useCallback(async (currentUser: User): Promise<{
    role: UserRole;
    restaurant: Restaurant | null;
    restaurantId: string | null;
  }> => {
    try {
      // 1. Check if user is a platform admin (Super Admin)
      const { data: adminData } = await supabase
        .from("platform_admins")
        .select("*")
        .or(`auth_user_id.eq.${currentUser.id},email.eq.${currentUser.email}`)
        .eq("is_active", true)
        .maybeSingle();

      if (adminData) {
        setPlatformAdmin(adminData as PlatformAdmin);
        setRole("super_admin");
        setProfile(null);
        setRestaurantId(null);
        setRestaurant(null);

        sessionStorage.setItem("admin", JSON.stringify(adminData));
        sessionStorage.setItem("role", "super_admin");

        // Super Admin gets all permissions dynamically from role_permissions
        const { data: allPerms } = await supabase
          .from("role_permissions")
          .select("permission");
        const uniquePerms = Array.from(
          new Set((allPerms || []).map((p: { permission: string }) => p.permission))
        );
        setPermissions(uniquePerms);

        return { role: "super_admin", restaurant: null, restaurantId: null };
      }

      // 2. Check if user is a restaurant staff member (Owner, Manager, Cashier, etc.)
      const { data: staffData } = await supabase
        .from("restaurant_staff")
        .select("id, auth_user_id, restaurant_id, full_name, phone, email, role, is_active, created_at, updated_at")
        .or(`auth_user_id.eq.${currentUser.id},email.eq.${currentUser.email}`)
        .eq("is_active", true)
        .maybeSingle();

      if (staffData) {
        const staff = staffData as RestaurantStaff;
        setProfile(staff);
        setRole(staff.role as UserRole);
        setRestaurantId(staff.restaurant_id);
        setPlatformAdmin(null);

        sessionStorage.setItem("user", JSON.stringify({ ...staff, restaurant_id: staff.restaurant_id }));
        sessionStorage.setItem("role", staff.role);

        // Fetch dynamic permissions for this role from the database
        const { data: permData } = await supabase
          .from("role_permissions")
          .select("permission")
          .eq("role", staff.role);
        const rolePerms = (permData || []).map((p: { permission: string }) => p.permission);
        setPermissions(rolePerms);

        // Load associated restaurant details via secure get_my_restaurant() RPC
        let loadedRestaurant: Restaurant | null = null;
        if (staff.restaurant_id) {
          const { data: restData } = await supabase.rpc("get_my_restaurant");

          if (restData) {
            loadedRestaurant = restData as Restaurant;
            setRestaurant(loadedRestaurant);
            sessionStorage.setItem("current_restaurant", JSON.stringify(loadedRestaurant));
          } else {
            // Fallback: restore from cache if network delay
            const cachedRest = sessionStorage.getItem("current_restaurant");
            if (cachedRest) {
              try {
                loadedRestaurant = JSON.parse(cachedRest);
                setRestaurant(loadedRestaurant);
              } catch {
                // ignore
              }
            }
          }
        }

        return {
          role: staff.role as UserRole,
          restaurant: loadedRestaurant,
          restaurantId: staff.restaurant_id,
        };
      }

      // 3. Fallback: Check if user owns a restaurant directly
      if (currentUser.email) {
        const { data: restOwner } = await supabase
          .from("restaurants")
          .select("*")
          .eq("email", currentUser.email)
          .maybeSingle();

        if (restOwner) {
          const rest = restOwner as Restaurant;
          setRestaurant(rest);
          setRestaurantId(rest.id);
          setRole("owner");
          sessionStorage.setItem("current_restaurant", JSON.stringify(rest));
          sessionStorage.setItem("role", "owner");
          return { role: "owner", restaurant: rest, restaurantId: rest.id };
        }
      }

      // No role found
      sessionStorage.removeItem("user");
      sessionStorage.removeItem("admin");
      sessionStorage.removeItem("current_restaurant");
      sessionStorage.removeItem("role");
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
      if (role === "super_admin") return true;
      return permissions.includes(permission);
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

    // Safety timeout: Guaranteed to clear the "Authenticating..." spinner after 5 seconds
    const safetyTimer = setTimeout(() => {
      if (mounted && !isBootDoneRef.current) {
        console.warn("Auth boot safety timeout reached - unblocking UI");
        isBootDoneRef.current = true;
        setLoading(false);
      }
    }, 5000);

    // Boot: get active session from sessionStorage via getSession()
    supabase.auth
      .getSession()
      .then(async ({ data: { session: bootSession } }) => {
        if (!mounted) return;

        if (bootSession?.user) {
          setSession(bootSession);
          setUser(bootSession.user);

          // Guaranteed to keep loading=true while resolving user profile & permissions
          try {
            await loadUserProfile(bootSession.user);
          } catch (profileErr) {
            console.error("Failed to load user profile on boot:", profileErr);
          }
        } else {
          // No active session found
          setSession(null);
          setUser(null);
          setProfile(null);
          setPlatformAdmin(null);
          setRole(null);
          setRestaurantId(null);
          setRestaurant(null);
          setPermissions([]);
        }

        isBootDoneRef.current = true;
        if (mounted) {
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn("Failed to get initial auth session:", err);
        isBootDoneRef.current = true;
        if (mounted) setLoading(false);
      })
      .finally(() => {
        clearTimeout(safetyTimer);
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
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("admin");
        sessionStorage.removeItem("current_restaurant");
        sessionStorage.removeItem("role");
        isBootDoneRef.current = true;
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setSession(newSession);
        setUser(newSession.user);
        if (isBootDoneRef.current) {
          await loadUserProfile(newSession.user);
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

  // Sign In with automatic cleanup of previous session
  const signIn = async (identifier: string, password: string) => {
    setLoading(true);
    try {
      // If an existing session is lingering, cleanly sign it out first
      const { data: existingSession } = await supabase.auth.getSession();
      if (existingSession?.session) {
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore background signout errors
        }
      }

      let loginEmail = identifier.trim().toLowerCase();
      // Handle phone login: normalize BD phone number and target synthetic staff email
      const digits = identifier.replace(/\D/g, "");
      if (digits.length >= 10 && (identifier.startsWith("+880") || identifier.startsWith("01") || identifier.startsWith("880") || digits.length === 11)) {
        let normPhone = digits;
        if (normPhone.startsWith("880") && normPhone.length === 13) {
          normPhone = `+${normPhone}`;
        } else if (normPhone.startsWith("01") && normPhone.length === 11) {
          normPhone = `+88${normPhone}`;
        } else if (normPhone.startsWith("1") && normPhone.length === 10) {
          normPhone = `+880${normPhone}`;
        }
        loginEmail = `${normPhone.replace(/\D/g, "")}@staff.amarmenu.internal`;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      let resolvedRole: UserRole = null;
      if (data.user) {
        setUser(data.user);
        setSession(data.session);
        const res = await loadUserProfile(data.user);
        resolvedRole = res.role;
      }

      return { success: true, role: resolvedRole };
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
      // 1. Immediately wipe session and local storage and memory state
      sessionStorage.removeItem("user");
      sessionStorage.removeItem("admin");
      sessionStorage.removeItem("current_restaurant");
      sessionStorage.removeItem("role");
      localStorage.removeItem("user");
      localStorage.removeItem("admin");
      localStorage.removeItem("current_restaurant");
      localStorage.removeItem("role");
      setUser(null);
      setSession(null);
      setProfile(null);
      setPlatformAdmin(null);
      setRole(null);
      setRestaurantId(null);
      setRestaurant(null);
      setPermissions([]);

      // 2. Call Supabase signOut with a 2-second timeout race to prevent network freeze
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
