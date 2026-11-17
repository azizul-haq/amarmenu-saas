import { useAuth } from "../context/AuthContext";

export interface PermissionSet {
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  canViewReports: boolean;
  canEditMenu: boolean;
  canDeleteMenu: boolean;
  canToggleAvailability: boolean;
  canConfirmOrder: boolean;
  canUpdateKitchenStatus: boolean;
  canSettleBill: boolean;
  canApplyDiscount: boolean;
  canVoidOrder: boolean;
  canVoidSettledBill: boolean;
  canManageShifts: boolean;
  canManageStaff: boolean;
  canChangeSettings: boolean;
  canManageSubscription: boolean;
  canViewFinancials: boolean;
  canViewOrderFinancials: boolean;
}

export const usePermissions = (): PermissionSet => {
  const { permissions, hasPermission, role } = useAuth();

  const isSuper = role === "super_admin";

  return {
    permissions,
    hasPermission,
    canViewReports: isSuper || hasPermission("view_reports"),
    canEditMenu: isSuper || hasPermission("edit_menu"),
    canDeleteMenu: isSuper || hasPermission("delete_menu"),
    canToggleAvailability: isSuper || hasPermission("toggle_availability"),
    canConfirmOrder: isSuper || hasPermission("confirm_order"),
    canUpdateKitchenStatus: isSuper || hasPermission("update_kitchen_status"),
    canSettleBill: isSuper || hasPermission("settle_bill"),
    canApplyDiscount: isSuper || hasPermission("apply_discount"),
    canVoidOrder: isSuper || hasPermission("void_order"),
    canVoidSettledBill: isSuper || hasPermission("void_settled_bill"),
    canManageShifts: isSuper || hasPermission("manage_shifts"),
    canManageStaff: isSuper || hasPermission("manage_staff"),
    canChangeSettings: isSuper || hasPermission("change_settings"),
    canManageSubscription: isSuper || hasPermission("manage_subscription"),
    canViewFinancials: isSuper || hasPermission("view_financials"),
    canViewOrderFinancials: isSuper || hasPermission("view_order_financials"),
  };
};
