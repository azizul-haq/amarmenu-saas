import React, { useState } from "react";
import { AlertTriangle, Lock, X, ShieldAlert } from "lucide-react";
import type { Order } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";
import { voidOrderWithPIN } from "../../services/auditService";
import type { VoidOrderResult } from "../../services/auditService";
import { voidOrderSchema } from "../../schemas/auditSchema";
import { Button } from "../ui";

interface VoidOrderModalProps {
  order: Order;
  onClose: () => void;
  onVoided: (result: VoidOrderResult) => void;
}

const COMMON_REASONS = [
  "Customer cancelled order",
  "Mistake entry by waiter",
  "Customer sent back food (Quality)",
  "Kitchen out of ingredients",
  "Duplicate punched order",
  "Walkout / Customer left without dining",
];

export const VoidOrderModal: React.FC<VoidOrderModalProps> = ({
  order,
  onClose,
  onVoided,
}) => {
  const [managerPin, setManagerPin] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = voidOrderSchema.safeParse({
      manager_pin: managerPin,
      reason: reason,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid input");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await voidOrderWithPIN(order.id, managerPin, reason);

      if (!res.success || !res.data) {
        setError(res.error || "Failed to void order");
        return;
      }

      onVoided(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error voiding order";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-red-600 text-white">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-white" />
            <div>
              <h3 className="font-bold text-base leading-tight">
                Manager Override: Void Order
              </h3>
              <p className="text-xs text-red-100">
                Order #{order.order_number}{" "}
                {order.table_number ? `• Table ${order.table_number}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-red-700 rounded-lg text-red-100 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Warning Banner */}
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Permanent Manager Action</p>
              <p className="text-red-700">
                Voiding this order ({formatCurrency(order.total)}) is strictly
                logged to an <strong>append-only audit trail</strong>. Any table
                will be released, and payments will be marked refunded.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-100 border border-red-300 rounded-xl text-xs font-semibold text-red-800">
              {error}
            </div>
          )}

          {/* Preset Reasons */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Quick Reason Presets:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`px-2.5 py-1 text-[11px] rounded-lg border transition ${
                    reason === r
                      ? "bg-red-50 border-red-400 text-red-700 font-bold"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Mandatory Reason */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Mandatory Void Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain clearly why this order is being voided..."
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
          </div>

          {/* Manager PIN */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-gray-500" />
              <span>Manager Security PIN (4-6 Digits)</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              maxLength={6}
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-lg tracking-widest text-center font-bold font-mono focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Authorized manager or owner 4–6 digit security PIN.
            </p>
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
              variant="danger"
              fullWidth
              disabled={isSubmitting || !managerPin || reason.trim().length < 3}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              {isSubmitting ? (
                <span>Authorizing...</span>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Authorize & Void</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
