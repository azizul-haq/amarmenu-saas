import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserPlus,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Edit2,
} from "lucide-react";
import { Card, Button, Input, Select, Modal, Alert, Loading } from "../../components/ui";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import type { RestaurantStaff } from "../../config/supabase";

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

  const isOwner = currentUserRole === "owner";

  const fetchStaff = useCallback(async () => {
    if (!restaurant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from("restaurant_staff")
        .select("*")
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
        // Update existing staff
        const { error: updateErr } = await supabase
          .from("restaurant_staff")
          .update({
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            role: staffRole,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingStaff.id);

        if (updateErr) throw updateErr;
        setSuccess(`Updated ${fullName.trim()} successfully.`);
      } else {
        // Insert new staff member
        const { error: insertErr } = await supabase
          .from("restaurant_staff")
          .insert({
            restaurant_id: restaurant.id,
            full_name: fullName.trim(),
            email: email.trim().toLowerCase() || null,
            phone: phone.trim() || null,
            role: staffRole,
            is_active: true,
          });

        if (insertErr) throw insertErr;
        setSuccess(`Added new staff member ${fullName.trim()} as ${staffRole}.`);
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
      const { error: toggleErr } = await supabase
        .from("restaurant_staff")
        .update({
          is_active: !staff.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", staff.id);

      if (toggleErr) throw toggleErr;
      setSuccess(`${staff.full_name} is now ${!staff.is_active ? "Active" : "Inactive"}.`);
      await fetchStaff();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update staff status";
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStaff = async (staff: RestaurantStaff) => {
    if (staff.auth_user_id === user?.id) {
      setError("Safety rule: You cannot delete your own staff record.");
      return;
    }

    if (!window.confirm(`Are you sure you want to remove ${staff.full_name}?`)) {
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: delErr } = await supabase
        .from("restaurant_staff")
        .delete()
        .eq("id", staff.id);

      if (delErr) throw delErr;
      setSuccess(`Removed ${staff.full_name} from staff.`);
      await fetchStaff();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to remove staff member";
      setError(message);
    } finally {
      setActionLoading(false);
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                          <XCircle className="w-3.5 h-3.5" />
                          Inactive
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
                            onClick={() => handleToggleStatus(member)}
                            disabled={actionLoading || isCurrentUser}
                            className="p-1 text-slate-500 hover:text-amber-600 disabled:opacity-30 transition-colors"
                            title={isCurrentUser ? "Cannot change own status" : "Toggle Active"}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(member)}
                            disabled={actionLoading || isCurrentUser}
                            className="p-1 text-slate-500 hover:text-red-600 disabled:opacity-30 transition-colors"
                            title={isCurrentUser ? "Cannot delete own record" : "Remove Staff"}
                          >
                            <Trash2 className="w-4 h-4" />
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
        title={editingStaff ? `Edit Role: ${editingStaff.full_name}` : "Add Restaurant Staff Member"}
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
              helperText="Optional: used to link login account"
            />
          )}

          <Input
            label="Phone Number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 017XXXXXXXX"
          />

          <Select
            label="Role & Access Tier"
            value={staffRole}
            onChange={(e) => setStaffRole(e.target.value)}
            options={[
              { value: "owner", label: "Owner — Full administrative authority" },
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
              {editingStaff ? "Save Role Changes" : "Create Staff Record"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default StaffPage;
