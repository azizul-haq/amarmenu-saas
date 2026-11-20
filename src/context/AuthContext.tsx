import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<RestaurantStaff | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState<PlatformAdmin | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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
            localStorage.setItem("current_restaurant", JSON.stringify(loadedRestaurant));
          }
        }
        localStorage.setItem("user", JSON.stringify({ ...staff, restaurant_id: staff.restaurant_id }));
        return {
          role: staff.role as UserRole,
          restaurant: loadedRestaurant,
          restaurantId: staff.restaurant_id,
        };
      }

      // No role found
      localStorage.removeItem("user");
      localStorage.removeItem("admin");
      localStorage.removeItem("current_restaurant");
      setRole(null);
      setProfile(null);
      setPlatformAdmin(null);
      setRestaurantId(null);
      setRestaurant(null);
      setPermissions([]);
      return { role: null, restaurant: null, restaurantId: null };
    } catch (err) {
      console.error("Error loading user profile:", err);
      setPermissions([]);
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

  // 1. Initial Session & Auth State Listener (SYNCHRONOUS ONLY to avoid Supabase JS v2 deadlock)
  useEffect(() => {
    let mounted = true;

    // Get initial session on boot
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (!session?.user) {
        setLoading(false);
      }
    }).catch((err) => {
      console.warn("Failed to get initial auth session:", err);
      if (mounted) setLoading(false);
    });

    // Subscribe to auth state changes
    // CRITICAL FIX: DO NOT AWAIT DATABASE QUERIES SYNCHRONOUSLY INSIDE onAuthStateChange.
    // That causes a well-known internal mutex deadlock in Supabase JS v2!
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (!newSession?.user) {
        // Immediate clean wipe on sign out
        setProfile(null);
        setPlatformAdmin(null);
        setRole(null);
        setRestaurantId(null);
        setRestaurant(null);
        setPermissions([]);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // 2. Separate Effect to Load Profile: Triggered when user?.id changes (Lock-Free)
  useEffect(() => {
    let isMounted = true;

    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Hard safety timeout: Guaranteed to clear the "Authenticating..." spinner after 4 seconds
    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        console.warn("Auth load safety timeout reached - unblocking UI");
        setLoading(false);
      }
    }, 4000);

    loadUserProfile(user)
      .catch((err) => {
        console.error("loadUserProfile error:", err);
      })
      .finally(() => {
        clearTimeout(safetyTimer);
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, [user?.id, loadUserProfile]);

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
      // 1. Immediately wipe local storage and memory state
      localStorage.removeItem("user");
      localStorage.removeItem("admin");
      localStorage.removeItem("current_restaurant");
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
