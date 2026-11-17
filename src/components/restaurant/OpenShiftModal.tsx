import React, { useState } from "react";
import { DoorOpen, DollarSign, X, AlertCircle } from "lucide-react";
import { openShiftSchema } from "../../schemas/shiftSchema";
import { openCashShift } from "../../services/shiftService";
import { Button } from "../ui";

interface OpenShiftModalProps {
  onClose: () => void;
  onOpened: () => void;
}

const QUICK_FLOATS = [500, 1000, 2000, 5000];

export const OpenShiftModal: React.FC<OpenShiftModalProps> = ({
  onClose,
  onOpened,
}) => {
  const [openingFloat, setOpeningFloat] = useState<number>(2000);
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = openShiftSchema.safeParse({
      opening_float: Number(openingFloat) || 0,
      notes: notes || undefined,
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid opening float");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await openCashShift(Number(openingFloat) || 0, notes);

      if (!res.success) {
        setError(res.error || "Failed to open cash shift");
        return;
      }

      onOpened();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error opening shift";
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
            <DoorOpen className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-base leading-tight">
                Open Cash Drawer Shift
              </h3>
              <p className="text-xs text-gray-400">
                Set opening cash float to begin shift operations
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
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Opening Float Input */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Opening Cash Float (৳) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                ৳
              </span>
              <input
                type="number"
                min="0"
                step="50"
                value={openingFloat || ""}
                onChange={(e) => setOpeningFloat(Number(e.target.value) || 0)}
                required
                className="w-full pl-8 pr-3 py-2.5 border border-gray-300 rounded-lg text-lg font-bold font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>

            {/* Quick Float Buttons */}
            <div className="flex gap-2 mt-2">
              {QUICK_FLOATS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setOpeningFloat(amt)}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-bold border transition ${
                    openingFloat === amt
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  ৳{amt}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Shift Opening Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Received petty change 100x10, 50x20 from Manager"
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
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {isSubmitting ? (
                <span>Opening Shift...</span>
              ) : (
                <>
                  <DollarSign className="w-4 h-4" />
                  <span>Confirm & Open Shift</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
