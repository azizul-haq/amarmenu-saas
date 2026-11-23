import React, { useState, useEffect, useCallback } from "react";
import {
  Mail,
  Phone,
  Shield,
  Store,
  Clock,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
} from "lucide-react";
import { Button, Input, Alert } from "../components/ui";
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
      // Graceful fallback if stats fail
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
  const initial = (profile?.full_name || user?.email || "U").charAt(0).toUpperCase();

  // Helper for subtle status badges
  const getActionBadge = (action: string) => {
    switch (action) {
      case "order_served":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Served</span>;
      case "order_accepted":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">Confirmed</span>;
      case "order_preparing":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">Cooking</span>;
      case "order_ready":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">Ready</span>;
      case "bill_settled":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Settled</span>;
      case "order_voided":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">Voided</span>;
      case "order_rejected":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-200">Rejected</span>;
      case "menu_stock_toggled":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">Stock</span>;
      case "shift_opened":
      case "shift_closed":
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">Shift</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">Action</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Clean Flat Header Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-none">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {/* Simple Neutral Avatar */}
            <div className="w-14 h-14 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-lg font-bold text-slate-700 flex-shrink-0">
              {initial}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900 truncate">
                  {profile?.full_name || "Staff Member"}
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200/60 capitalize">
                  {ROLE_DISPLAY_NAMES[currentRole] || currentRole}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="truncate">{restaurant?.name || "AmarMenu Restaurant"}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="truncate">{user?.email || profile?.email || "No email"}</span>
                </span>
                {profile?.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span>{profile.phone}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compact Flat 4-Column Metric Strip */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 overflow-hidden shadow-none">
        {/* Metric 1 */}
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">
            {currentRole === "waiter"
              ? "Orders Served"
              : currentRole === "kitchen"
              ? "Tickets Prepared"
              : currentRole === "cashier"
              ? "Bills Settled"
              : "Orders Finalized"}
          </p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">
            {currentRole === "waiter"
              ? todayStats.ordersServed
              : currentRole === "kitchen"
              ? todayStats.itemsPrepared
              : currentRole === "cashier"
              ? todayStats.billsSettled
              : todayStats.billsSettled + todayStats.ordersServed}
          </p>
        </div>

        {/* Metric 2 */}
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">
            {currentRole === "kitchen"
              ? "Stock Toggles"
              : currentRole === "cashier"
              ? "Shifts Handled"
              : "Orders Confirmed"}
          </p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">
            {currentRole === "kitchen"
              ? todayStats.stockToggles
              : currentRole === "cashier"
              ? todayStats.shiftsHandled
              : todayStats.ordersAccepted}
          </p>
        </div>

        {/* Metric 3 */}
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total Actions</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">
            {todayStats.totalActions}
          </p>
        </div>

        {/* Metric 4 */}
        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Shift Status</p>
          <p className="text-sm font-semibold text-emerald-600 flex items-center gap-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            On Duty
          </p>
        </div>
      </div>

      {/* Main Grid: Left = Edit Profile & Password, Right = My Work History */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Edit Details & Change Password */}
        <div className="lg:col-span-5 space-y-6">
          {/* Edit Profile Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-none">
            <div className="mb-5 pb-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Personal Information</h2>
              <p className="text-xs text-slate-500 mt-0.5">Update your display name and contact number</p>
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
                <label className="block mb-1 text-xs font-medium text-slate-700">Full Name</label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Rahim Uddin"
                  required
                />
              </div>

              <div>
                <label className="block mb-1 text-xs font-medium text-slate-700">Phone Number</label>
                <Input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="017XXXXXXXX"
                />
              </div>

              <div>
                <label className="block mb-1 text-xs font-medium text-slate-700">Email Address (Read Only)</label>
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
          </div>

          {/* Change Password Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-none">
            <div className="mb-5 pb-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Change Password</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ensure your account uses a secure password</p>
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
                <label className="block mb-1 text-xs font-medium text-slate-700">New Password</label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block mb-1 text-xs font-medium text-slate-700">Confirm New Password</label>
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
          </div>
        </div>

        {/* Right Column (7 cols): My Work History */}
        <div className="lg:col-span-7">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-none h-full flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">My Work History</h2>
                <p className="text-xs text-slate-500 mt-0.5">Your recent order actions and shift milestones</p>
              </div>

              <button
                type="button"
                onClick={loadWorkHistory}
                disabled={logsLoading}
                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                title="Refresh history"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? "animate-spin text-slate-700" : ""}`} />
              </button>
            </div>

            {/* Work History List */}
            <div className="flex-1 overflow-y-auto max-h-[620px] pr-1 space-y-2.5">
              {logsLoading ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-400 text-xs">
                  <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mb-2" />
                  <span>Loading work history...</span>
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="py-16 text-center text-slate-400 p-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Clock className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-medium text-slate-600">No work actions recorded yet today</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    When you take, prepare, serve orders, or manage shifts, your verified activity log will appear here.
                  </p>
                </div>
              ) : (
                activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg border border-slate-200/70 bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {getActionBadge(log.action)}
                        <span className="text-xs font-medium text-slate-800 truncate">
                          {log.summary}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        <span>{formatDateTime(log.created_at)}</span>
                        {log.metadata?.table_number && (
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-200">
                            Table {log.metadata.table_number}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
