import React, { useState, useEffect } from "react";
import {
  useNavigate,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import {
  Shield,
  LogOut,
  LayoutDashboard,
  FileText,
  Store as StoreIcon,
  BarChart3,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Clock,
  Menu as MenuIcon,
  X,
  Radio,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import DashboardHome from "./DashboardHome";
import PendingRequests from "./PendingRequests";
import AllRestaurants from "./AllRestaurants";
import Analytics from "./Analytics";
import Billing from "./Billing";

interface NavGroup {
  title: string;
  items: {
    path: string;
    icon: React.ElementType;
    label: string;
    badge?: number;
  }[];
}

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { platformAdmin, user, signOut } = useAuth();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("admin_sidebar_collapsed") === "true";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<string>("");

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("admin_sidebar_collapsed", String(next));
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

  // Fetch pending registration requests count for badge
  useEffect(() => {
    const fetchPending = async () => {
      const { count } = await supabase
        .from("registration_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      setPendingRequestsCount(count || 0);
    };

    fetchPending();

    const channel = supabase
      .channel("admin-sidebar-requests")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registration_requests",
        },
        () => {
          fetchPending();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate("/admin/login");
  };

  const navGroups: NavGroup[] = [
    {
      title: "PLATFORM CONTROL",
      items: [
        { path: "/admin", icon: LayoutDashboard, label: "Overview" },
        { path: "/admin/analytics", icon: BarChart3, label: "Platform Analytics" },
      ],
    },
    {
      title: "TENANT OPERATIONS",
      items: [
        {
          path: "/admin/requests",
          icon: FileText,
          label: "Pending Onboarding",
          badge: pendingRequestsCount,
        },
        { path: "/admin/restaurants", icon: StoreIcon, label: "All Restaurants" },
      ],
    },
    {
      title: "SAAS MONETIZATION",
      items: [
        { path: "/admin/billing", icon: CreditCard, label: "SaaS Invoices & Billing" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Super Admin Left Vertical Sidebar */}
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
            to="/admin"
            className="flex items-center space-x-3 overflow-hidden"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-950/40 flex-shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            {!isCollapsed && (
              <div className="truncate">
                <span className="font-bold text-base text-white tracking-tight block truncate">
                  AmarMenu Admin
                </span>
                <span className="text-[11px] text-indigo-400 font-medium block truncate">
                  Super Admin Console
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
          {navGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[11px] font-semibold text-slate-400 tracking-wider mb-2">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const isActive =
                  location.pathname === item.path ||
                  (item.path !== "/admin" &&
                    location.pathname.startsWith(item.path));

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                      isActive
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-950/40"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/80"
                    } ${isCollapsed ? "justify-center" : "justify-between"}`}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <div className="flex items-center space-x-3 truncate">
                      <item.icon
                        className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-105 ${
                          isActive ? "text-white" : "text-slate-400 group-hover:text-indigo-400"
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
                            ? "bg-white text-indigo-700"
                            : "bg-amber-500 text-white animate-pulse"
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

        {/* Super Admin Profile & Logout Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <div
            className={`flex items-center ${
              isCollapsed ? "justify-center" : "justify-between"
            }`}
          >
            {!isCollapsed && (
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="w-9 h-9 rounded-full bg-indigo-950 border border-indigo-700/60 flex items-center justify-center text-sm font-bold text-indigo-300 flex-shrink-0">
                  {platformAdmin?.email?.charAt(0).toUpperCase() || "A"}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">
                    {platformAdmin?.email?.split("@")[0] || user?.email?.split("@")[0] || "Super Admin"}
                  </p>
                  <p className="text-[11px] text-indigo-400 font-medium flex items-center space-x-1">
                    <span>Super Administrator</span>
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleLogout}
              className={`p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors ${
                isCollapsed ? "w-full flex justify-center" : ""
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
        {/* Sticky Top Utility Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between shadow-xs">
          {/* Mobile hamburger */}
          <div className="flex items-center space-x-3 lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <MenuIcon className="w-6 h-6" />
            </button>
            <span className="font-bold text-slate-900 truncate">
              Admin Platform
            </span>
          </div>

          {/* Desktop Left Context */}
          <div className="hidden lg:flex items-center space-x-3">
            <span className="text-sm font-semibold text-slate-800">
              AmarMenu Global Platform Control
            </span>
            <span className="text-slate-300">•</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Radio className="w-3 h-3 text-emerald-500 mr-1.5 animate-pulse" />
              Multi-Tenant Network Online
            </span>
          </div>

          {/* Right Utilities: Time & Status */}
          <div className="flex items-center space-x-4">
            {currentTime && (
              <div className="hidden sm:flex items-center space-x-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span className="font-medium">{currentTime}</span>
                <span className="text-slate-400 font-normal">Dhaka</span>
              </div>
            )}

            <div className="flex items-center space-x-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg">
              <Shield className="w-3.5 h-3.5" />
              <span>Full System Access</span>
            </div>
          </div>
        </header>

        {/* Dynamic Canvas */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Routes>
            <Route index element={<DashboardHome />} />
            <Route path="requests" element={<PendingRequests />} />
            <Route path="restaurants" element={<AllRestaurants />} />
            <Route path="billing" element={<Billing />} />
            <Route path="analytics" element={<Analytics />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
