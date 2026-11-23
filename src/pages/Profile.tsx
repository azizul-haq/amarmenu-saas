import React, { useState, useEffect, useCallback } from "react";
import {
  User,
  Mail,
  Phone,
  Shield,
  Store,
  Clock,
  KeyRound,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  CheckCircle2,
  UtensilsCrossed,
  Receipt,
  Activity,
  Award,
} from "lucide-react";
import { Card, Button, Input, Alert } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../config/supabase";
import {
  getMyActivityLogs,
  getMyTodayStats,
  updateMyProfile,
  type MyTodayStats,
} from "../services/staffActivityService";
import type { StaffActivityLog } from "../config/supabase";
import { formatDateTime } from "../utils/helpers";

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  owner: "Restaurant Owner",
  manager: "Manager",
  waiter: "Waiter / Server",
  kitchen: "Kitchen Chef",
  cashier: "Cashier",
  super_admin: "Super Admin",
};

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string; ring: string }> = {
  owner: { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-200", ring: "ring-purple-400" },
  manager: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200", ring: "ring-blue-400" },
  waiter: { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-200", ring: "ring-teal-400" },
  kitchen: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-200", ring: "ring-orange-400" },
  cashier: { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-200", ring: "ring-emerald-400" },
  super_admin: { bg: "bg-rose-100", text: "text-rose-800", border: "border-rose-200", ring: "ring-rose-400" },
};

export const ProfilePage: React.FC = () => {
  const { user, profile, restaurant, role, refreshProfile } = useAuth();

  // Profile Edit State
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Password Change State
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Activity Logs & Stats State
  const [activityLogs, setActivityLogs] = useState<StaffActivityLog[]>([]);
  const [todayStats, setTodayStats] = useState<MyTodayStats>({
    ordersServed: 0,
    ordersAccepted: 0,
    itemsPrepared: 0,
    billsSettled: 0,
    stockToggles: 0,
    shiftsHandled: 0,
    totalActions: 0,
  });
  const [logsLoading, setLogsLoading] = useState(true);

  // Sync state when profile loads/updates
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setPhoneNumber(profile.phone || "");
    }
  }, [profile]);

  // Load My Activity Logs & Stats
  const loadWorkHistory = useCallback(async () => {
    if (!restaurant?.id || !user?.id) return;
    setLogsLoading(true);

    try {
      const [logsRes, stats] = await Promise.all([
        getMyActivityLogs(restaurant.id, user.id, 40),
        getMyTodayStats(restaurant.id, user.id),
      ]);

      setActivityLogs(logsRes.data || []);
      setTodayStats(stats);
    } catch {
      // ignore
    } finally {
      setLogsLoading(false);
    }
  }, [restaurant?.id, user?.id]);

  useEffect(() => {
    loadWorkHistory();
  }, [loadWorkHistory]);

  // Handle Profile Update
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (!fullName.trim() || fullName.trim().length < 2) {
      setProfileError("Full Name must be at least 2 characters.");
      return;
    }

    setProfileSaving(true);
    const { success, error } = await updateMyProfile(fullName, phoneNumber);
    setProfileSaving(false);

    if (success) {
      setProfileSuccess("Profile updated successfully!");
      if (refreshProfile) {
        await refreshProfile();
      }
    } else {
      setProfileError(error || "Failed to update profile details.");
    }
  };

  // Handle Password Change
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match. Please re-enter.");
      return;
    }

    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setPasswordSuccess("Password changed successfully!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordError(err.message || "Failed to update password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const currentRole = role || profile?.role || "staff";
  const roleStyling = ROLE_COLORS[currentRole] || ROLE_COLORS.waiter;
  const initial = (profile?.full_name || user?.email || "U").charAt(0).toUpperCase();

  // Helper for action badges
  const getActionBadge = (action: string) => {
    switch (action) {
      case "order_served":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">Served</span>;
      case "order_accepted":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Confirmed</span>;
      case "order_preparing":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Cooking</span>;
      case "order_ready":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">Ready</span>;
      case "bill_settled":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Settled</span>;
      case "order_voided":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Voided</span>;
      case "order_rejected":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Rejected</span>;
      case "menu_stock_toggled":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">Stock</span>;
      case "shift_opened":
      case "shift_closed":
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Shift</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">Action</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner & Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-orange-500/10 to-transparent pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10">
          {/* Avatar Initials */}
          <div className={`w-24 h-24 rounded-2xl bg-gradient-to-tr from-slate-700 to-slate-600 border-2 border-white/20 flex items-center justify-center text-3xl font-black text-orange-400 shadow-md ring-4 ${roleStyling.ring} ring-offset-2 ring-offset-slate-900 flex-shrink-0`}>
            {initial}
          </div>

          <div className="text-center sm:text-left flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {profile?.full_name || "Staff Member"}
              </h1>
              <span className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${roleStyling.bg} ${roleStyling.text} border ${roleStyling.border} shadow-2xs`}>
                {ROLE_DISPLAY_NAMES[currentRole] || currentRole}
              </span>
            </div>

            <p className="text-slate-300 text-xs sm:text-sm flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5">
                <Store className="w-4 h-4 text-orange-400" />
                {restaurant?.name || "AmarMenu Restaurant"}
              </span>
              <span className="flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-slate-400" />
                {user?.email || profile?.email || "No email"}
              </span>
              {profile?.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-slate-400" />
                  {profile.phone}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Role-Specific Today's Quick Performance KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {currentRole === "waiter"
                ? "Orders Served"
                : currentRole === "kitchen"
                ? "Tickets Prepared"
                : currentRole === "cashier"
                ? "Bills Settled"
                : "Orders Finalized"}
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">
            {currentRole === "waiter"
              ? todayStats.ordersServed
              : currentRole === "kitchen"
              ? todayStats.itemsPrepared
              : currentRole === "cashier"
              ? todayStats.billsSettled
              : todayStats.billsSettled + todayStats.ordersServed}
          </p>
          <span className="text-[11px] text-gray-400">Completed today</span>
        </div>

        <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {currentRole === "kitchen"
                ? "Stock Toggles"
                : currentRole === "cashier"
                ? "Shifts Handled"
                : "Orders Confirmed"}
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              {currentRole === "kitchen" ? (
                <UtensilsCrossed className="w-4 h-4" />
              ) : currentRole === "cashier" ? (
                <Receipt className="w-4 h-4" />
              ) : (
                <Award className="w-4 h-4" />
              )}
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">
            {currentRole === "kitchen"
              ? todayStats.stockToggles
              : currentRole === "cashier"
              ? todayStats.shiftsHandled
              : todayStats.ordersAccepted}
          </p>
          <span className="text-[11px] text-gray-400">Logged today</span>
        </div>

        <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Total Actions
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">{todayStats.totalActions}</p>
          <span className="text-[11px] text-gray-400">Work activities today</span>
        </div>

        <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Shift Status
            </span>
            <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-sm font-black text-emerald-600 flex items-center gap-1.5 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            On Duty
          </p>
          <span className="text-[11px] text-gray-400">Logged in & Active</span>
        </div>
      </div>

      {/* Main Grid: Left = Edit Profile & Password, Right = My Work History */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Edit Details & Change Password */}
        <div className="lg:col-span-5 space-y-6">
          {/* Edit Profile Card */}
          <Card>
            <div className="flex items-center space-x-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Personal Information</h3>
                <p className="text-xs text-gray-500">Update your name and mobile number</p>
              </div>
            </div>

            {profileSuccess && (
              <div className="mb-4">
                <Alert type="success" message={profileSuccess} />
              </div>
            )}
            {profileError && (
              <div className="mb-4">
                <Alert type="error" message={profileError} />
              </div>
            )}

            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div>
                <label className="label mb-1.5 text-xs font-bold text-gray-700">Full Name</label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Rahim Uddin"
                  required
                />
              </div>

              <div>
                <label className="label mb-1.5 text-xs font-bold text-gray-700">Phone Number</label>
                <Input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="017XXXXXXXX"
                />
              </div>

              <div>
                <label className="label mb-1.5 text-xs font-bold text-gray-700">Email Address (Read Only)</label>
                <Input
                  type="email"
                  value={user?.email || profile?.email || ""}
                  disabled
                  helperText="Email is permanently linked to your system login"
                />
              </div>

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  loading={profileSaving}
                  icon={<Save className="w-4 h-4" />}
                >
                  Save Profile Changes
                </Button>
              </div>
            </form>
          </Card>

          {/* Change Password Card */}
          <Card>
            <div className="flex items-center space-x-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Change Password</h3>
                <p className="text-xs text-gray-500">Keep your account secure with a strong password</p>
              </div>
            </div>

            {passwordSuccess && (
              <div className="mb-4">
                <Alert type="success" message={passwordSuccess} />
              </div>
            )}
            {passwordError && (
              <div className="mb-4">
                <Alert type="error" message={passwordError} />
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="relative">
                <label className="label mb-1.5 text-xs font-bold text-gray-700">New Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-hidden"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label mb-1.5 text-xs font-bold text-gray-700">Confirm New Password</label>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type new password"
                  required
                />
              </div>

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="outline"
                  fullWidth
                  loading={passwordSaving}
                  icon={<Shield className="w-4 h-4" />}
                >
                  Update Password
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Right Column (7 cols): My Work History */}
        <div className="lg:col-span-7">
          <Card className="h-full flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">My Work History</h3>
                  <p className="text-xs text-gray-500">Your recent order actions and shift milestones</p>
                </div>
              </div>

              <button
                type="button"
                onClick={loadWorkHistory}
                disabled={logsLoading}
                className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh history"
              >
                <RefreshCw className={`w-4 h-4 ${logsLoading ? "animate-spin text-accent" : ""}`} />
              </button>
            </div>

            {/* Work History List */}
            <div className="flex-1 overflow-y-auto max-h-[620px] pr-1 space-y-3">
              {logsLoading ? (
                <div className="py-16 flex flex-col items-center justify-center text-gray-400 text-xs">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <span>Loading your work history...</span>
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="py-16 text-center text-gray-400 p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-semibold text-gray-600">No work actions recorded yet today</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    When you take, prepare, serve orders, or manage shifts, your verified activity log will appear here.
                  </p>
                </div>
              ) : (
                activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/60 hover:bg-white hover:border-gray-200 hover:shadow-xs transition-all flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {getActionBadge(log.action)}
                        <span className="text-xs font-extrabold text-gray-900 truncate">
                          {log.summary}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span>{formatDateTime(log.created_at)}</span>
                        {log.metadata?.table_number && (
                          <span className="bg-gray-200 text-gray-700 px-1.5 py-0.2 rounded text-[10px] font-bold">
                            Table {log.metadata.table_number}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
