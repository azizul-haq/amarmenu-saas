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
  signIn: (email: string, password: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>;
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
        .select("*")
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

        // Load associated restaurant details
        let loadedRestaurant: Restaurant | null = null;
        if (staff.restaurant_id) {
          const { data: restData } = await supabase
            .from("restaurants")
            .select("*")
            .eq("id", staff.restaurant_id)
            .maybeSingle();

          if (restData) {
            loadedRestaurant = restData as Restaurant;
            setRestaurant(loadedRestaurant);
          }
        }
        return {
          role: staff.role as UserRole,
          restaurant: loadedRestaurant,
          restaurantId: staff.restaurant_id,
        };
      }

      // No role found
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

  useEffect(() => {
    let mounted = true;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        loadUserProfile(session.user).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setPermissions([]);
        setLoading(false);
      }
    });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        await loadUserProfile(newSession.user);
      } else {
        setProfile(null);
        setPlatformAdmin(null);
        setRole(null);
        setRestaurantId(null);
        setRestaurant(null);
        setPermissions([]);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setLoading(false);
        return { success: false, error: error.message };
      }

      let resolvedRole: UserRole = null;
      if (data.user) {
        setUser(data.user);
        setSession(data.session);
        const res = await loadUserProfile(data.user);
        resolvedRole = res.role;
      }

      setLoading(false);
      return { success: true, role: resolvedRole };
    } catch (err: unknown) {
      setLoading(false);
      const message = err instanceof Error ? err.message : "Failed to sign in";
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      // Clear legacy storage items if any exist
      localStorage.removeItem("user");
      localStorage.removeItem("admin");
      setUser(null);
      setSession(null);
      setProfile(null);
      setPlatformAdmin(null);
      setRole(null);
      setRestaurantId(null);
      setRestaurant(null);
      setPermissions([]);
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setLoading(false);
    }
  };

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
