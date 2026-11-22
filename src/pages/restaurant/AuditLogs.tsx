import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Clock,
  User,
  FileText,
} from "lucide-react";
import { Card, Button, Loading } from "../../components/ui";
import { getRestaurantAuditLogs } from "../../services/auditService";
import type { AuditLog } from "../../config/supabase";
import { formatDateTime } from "../../utils/helpers";
import { useAuth } from "../../context/AuthContext";

export const AuditLogsPage: React.FC = () => {
  const { restaurant, restaurantId: authRestaurantId } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterAction, setFilterAction] = useState<string>("all");
  const [restaurantId, setRestaurantId] = useState<string>(authRestaurantId || restaurant?.id || "");

  useEffect(() => {
    let targetRestaurantId = authRestaurantId || restaurant?.id || "";

    if (!targetRestaurantId) {
      const currentRestaurant = sessionStorage.getItem("current_restaurant");
      if (currentRestaurant) {
        try {
          const parsed = JSON.parse(currentRestaurant);
          targetRestaurantId = parsed.id || "";
        } catch {
          // fallback
        }
      }
    }

    if (!targetRestaurantId) {
      setLoading(false);
      return;
    }

    setRestaurantId(targetRestaurantId);
    loadLogs(targetRestaurantId);
  }, [authRestaurantId, restaurant?.id]);

  const loadLogs = async (rId: string) => {
    setLoading(true);
    const data = await getRestaurantAuditLogs(rId, 100);
    setLogs(data);
    setLoading(false);
  };

  const filteredLogs = logs.filter((log) => {
    if (filterAction === "all") return true;
    return log.action === filterAction;
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "void_order":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
            VOID ORDER
          </span>
        );
      case "void_item":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            VOID ITEM
          </span>
        );
      case "apply_discount":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
            DISCOUNT
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-800 border border-gray-200">
            {action.toUpperCase()}
          </span>
        );
    }
  };

  if (loading) {
    return <Loading text="Loading immutable audit logs..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-red-600" />
            <span>Audit Logs & Security Trail</span>
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Append-only, immutable record of all manager overrides, order voids,
            and sensitive financial adjustments.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadLogs(restaurantId)}
          className="flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Immutability Banner */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900 leading-relaxed">
          <p className="font-bold">Database Append-Only Protection Active</p>
          <p className="text-emerald-800 mt-0.5">
            Every audit entry recorded below is cryptographically enforced by
            database triggers. Rows can never be edited or deleted by any staff
            member, manager, or super administrator.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {[
          { id: "all", label: "All Logs" },
          { id: "void_order", label: "Void Orders" },
          { id: "void_item", label: "Void Items" },
          { id: "apply_discount", label: "Discounts" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterAction(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              filterAction === tab.id
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Logs Table / Cards */}
      {filteredLogs.length === 0 ? (
        <Card className="text-center py-16 px-4">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-bold text-gray-800 mb-1">
            No Audit Logs Recorded
          </h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Sensitive actions like order voids, bill cancellations, and manager
            overrides will automatically be captured here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => (
            <Card
              key={log.id}
              className="p-4 border border-border hover:border-gray-300 transition-all"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                {/* Left: Action & Reason */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    {getActionBadge(log.action)}
                    <span className="text-xs font-mono font-bold text-gray-800">
                      Entity: {log.entity_type.toUpperCase()} #
                      {log.old_values && typeof log.old_values === "object" && "order_number" in log.old_values
                        ? String(log.old_values.order_number)
                        : log.entity_id.slice(0, 8)}
                    </span>
                  </div>

                  <div className="text-xs bg-red-50/70 border border-red-100 rounded-lg p-2 text-red-950 font-medium">
                    <span className="font-bold text-red-800">Reason: </span>
                    {log.reason}
                  </div>

                  {/* Snapshot of Changes */}
                  {log.old_values && (
                    <div className="text-[11px] text-gray-500 space-x-2">
                      <span>Previous Status: <strong className="text-gray-700">{String(log.old_values.status || "N/A")}</strong></span>
                      {Boolean(log.old_values.total) && (
                        <span>• Amount: <strong className="text-gray-700">৳{String(log.old_values.total)}</strong></span>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Meta (Actor, Timestamp) */}
                <div className="text-xs text-right sm:border-l sm:border-gray-200 sm:pl-4 space-y-1">
                  <div className="flex items-center sm:justify-end gap-1 text-gray-700 font-semibold">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span>{log.actor_name || "Staff"}</span>
                    <span className="text-[10px] text-gray-500 font-normal">
                      ({log.actor_role || "staff"})
                    </span>
                  </div>
                  <div className="flex items-center sm:justify-end gap-1 text-[11px] text-gray-500">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span>{formatDateTime(log.created_at)}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditLogsPage;
