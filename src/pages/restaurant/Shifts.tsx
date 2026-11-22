import React, { useState, useEffect } from "react";
import {
  DoorOpen,
  DoorClosed,
  Calculator,
  RefreshCw,
} from "lucide-react";
import { Card, Button, Loading } from "../../components/ui";
import {
  getActiveCashShift,
  getCashShiftsHistory,
} from "../../services/shiftService";
import type { ActiveShiftDetails } from "../../services/shiftService";
import type { CashShift, ZReportData } from "../../config/supabase";
import { formatCurrency, formatDateTime } from "../../utils/helpers";
import { OpenShiftModal } from "../../components/restaurant/OpenShiftModal";
import { CloseShiftModal } from "../../components/restaurant/CloseShiftModal";
import { ZReportModal } from "../../components/restaurant/ZReportModal";
import { useAuth } from "../../context/AuthContext";

export const ShiftsPage: React.FC = () => {
  const { restaurant: authRestaurant, restaurantId: authRestaurantId } = useAuth();
  const [activeShift, setActiveShift] = useState<ActiveShiftDetails | null>(null);
  const [history, setHistory] = useState<CashShift[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [restaurantId, setRestaurantId] = useState<string>(authRestaurantId || authRestaurant?.id || "");
  const [restaurantName, setRestaurantName] = useState<string>(authRestaurant?.name || "Restaurant");

  // Modals
  const [showOpenModal, setShowOpenModal] = useState<boolean>(false);
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);
  const [viewZReport, setViewZReport] = useState<ZReportData | null>(null);

  useEffect(() => {
    let targetRestaurantId = authRestaurantId || authRestaurant?.id || "";
    let targetName = authRestaurant?.name || "";

    if (!targetRestaurantId) {
      const currentRestaurant = sessionStorage.getItem("current_restaurant");
      if (currentRestaurant) {
        try {
          const parsed = JSON.parse(currentRestaurant);
          targetRestaurantId = parsed.id || "";
          if (parsed.name) targetName = parsed.name;
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
    if (targetName) setRestaurantName(targetName);
    loadShiftData(targetRestaurantId);
  }, [authRestaurantId, authRestaurant?.id]);

  const loadShiftData = async (rId: string) => {
    setLoading(true);
    const [current, past] = await Promise.all([
      getActiveCashShift(rId),
      getCashShiftsHistory(rId, 30),
    ]);
    setActiveShift(current);
    setHistory(past);
    setLoading(false);
  };

  const handleOpenSuccess = () => {
    setShowOpenModal(false);
    loadShiftData(restaurantId);
  };

  const handleCloseSuccess = (report: ZReportData) => {
    setShowCloseModal(false);
    setViewZReport(report);
    loadShiftData(restaurantId);
  };

  if (loading) {
    return <Loading text="Loading cash drawer shifts & reconciliation..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <Calculator className="w-7 h-7 text-emerald-600" />
            <span>Cash Drawer Shifts & Z-Reports</span>
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Manage daily cash drawer floats, reconcile physical cash counts, and
            generate fiscal End-of-Day (EOD) Z-reports.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadShiftData(restaurantId)}
          className="flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Active Shift Card / Action Hero */}
      {activeShift?.has_active_shift ? (
        <Card className="p-6 border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-50/40 to-white shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <h3 className="text-lg font-bold text-gray-900">
                  Active Cash Shift in Progress
                </h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  OPEN
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
                <div>
                  <span className="text-xs text-gray-500 block">Opened By</span>
                  <span className="font-semibold text-sm text-gray-800">
                    {activeShift.opened_by_name || "Cashier"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Opening Time</span>
                  <span className="font-semibold text-sm text-gray-800">
                    {formatDateTime(activeShift.opening_time || "")}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Opening Float</span>
                  <span className="font-mono font-bold text-sm text-gray-900">
                    {formatCurrency(activeShift.opening_float || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Expected Cash So Far</span>
                  <span className="font-mono font-black text-base text-emerald-700">
                    {formatCurrency(activeShift.live_expected_cash || 0)}
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-600 flex gap-4 pt-1">
                <span>
                  Cash Sales: <strong>{formatCurrency(activeShift.live_cash_sales || 0)}</strong>
                </span>
                <span>•</span>
                <span>
                  Digital Sales: <strong>{formatCurrency(activeShift.live_digital_sales || 0)}</strong>
                </span>
                <span>•</span>
                <span>
                  Completed Orders: <strong>{activeShift.live_completed_orders || 0}</strong>
                </span>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={() => setShowCloseModal(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center justify-center gap-2 py-3 px-6 shadow-md shrink-0"
            >
              <DoorClosed className="w-5 h-5" />
              <span>Close Shift & Reconcile</span>
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-6 border-dashed border-2 border-gray-300 bg-gray-50/50 text-center py-10">
          <DoorOpen className="w-12 h-12 text-gray-400 mx-auto mb-3 opacity-60" />
          <h3 className="text-lg font-bold text-gray-900 mb-1">
            No Active Cash Shift
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-5">
            Open a cash drawer shift by entering an opening float (petty cash) to
            start tracking cash collections and daily reconciliation.
          </p>
          <Button
            variant="primary"
            onClick={() => setShowOpenModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-2"
          >
            <DoorOpen className="w-4 h-4" />
            <span>Open Cash Shift</span>
          </Button>
        </Card>
      )}

      {/* Shift History Table */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-gray-900">
          Past Shifts & Z-Report History
        </h3>

        {history.length === 0 ? (
          <Card className="p-8 text-center text-xs text-gray-500">
            No past shift records found. Closed shifts will appear here with
            discrepancy and sales reports.
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-border text-gray-600 uppercase font-semibold">
                <tr>
                  <th className="px-4 py-3">Shift Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Float</th>
                  <th className="px-4 py-3">Cash Sales</th>
                  <th className="px-4 py-3">Expected Cash</th>
                  <th className="px-4 py-3">Actual Counted</th>
                  <th className="px-4 py-3">Discrepancy</th>
                  <th className="px-4 py-3">Gross Sales</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {history.map((s) => {
                  const hasShortage = (s.discrepancy || 0) < 0;
                  const hasOverage = (s.discrepancy || 0) > 0;

                  return (
                    <tr key={s.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-gray-900">
                          {formatDateTime(s.opening_time)}
                        </div>
                        {s.closing_time && (
                          <div className="text-[11px] text-gray-500">
                            to {formatDateTime(s.closing_time)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {s.status === "open" ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            OPEN
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
                            CLOSED
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono">
                        {formatCurrency(s.opening_float)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-emerald-700 font-bold">
                        {formatCurrency(s.cash_sales || 0)}
                      </td>
                      <td className="px-4 py-3.5 font-mono">
                        {formatCurrency(s.expected_cash || 0)}
                      </td>
                      <td className="px-4 py-3.5 font-mono font-bold">
                        {s.closing_count !== null && s.closing_count !== undefined
                          ? formatCurrency(s.closing_count)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono font-bold">
                        {s.discrepancy !== null && s.discrepancy !== undefined ? (
                          <span
                            className={
                              hasShortage
                                ? "text-red-700"
                                : hasOverage
                                ? "text-emerald-700"
                                : "text-gray-600"
                            }
                          >
                            {hasShortage ? "-" : hasOverage ? "+" : ""}
                            {formatCurrency(Math.abs(s.discrepancy))}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono font-black text-gray-900">
                        {formatCurrency(s.total_sales || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {s.status === "closed" && (
                          <button
                            onClick={() => {
                              // Construct ZReportData for modal preview
                              const reportData: ZReportData = {
                                success: true,
                                z_report_number: `Z-${s.id.slice(0, 8).toUpperCase()}`,
                                shift_id: s.id,
                                status: "closed",
                                restaurant: {
                                  id: s.restaurant_id,
                                  name: restaurantName,
                                },
                                timings: {
                                  opened_at: s.opening_time,
                                  closed_at: s.closing_time || s.opening_time,
                                  opened_by: "Cashier",
                                  closed_by: "Cashier",
                                },
                                cash_reconciliation: {
                                  opening_float: s.opening_float,
                                  cash_sales: s.cash_sales || 0,
                                  expected_cash: s.expected_cash || 0,
                                  actual_cash_counted: s.closing_count || 0,
                                  discrepancy: s.discrepancy || 0,
                                  is_balanced: s.discrepancy === 0,
                                  has_shortage: (s.discrepancy || 0) < 0,
                                  has_overage: (s.discrepancy || 0) > 0,
                                },
                                sales_summary: {
                                  gross_sales: s.total_sales || 0,
                                  cash_sales: s.cash_sales || 0,
                                  digital_sales: s.digital_sales || 0,
                                  bkash_sales: 0,
                                  nagad_sales: 0,
                                  card_sales: 0,
                                  tax_collected: s.tax_collected || 0,
                                  discount_total: s.discount_total || 0,
                                  completed_orders_count: s.total_orders || 0,
                                  dine_in_orders_count: 0,
                                  takeaway_orders_count: 0,
                                  voided_orders_count: s.voided_orders || 0,
                                },
                                notes: s.notes,
                              };
                              setViewZReport(reportData);
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition"
                          >
                            Z-Report
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open Shift Modal */}
      {showOpenModal && (
        <OpenShiftModal
          onClose={() => setShowOpenModal(false)}
          onOpened={handleOpenSuccess}
        />
      )}

      {/* Close Shift Modal */}
      {showCloseModal && activeShift && (
        <CloseShiftModal
          shift={activeShift}
          onClose={() => setShowCloseModal(false)}
          onClosed={handleCloseSuccess}
        />
      )}

      {/* Fiscal Z-Report Thermal / CSV Modal */}
      {viewZReport && (
        <ZReportModal
          report={viewZReport}
          onClose={() => setViewZReport(null)}
        />
      )}
    </div>
  );
};

export default ShiftsPage;
