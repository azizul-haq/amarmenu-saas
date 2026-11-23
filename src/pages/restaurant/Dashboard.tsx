import React, { useState, useEffect, useCallback } from "react";
import {
  useNavigate,
  Routes,
  Route,
  Link,
  useLocation,
  Navigate,
} from "react-router-dom";
import {
  Store as StoreIcon,
  LogOut,
  LayoutDashboard,
  ShoppingBag,
  UtensilsCrossed,
  QrCode,
  FileText,
  Settings,
  ChefHat,
  ShieldAlert,
  Calculator,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  Menu as MenuIcon,
  X,
  Users,
  AlertTriangle,
  CheckCircle2,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { ProtectedRoute } from "../../components/auth/ProtectedRoute";
import { supabase } from "../../config/supabase";
import { getTenantSubscriptionDetails } from "../../services/subscriptionService";
import type { TenantSubscriptionRecord } from "../../schemas/subscriptionSchema";
import { SubmitPaymentModal } from "../../components/restaurant/SubmitPaymentModal";
import { RoleBasedSearchBar } from "../../components/common/RoleBasedSearchBar";
import { RoleBadge, RoleWatermark, getRoleConfig } from "../../components/restaurant/RoleVisualIdentity";
import RestaurantHome from "./RestaurantHome";
import Orders from "./Orders";
import KitchenKDS from "./KitchenKDS";
import Menu from "./Menu";
import Tables from "./Tables";
import Reports from "./Reports";
import RestaurantSettings from "./RestaurantSettings";
import AuditLogsPage from "./AuditLogs";
import ShiftsPage from "./Shifts";
import SubscriptionPage from "./Subscription";
import StaffPage from "./Staff";
import ProfilePage from "./Profile";

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  permission?: string;
  anyPermissions?: string[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const RestaurantDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, restaurant, role, hasPermission, signOut } = useAuth();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [subscription, setSubscription] = useState<TenantSubscriptionRecord | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);

  const fetchSubscription = useCallback(async () => {
    if (!restaurant?.id) return;
    try {
      const res = await getTenantSubscriptionDetails(restaurant.id);
      if (res.success && res.subscription) {
        setSubscription(res.subscription);
      }
    } catch {
      // Graceful fallback if subscription fails to load
    }
  }, [restaurant?.id]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const isSuspended =
    restaurant?.status === "blocked" ||
    restaurant?.status === "suspended" ||
    subscription?.status === "suspended";

  const isSoftLocked = role !== "super_admin" && isSuspended;

  const isGracePeriod =
    role !== "super_admin" &&
    !isSoftLocked &&
    (subscription?.status === "grace_period" ||
      (subscription?.current_period_end &&
        new Date(subscription.current_period_end).getTime() < Date.now()));

  // Persist sidebar collapsed state
  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_collapsed", String(next));
      return next;
    });
  };

  // Live Asia/Dhaka clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Dhaka",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now);
      setCurrentTime(formatted);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to pending orders count for badge
  useEffect(() => {
    if (!restaurant?.id) return;

    const fetchPending = async () => {
      const { count } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurant.id)
        .eq("status", "pending");
      setPendingOrdersCount(count || 0);
    };

    fetchPending();

    const channel = supabase
      .channel(`sidebar-orders-${restaurant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        () => {
          fetchPending();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurant?.id, user?.id]);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const navGroups: NavGroup[] = [
    {
      title: "OPERATIONS",
      items: [
        {
          path: "/restaurant",
          icon: LayoutDashboard,
          label: "Dashboard",
          permission: "view_reports",
        },
        {
          path: "/restaurant/orders",
          icon: ShoppingBag,
          label: "Live Orders",
          badge: pendingOrdersCount,
          anyPermissions: ["confirm_order", "settle_bill", "update_kitchen_status"],
        },
        {
          path: "/restaurant/tables",
          icon: QrCode,
          label: "Tables & Floor",
          anyPermissions: ["confirm_order", "settle_bill"],
        },
        {
          path: "/restaurant/kitchen",
          icon: ChefHat,
          label: "Kitchen KDS",
          permission: "update_kitchen_status",
        },
      ],
    },
    {
      title: "FINANCE & AUDIT",
      items: [
        {
          path: "/restaurant/shifts",
          icon: Calculator,
          label: "Cash Shifts & Z-Report",
          permission: "manage_shifts",
        },
        {
          path: "/restaurant/reports",
          icon: FileText,
          label: "Sales & NBR VAT",
          permission: "view_reports",
        },
        {
          path: "/restaurant/audit",
          icon: ShieldAlert,
          label: "Audit & Voids",
          permission: "view_reports",
        },
      ],
    },
    {
      title: "MANAGEMENT",
      items: [
        {
          path: "/restaurant/menu",
          icon: UtensilsCrossed,
          label: "Bilingual Menu",
          anyPermissions: ["edit_menu", "toggle_availability"],
        },
        {
          path: "/restaurant/staff",
          icon: Users,
          label: "Staff & Team",
          permission: "manage_staff",
        },
        {
          path: "/restaurant/subscription",
          icon: CreditCard,
          label: "Subscription Plan",
          permission: "manage_subscription",
        },
        {
          path: "/restaurant/settings",
          icon: Settings,
          label: "Settings",
          permission: "change_settings",
        },
      ],
    },
  ];

  const normRole = (role || "").toLowerCase().trim();
  const roleConfig = getRoleConfig(role);
  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (normRole === "super_admin" || normRole === "owner") return true;

        // Role-based guaranteed visibility fallbacks so sidebar is never blank on refresh
        if (item.path === "/restaurant/orders" && ["waiter", "cashier", "manager"].includes(normRole)) {
          return true;
        }
        if (item.path === "/restaurant/tables" && ["waiter", "manager"].includes(normRole)) {
          return true;
        }
        if (item.path === "/restaurant/kitchen" && ["kitchen", "manager"].includes(normRole)) {
          return true;
        }
        if (item.path === "/restaurant/shifts" && ["cashier", "manager"].includes(normRole)) {
          return true;
        }

        if (item.permission && !hasPermission(item.permission)) return false;
        if (
          item.anyPermissions &&
          !item.anyPermissions.some((p) => hasPermission(p))
        ) {
          return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className={`min-h-screen ${roleConfig.pageBgGradient} flex transition-colors duration-500`}>
      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Modern Left Vertical Sidebar */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 bg-slate-900 text-slate-200 border-r border-slate-800 transition-all duration-300 flex flex-col ${
          mobileMenuOpen
            ? "translate-x-0 w-64"
            : "-translate-x-full lg:translate-x-0"
        } ${isCollapsed ? "lg:w-20" : "lg:w-64"}`}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/80">
          <Link
            to="/restaurant"
            className="flex items-center space-x-3 overflow-hidden"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${roleConfig.brandBadgeGrad} flex items-center justify-center flex-shrink-0 transition-all duration-300 overflow-hidden`}>
              {restaurant?.logo_url ? (
                <img
                  src={restaurant.logo_url}
                  alt={restaurant.name || "Restaurant"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <StoreIcon className="w-5 h-5 text-white" />
              )}
            </div>
            {!isCollapsed && (
              <div className="truncate">
                <span className="font-bold text-base text-white tracking-tight block truncate">
                  {restaurant?.name || "AmarMenu"}
                </span>
                <span className="text-xs text-orange-400 font-medium block truncate">
                  {restaurant?.slug ? `@${restaurant.slug}` : "Food SaaS BD"}
                </span>
              </div>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {/* Mobile close button */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {visibleNavGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[11px] font-semibold text-slate-400 tracking-wider mb-2">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const isActive =
                  location.pathname === item.path ||
                  (item.path !== "/restaurant" &&
                    location.pathname.startsWith(item.path));

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                      isActive
                        ? roleConfig.navActiveGrad
                        : "text-slate-300 hover:text-white hover:bg-slate-800/80"
                    } ${isCollapsed ? "justify-center" : "justify-between"}`}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <div className="flex items-center space-x-3 truncate">
                      <item.icon
                        className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-105 ${
                          isActive ? "text-white" : "text-slate-400 group-hover:text-orange-400"
                        }`}
                      />
                      {!isCollapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </div>

                    {/* Pending badge */}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                          isActive
                            ? "bg-white text-orange-600"
                            : "bg-orange-500 text-white animate-pulse"
                        } ${isCollapsed ? "absolute top-1 right-1 w-2.5 h-2.5 p-0 rounded-full" : ""}`}
                      >
                        {!isCollapsed ? item.badge : ""}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Public Storefront Link Shortcut */}
        {restaurant?.slug && !isCollapsed && (
          <div className="px-3 pb-2">
            <a
              href={`/menu/${restaurant.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-300 hover:text-white transition-colors border border-slate-700/50"
            >
              <div className="flex items-center space-x-2 truncate">
                <ExternalLink className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                <span className="truncate">Customer Menu</span>
              </div>
              <span className="text-[10px] text-slate-300 bg-slate-700 px-1.5 py-0.5 rounded">
                Live QR
              </span>
            </a>
          </div>
        )}

        {/* Staff Profile & Logout Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <div
            className={`flex items-center ${
              isCollapsed ? "flex-col gap-2 justify-center" : "justify-between"
            }`}
          >
            <Link
              to="/restaurant/profile"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center space-x-3 overflow-hidden rounded-xl p-1.5 -m-1.5 hover:bg-slate-800/80 transition-all group flex-1 min-w-0"
              title="View & Edit My Profile"
            >
              <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-sm font-bold text-orange-400 group-hover:border-orange-400 transition-colors flex-shrink-0">
                {profile?.full_name?.charAt(0).toUpperCase() ||
                  user?.email?.charAt(0).toUpperCase() ||
                  "U"}
              </div>
              {!isCollapsed && (
                <div className="truncate text-left">
                  <p className="text-xs font-semibold text-white group-hover:text-orange-400 transition-colors truncate">
                    {profile?.full_name || user?.email?.split("@")[0] || "Staff Member"}
                  </p>
                  <p className="text-[11px] text-orange-400 capitalize font-medium flex items-center space-x-1">
                    <span>{profile?.role || "Staff"}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-[10px] text-slate-400 group-hover:text-white transition-colors">Profile</span>
                  </p>
                </div>
              )}
            </Link>

            <button
              onClick={handleLogout}
              className={`p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors ${
                isCollapsed ? "w-full flex justify-center" : "flex-shrink-0"
              }`}
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Dynamic Viewport */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isCollapsed ? "lg:pl-20" : "lg:pl-64"
        }`}
      >
        {/* Modern Sticky Top Utility Bar with Lightweight Glassmorphism & Role-Colored Top Border */}
        <header className={`sticky top-0 z-30 h-16 bg-white/85 backdrop-blur-sm border-b border-slate-200/80 shadow-xs px-4 sm:px-6 flex items-center justify-between transition-all duration-300 ${roleConfig.topBorderAccent}`}>
          {/* Mobile hamburger */}
          <div className="flex items-center space-x-2 lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <MenuIcon className="w-6 h-6" />
            </button>
            <span className="font-bold text-slate-900 truncate max-w-[120px] sm:max-w-xs">
              {restaurant?.name || "AmarMenu"}
            </span>
            <RoleBadge role={role} compact />
          </div>

          {/* Desktop Left Breadcrumb / Context */}
          <div className="hidden lg:flex items-center space-x-3">
            <span className="text-sm font-semibold text-slate-800">
              {restaurant?.name || "Restaurant Hub"}
            </span>
            <span className="text-slate-300">•</span>
            <RoleBadge role={role} />
          </div>

          {/* Central Role-based Search Bar */}
          <div className="hidden sm:flex flex-1 max-w-sm md:max-w-md mx-4 justify-center">
            <RoleBasedSearchBar />
          </div>

          {/* Right Utilities: Time & Status */}
          <div className="flex items-center space-x-4">
            {currentTime && (
              <div className="hidden sm:flex items-center space-x-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
                <Clock className="w-3.5 h-3.5 text-orange-500" />
                <span className="font-medium">{currentTime}</span>
                <span className="text-slate-400 font-normal">Dhaka</span>
              </div>
            )}

            {/* My Profile Quick Link */}
            <Link
              to="/restaurant/profile"
              className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:text-orange-600 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
              title="My Profile & Work History"
            >
              <UserIcon className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">My Profile</span>
            </Link>

            {/* Public Menu Quick Link */}
            {restaurant?.slug && (
              <a
                href={`/menu/${restaurant.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center space-x-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100/80 border border-orange-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <span>View Menu</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </header>

        {/* Grace Period Warning Banner */}
        {isGracePeriod && (
          <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm font-medium shadow-xs">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-bounce" />
              <span>
                <strong>Subscription Expired:</strong> You are currently in the 7-day grace period. Please submit your renewal payment to keep your management dashboard active.
              </span>
            </div>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="ml-3 px-3 py-1 bg-white text-amber-800 rounded-lg font-bold text-xs hover:bg-amber-50 transition-colors shadow-2xs whitespace-nowrap"
            >
              Renew Now
            </button>
          </div>
        )}

        {/* Soft Suspension Banner on Subscription Page */}
        {isSoftLocked && (
          <div className="bg-rose-600 text-white px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm font-medium shadow-xs">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>
                <strong>Dashboard Soft Suspended:</strong> An overdue subscription payment is required. Note: Customer QR menu ordering remains active for diners.
              </span>
            </div>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="ml-3 px-3 py-1 bg-white text-rose-800 rounded-lg font-bold text-xs hover:bg-rose-50 transition-colors shadow-2xs whitespace-nowrap"
            >
              Pay with bKash/Nagad
            </button>
          </div>
        )}

        {/* Role-Specific Background Watermark Illustration */}
        <RoleWatermark role={role} />

        {/* Dynamic Route Content Canvas */}
        <main className="relative z-10 flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {isSoftLocked && location.pathname !== "/restaurant/subscription" ? (
            <div className="max-w-xl mx-auto my-12 bg-white rounded-2xl border border-rose-200 p-8 shadow-sm text-center">
              <div className="w-16 h-16 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-600 shadow-xs">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-2">
                Restaurant Management Suspended
              </h2>
              <p className="text-sm text-slate-600 mb-5 leading-relaxed">
                Your restaurant management dashboard is temporarily locked due to an overdue subscription payment.
              </p>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-800 font-medium mb-6 flex items-center justify-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>
                  <strong>Notice:</strong> Your customer-facing QR menu remains online and diners can still place orders.
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Pay with bKash / Nagad</span>
                </button>
                <Link
                  to="/restaurant/subscription"
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
                >
                  View Subscription & Invoices
                </Link>
              </div>
            </div>
          ) : (
            <Routes>
              <Route
                index
                element={
                  role === "super_admin" || hasPermission("view_reports") ? (
                    <RestaurantHome />
                  ) : role === "kitchen" ? (
                    <Navigate to="/restaurant/kitchen" replace />
                  ) : (
                    <Navigate to="/restaurant/orders" replace />
                  )
                }
              />
              <Route path="orders" element={<Orders />} />
              <Route
                path="shifts"
                element={
                  <ProtectedRoute requiredPermission="manage_shifts" fallbackPath="/restaurant/orders">
                    <ShiftsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="kitchen"
                element={
                  <ProtectedRoute requiredPermission="update_kitchen_status" fallbackPath="/restaurant/orders">
                    <KitchenKDS />
                  </ProtectedRoute>
                }
              />
              <Route
                path="menu"
                element={
                  <ProtectedRoute
                    requiredPermissions={["edit_menu", "toggle_availability"]}
                    fallbackPath="/restaurant/orders"
                  >
                    <Menu />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tables"
                element={
                  <ProtectedRoute
                    requiredPermissions={["confirm_order", "settle_bill"]}
                    fallbackPath="/restaurant/orders"
                  >
                    <Tables />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports"
                element={
                  <ProtectedRoute requiredPermission="view_reports" fallbackPath="/restaurant/orders">
                    <Reports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="audit"
                element={
                  <ProtectedRoute requiredPermission="view_reports" fallbackPath="/restaurant/orders">
                    <AuditLogsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff"
                element={
                  <ProtectedRoute requiredPermission="manage_staff" fallbackPath="/restaurant/orders">
                    <StaffPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="subscription"
                element={
                  <ProtectedRoute requiredPermission="manage_subscription" fallbackPath="/restaurant/orders">
                    <SubscriptionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <ProtectedRoute requiredPermission="change_settings" fallbackPath="/restaurant/orders">
                    <RestaurantSettings />
                  </ProtectedRoute>
                }
              />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/restaurant" replace />} />
            </Routes>
          )}
        </main>
      </div>

      {/* Quick Payment Submission Modal */}
      {showPaymentModal && (restaurant?.id || subscription?.restaurant_id) && (
        <SubmitPaymentModal
          restaurantId={restaurant?.id || subscription?.restaurant_id || ""}
          currentPlan={subscription?.plan_code || "growth"}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setShowPaymentModal(false);
            fetchSubscription();
          }}
        />
      )}
    </div>
  );
};

export default RestaurantDashboard;
