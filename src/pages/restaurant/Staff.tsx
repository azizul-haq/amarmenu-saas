import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserPlus,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Edit2,
  KeyRound,
  Copy,
  Check,
  Ban,
} from "lucide-react";
import { Card, Button, Input, Select, Modal, Alert, Loading } from "../../components/ui";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import type { RestaurantStaff } from "../../config/supabase";
import { copyToClipboard as copyTextToClipboard } from "../../utils/helpers";

export const StaffPage: React.FC = () => {
  const { user, restaurant, role: currentUserRole } = useAuth();
  const [staffList, setStaffList] = useState<RestaurantStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<RestaurantStaff | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [staffRole, setStaffRole] = useState<string>("waiter");

  // Temporary password modal state (for newly invited or password reset staff)
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    isOpen: boolean;
    name: string;
    phone: string;
    tempPassword: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = currentUserRole === "owner";

  const fetchStaff = useCallback(async () => {
    if (!restaurant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from("restaurant_staff")
        .select("id, auth_user_id, restaurant_id, full_name, phone, email, role, is_active, created_at, updated_at")
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: true });

      if (fetchErr) throw fetchErr;
      setStaffList(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load staff list";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [restaurant?.id]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const openAddModal = () => {
    setEditingStaff(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setStaffRole("waiter");
    setIsModalOpen(true);
  };

  const openEditModal = (staff: RestaurantStaff) => {
    setEditingStaff(staff);
    setFullName(staff.full_name);
    setEmail(staff.email || "");
    setPhone(staff.phone || "");
    setStaffRole(staff.role);
    setIsModalOpen(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant?.id) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingStaff) {
        // Update staff via Edge Function
        const { data, error: fnError } = await supabase.functions.invoke("invite-staff", {
          body: {
            action: "update",
            staff_id: editingStaff.id,
            full_name: fullName.trim(),
            phone: phone.trim() || undefined,
            role: staffRole,
          },
        });

        if (fnError || data?.error) {
          throw new Error(fnError?.message || data?.error || "Failed to update staff member");
        }

        setSuccess(`Updated ${fullName.trim()} successfully.`);
      } else {
        // Invite new staff via Edge Function
        const { data, error: fnError } = await supabase.functions.invoke("invite-staff", {
          body: {
            action: "invite",
            full_name: fullName.trim(),
            phone: phone.trim(),
            email: email.trim() || undefined,
            role: staffRole,
          },
        });

        if (fnError || data?.error) {
          throw new Error(fnError?.message || data?.error || "Failed to invite staff member");
        }

        setSuccess(`Invited ${fullName.trim()} as ${staffRole}.`);

        // Display temporary password to owner
        if (data.tempPassword) {
          setTempPasswordModal({
            isOpen: true,
            name: fullName.trim(),
            phone: phone.trim(),
            tempPassword: data.tempPassword,
          });
        }
      }

      setIsModalOpen(false);
      await fetchStaff();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save staff member";
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (staff: RestaurantStaff) => {
    if (staff.auth_user_id === user?.id) {
      setError("Safety rule: You cannot change your own active status.");
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const newActive = !staff.is_active;
      const { data, error: fnError } = await supabase.functions.invoke("invite-staff", {
        body: {
          action: "toggle_active",
          staff_id: staff.id,
          is_active: newActive,
        },
      });

      if (fnError || data?.error) {
        throw new Error(fnError?.message || data?.error || "Failed to update staff status");
      }

      setSuccess(
        `${staff.full_name} is now ${newActive ? "Active" : "Inactive (Auth access revoked)"}.`
      );
      await fetchStaff();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update staff status";
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (staff: RestaurantStaff) => {
    if (staff.role === "owner") {
      setError("Password cannot be reset for an owner account via this action.");
      return;
    }

    if (!window.confirm(`Generate a new temporary password for ${staff.full_name}?`)) {
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("invite-staff", {
        body: {
          action: "reset_password",
          staff_id: staff.id,
        },
      });

      if (fnError || data?.error) {
        throw new Error(fnError?.message || data?.error || "Failed to reset password");
      }

      if (data.tempPassword) {
        setTempPasswordModal({
          isOpen: true,
          name: staff.full_name,
          phone: staff.phone || "",
          tempPassword: data.tempPassword,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reset staff password";
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "manager":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "cashier":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "kitchen":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "waiter":
        return "bg-slate-100 text-slate-800 border-slate-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loading text="Loading staff directory..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-7 h-7 text-orange-600" />
            Staff & Team Permissions
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your restaurant roster, role assignments, and granular RBAC security.
          </p>
        </div>

        {isOwner && (
          <Button
            onClick={openAddModal}
            icon={<UserPlus className="w-4 h-4" />}
            className="shadow-sm"
          >
            Add Team Member
          </Button>
        )}
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {success && <Alert type="success" message={success} onClose={() => setSuccess(null)} />}

      {/* Permissions Matrix Reference Banner */}
      <Card className="bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50/50 border-orange-200/80">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 space-y-1">
            <span className="font-semibold text-slate-900">Database-Enforced RBAC Active:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-1">
              <div className="bg-white/80 p-2 rounded border border-orange-100">
                <span className="font-bold text-purple-700 block">Owner</span>
                Full control, void settled bills, manage staff & subscription.
              </div>
              <div className="bg-white/80 p-2 rounded border border-orange-100">
                <span className="font-bold text-blue-700 block">Manager</span>
                Menu edit, reports, discount, shifts. No staff or void settled bills.
              </div>
              <div className="bg-white/80 p-2 rounded border border-orange-100">
                <span className="font-bold text-emerald-700 block">Cashier</span>
                Confirm orders, settle bills (0% discount), cash shifts & Z-report.
              </div>
              <div className="bg-white/80 p-2 rounded border border-orange-100">
                <span className="font-bold text-amber-700 block">Kitchen</span>
                KDS live orders, item availability toggle. Zero financial access.
              </div>
              <div className="bg-white/80 p-2 rounded border border-orange-100">
                <span className="font-bold text-slate-700 block">Waiter</span>
                Confirm & view customer orders. No kitchen status or bill settlement.
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Staff Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Contact Info</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {staffList.map((member) => {
                const isCurrentUser = member.auth_user_id === user?.id;
                return (
                  <tr key={member.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-700">
                          {member.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span>{member.full_name}</span>
                          {isCurrentUser && (
                            <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-normal">
                              You
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${getRoleBadge(
                          member.role
                        )}`}
                      >
                        {member.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      <div>{member.phone || "—"}</div>
                      <div className="text-slate-400">{member.email || "—"}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      {member.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                          <Ban className="w-3.5 h-3.5" />
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {isOwner ? (
                        <div className="inline-flex items-center space-x-2">
                          <button
                            onClick={() => openEditModal(member)}
                            disabled={actionLoading || isCurrentUser}
                            className="p-1 text-slate-500 hover:text-blue-600 disabled:opacity-30 transition-colors"
                            title={isCurrentUser ? "Cannot edit own role" : "Edit Role"}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleResetPassword(member)}
                            disabled={actionLoading || member.role === "owner"}
                            className="p-1 text-slate-500 hover:text-purple-600 disabled:opacity-30 transition-colors"
                            title={
                              member.role === "owner"
                                ? "Cannot reset owner password"
                                : "Reset Temp Password"
                            }
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(member)}
                            disabled={actionLoading || isCurrentUser}
                            className={`p-1 disabled:opacity-30 transition-colors ${
                              member.is_active
                                ? "text-slate-500 hover:text-rose-600"
                                : "text-emerald-600 hover:text-emerald-700"
                            }`}
                            title={
                              isCurrentUser
                                ? "Cannot change own status"
                                : member.is_active
                                ? "Deactivate (Revoke Access)"
                                : "Reactivate Staff"
                            }
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add / Edit Staff Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingStaff ? `Edit Role: ${editingStaff.full_name}` : "Invite Restaurant Staff Member"}
      >
        <form onSubmit={handleSaveStaff} className="space-y-4">
          <Input
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Rahim Ahmed"
            required
          />

          {!editingStaff && (
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. rahim@restaurant.com"
              helperText="Optional: if left blank, staff can log in using their phone number"
            />
          )}

          <Input
            label="Phone Number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 017XXXXXXXX"
            helperText="11-digit Bangladeshi mobile number (e.g. 01712345678)"
            required={!editingStaff}
          />

          <Select
            label="Role & Access Tier"
            value={staffRole}
            onChange={(e) => setStaffRole(e.target.value)}
            options={[
              { value: "manager", label: "Manager — Operations, reports & discounts" },
              { value: "cashier", label: "Cashier — Billing, cash shifts & orders" },
              { value: "kitchen", label: "Kitchen — KDS preparation & availability" },
              { value: "waiter", label: "Waiter — Table orders & status viewing" },
            ]}
          />

          <div className="pt-4 flex items-center justify-end space-x-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button type="submit" loading={actionLoading}>
              {editingStaff ? "Save Role Changes" : "Send Invite & Generate Password"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Temporary Password Display Modal */}
      {tempPasswordModal && (
        <Modal
          isOpen={tempPasswordModal.isOpen}
          onClose={() => setTempPasswordModal(null)}
          title="Staff Temporary Password"
        >
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              <p className="font-semibold">Share this one-time temporary password with {tempPasswordModal.name}:</p>
              <p className="text-xs text-amber-700 mt-1">
                They will be forced to choose their own secure password immediately upon first login.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Login Phone / Identifier
              </label>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded font-mono text-sm text-slate-800">
                {tempPasswordModal.phone || "—"}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Temporary Password
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-2.5 bg-slate-100 border border-slate-300 rounded font-mono text-lg font-bold text-purple-700 tracking-wider">
                  {tempPasswordModal.tempPassword}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyToClipboard(tempPasswordModal.tempPassword)}
                  icon={copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="pt-4 flex justify-end border-t border-slate-100">
              <Button onClick={() => setTempPasswordModal(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default StaffPage;
