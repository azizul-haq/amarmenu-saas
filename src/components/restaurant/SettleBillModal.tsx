import React, { useState } from "react";
import { X, DollarSign, Calculator, Check, AlertCircle } from "lucide-react";
import type { Order } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";
import { settleOrderBill } from "../../services/restaurantService";
import type { BillSettlementResult } from "../../services/restaurantService";
import { cashSettlementSchema } from "../../schemas/billingSchema";
import { Button } from "../ui";
import { usePermissions } from "../../hooks/usePermissions";

interface SettleBillModalProps {
  order: Order;
  onClose: () => void;
  onSettled: (result: BillSettlementResult) => void;
}

export const SettleBillModal: React.FC<SettleBillModalProps> = ({
  order,
  onClose,
  onSettled,
}) => {
  const { canApplyDiscount } = usePermissions();
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [discount, setDiscount] = useState<number>(order.discount || 0);
  const [tenderedAmount, setTenderedAmount] = useState<number>(order.total);
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate net payable (rounded to 2 decimal places)
  const netPayable = Math.round(Math.max(0, order.total - (Number(discount) || 0)) * 100) / 100;
  const changeAmount = Math.round(Math.max(0, (Number(tenderedAmount) || 0) - netPayable) * 100) / 100;
  const isCashInsufficient =
    paymentMethod === "cash" && (Number(tenderedAmount) || 0) < netPayable - 0.005;

  // Preset quick cash buttons
  const handleQuickCash = (amount: number) => {
    setTenderedAmount(Math.round(amount * 100) / 100);
  };

  const handleAddCash = (increment: number) => {
    setTenderedAmount((prev) => Math.round(((Number(prev) || 0) + increment) * 100) / 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedTendered = Math.round((parseFloat(String(tenderedAmount)) || 0) * 100) / 100;
    const parsedDiscount = Math.round((parseFloat(String(discount)) || 0) * 100) / 100;

    // Validate using Zod schema
    const validation = cashSettlementSchema.safeParse({
      payment_method: paymentMethod,
      tendered_amount: parsedTendered,
      discount: parsedDiscount,
      notes: notes || undefined,
      payable_total: order.total,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid settlement data");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await settleOrderBill(
        order.id,
        paymentMethod,
        parsedTendered,
        parsedDiscount,
        notes
      );

      if (!res.success || !res.data) {
        setError(res.error || "Failed to settle bill");
        return;
      }

      onSettled(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Settlement error";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-900 text-white">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-base leading-tight">Settle Bill & Payment</h3>
              <p className="text-xs text-gray-400">
                Order #{order.order_number}{" "}
                {order.table_number ? `• Table ${order.table_number}` : ""}
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Bill Summary Card */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Order Subtotal:</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>VAT / Taxes:</span>
              <span>{formatCurrency(order.tax)}</span>
            </div>
            {order.total !== netPayable && (
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>Discount Applied:</span>
                <span>-{formatCurrency(discount || 0)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-2 border-t border-gray-200">
              <span className="font-bold text-gray-900">Net Payable:</span>
              <span className="text-xl font-black text-gray-900">
                {formatCurrency(netPayable)}
              </span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Payment Method
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: "cash", label: "Cash" },
                { id: "bkash", label: "bKash" },
                { id: "nagad", label: "Nagad" },
                { id: "card", label: "Card" },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(m.id);
                    if (m.id !== "cash") {
                      // For digital/card, exact payment is customary
                      setTenderedAmount(netPayable);
                    }
                  }}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    paymentMethod === m.id
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Discount Field */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-semibold text-gray-700">
                Discount (৳) (Optional)
              </label>
              {!canApplyDiscount && (
                <span className="text-[10px] text-amber-700 font-medium bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  Manager/Owner only
                </span>
              )}
            </div>
            <input
              type="number"
              min="0"
              max={order.total}
              step="0.01"
              disabled={!canApplyDiscount}
              value={discount === 0 ? "" : discount}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                setDiscount(val);
                if (paymentMethod !== "cash" || tenderedAmount === netPayable) {
                  setTenderedAmount(Math.round(Math.max(0, order.total - val) * 100) / 100);
                }
              }}
              placeholder={canApplyDiscount ? "0.00" : "Discount requires manager/owner role"}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${
                !canApplyDiscount
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  : "border-gray-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              }`}
            />
          </div>

          {/* Cash Tendered & Quick Presets */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-gray-700">
                Tendered / Received Amount (৳)
              </label>
              <button
                type="button"
                onClick={() => handleQuickCash(netPayable)}
                className="text-xs text-emerald-600 hover:underline font-bold"
              >
                Exact ({formatCurrency(netPayable)})
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={tenderedAmount === 0 ? "" : tenderedAmount}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                setTenderedAmount(val);
              }}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg font-bold text-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />

            {/* Quick Cash Buttons */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => handleAddCash(50)}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold transition"
              >
                +৳50
              </button>
              <button
                type="button"
                onClick={() => handleAddCash(100)}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold transition"
              >
                +৳100
              </button>
              <button
                type="button"
                onClick={() => handleQuickCash(500)}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold transition"
              >
                ৳500
              </button>
              <button
                type="button"
                onClick={() => handleQuickCash(1000)}
                className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold transition"
              >
                ৳1000
              </button>
            </div>
          </div>

          {/* Change Display Box */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between transition-colors ${
              isCashInsufficient
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
            }`}
          >
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 opacity-70" />
              <span className="font-semibold text-sm">
                {isCashInsufficient ? "Short by:" : "Change to return:"}
              </span>
            </div>
            <span className="text-xl font-black">
              {isCashInsufficient
                ? formatCurrency(netPayable - (Number(tenderedAmount) || 0))
                : formatCurrency(changeAmount)}
            </span>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Internal Notes / Reference (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid in 500 note, customer requested no coin change"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
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
              disabled={isSubmitting || isCashInsufficient}
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {isSubmitting ? (
                <span>Processing...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Settle Bill</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
