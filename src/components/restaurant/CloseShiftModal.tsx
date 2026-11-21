import React, { useState } from "react";
import { DoorClosed, Calculator, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ZReportData } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";
import { closeShiftSchema } from "../../schemas/shiftSchema";
import { closeCashShift } from "../../services/shiftService";
import type { ActiveShiftDetails } from "../../services/shiftService";
import { Button } from "../ui";

interface CloseShiftModalProps {
  shift: ActiveShiftDetails;
  onClose: () => void;
  onClosed: (report: ZReportData) => void;
}

export const CloseShiftModal: React.FC<CloseShiftModalProps> = ({
  shift,
  onClose,
  onClosed,
}) => {
  const openingFloat = shift.opening_float || 0;
  const cashSales = shift.live_cash_sales || 0;
  const expectedCash = shift.live_expected_cash || openingFloat + cashSales;

  const [closingCount, setClosingCount] = useState<number>(expectedCash);
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const discrepancy = (Number(closingCount) || 0) - expectedCash;
  const hasShortage = discrepancy < 0;
  const hasOverage = discrepancy > 0;
  const isBalanced = discrepancy === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = closeShiftSchema.safeParse({
      closing_count: Number(closingCount) || 0,
      notes: notes || undefined,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid closing count");
      return;
    }

    if (!shift.shift_id) {
      setError("Active shift ID not found");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await closeCashShift(
        shift.shift_id,
        Number(closingCount) || 0,
        notes
      );

      if (!res.success || !res.data) {
        setError(res.error || "Failed to close cash shift");
        return;
      }

      onClosed(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error closing shift";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-900 text-white">
          <div className="flex items-center gap-2">
            <DoorClosed className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="font-bold text-base leading-tight">
                Close Shift & Drawer Reconciliation
              </h3>
              <p className="text-xs text-gray-400">
                Opened by {shift.opened_by_name || "Cashier"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {/* System Calculation Breakdown */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>Opening Float:</span>
              <span className="font-semibold">{formatCurrency(openingFloat)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Cash Sales Collected (+):</span>
              <span className="font-semibold text-emerald-700">
                +{formatCurrency(cashSales)}
              </span>
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-gray-300 font-bold text-gray-900 text-sm">
              <span>System Expected Cash:</span>
              <span className="text-base text-gray-900 font-mono">
                {formatCurrency(expectedCash)}
              </span>
            </div>
          </div>

          {/* Actual Cash Counted */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-gray-700">
                Actual Cash Counted in Drawer (৳) <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setClosingCount(expectedCash)}
                className="text-[11px] text-emerald-600 hover:underline font-bold"
              >
                Match Expected ({expectedCash})
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                ৳
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={closingCount === 0 ? "" : closingCount}
                onChange={(e) => setClosingCount(e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                required
                className="w-full pl-8 pr-3 py-2.5 border border-gray-300 rounded-lg text-lg font-bold font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
          </div>

          {/* Discrepancy Display Banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
              hasShortage
                ? "bg-red-50 border-red-200 text-red-900"
                : hasOverage
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
            }`}
          >
            <div className="flex items-center gap-2">
              {isBalanced ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : (
                <AlertTriangle
                  className={`w-5 h-5 ${
                    hasShortage ? "text-red-600" : "text-amber-600"
                  }`}
                />
              )}
              <div>
                <span className="font-bold block">
                  {isBalanced
                    ? "Drawer Perfectly Balanced"
                    : hasShortage
                    ? "Cash Shortage Detected"
                    : "Cash Overage Detected"}
                </span>
                <span className="text-[11px] opacity-80">
                  {isBalanced
                    ? "Physical cash matches system records"
                    : hasShortage
                    ? "Physical cash is less than system expected"
                    : "Physical cash exceeds system expected"}
                </span>
              </div>
            </div>
            <span className="text-lg font-black font-mono">
              {hasShortage ? "-" : hasOverage ? "+" : ""}
              {formatCurrency(Math.abs(discrepancy))}
            </span>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Closing Notes / Reason for Discrepancy
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid ৳200 for emergency lemon purchase from drawer"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              fullWidth
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold"
            >
              {isSubmitting ? (
                <span>Reconciling & Closing...</span>
              ) : (
                <>
                  <Calculator className="w-4 h-4" />
                  <span>Close Shift & Z-Report</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
