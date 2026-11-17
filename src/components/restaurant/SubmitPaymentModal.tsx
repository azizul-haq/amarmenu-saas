import React, { useState } from "react";
import { X, CreditCard, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "../ui";
import { submitSubscriptionPayment } from "../../services/subscriptionService";
import { formatCurrency } from "../../utils/helpers";

interface SubmitPaymentModalProps {
  restaurantId: string;
  currentPlan?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PLANS = [
  {
    code: "starter",
    name: "Starter",
    monthly: 1499,
    yearly: 14388,
    features: "Up to 15 tables, QR ordering, 1 printer, Email support",
  },
  {
    code: "growth",
    name: "Growth",
    monthly: 2999,
    yearly: 28788,
    features: "Unlimited tables, Waiter POS, KDS display, 2 printers, NBR VAT, bKash",
  },
  {
    code: "enterprise",
    name: "Enterprise",
    monthly: 5999,
    yearly: 57588,
    features: "Multi-branch, Central warehouse, Dedicated account manager, 24/7 support",
  },
] as const;

export const SubmitPaymentModal: React.FC<SubmitPaymentModalProps> = ({
  restaurantId,
  currentPlan = "growth",
  onClose,
  onSuccess,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth" | "enterprise">(
    (currentPlan as "starter" | "growth" | "enterprise") || "growth"
  );
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [paymentMethod, setPaymentMethod] = useState<"bkash" | "nagad" | "bank_transfer">("bkash");
  const [transactionId, setTransactionId] = useState<string>("");
  const [senderNumber, setSenderNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const planInfo = PLANS.find((p) => p.code === selectedPlan) || PLANS[1];
  const payableAmount = billingCycle === "yearly" ? planInfo.yearly : planInfo.monthly;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!transactionId.trim()) {
      setError("Transaction ID (TrxID) is required.");
      return;
    }

    if (senderNumber && !/^(\+8801|01)[3-9]\d{8}$/.test(senderNumber.trim())) {
      setError("Please enter a valid 11-digit Bangladeshi mobile number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitSubscriptionPayment({
        restaurantId,
        planCode: selectedPlan,
        billingCycle,
        paymentMethod,
        transactionId: transactionId.trim(),
        senderNumber: senderNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.success && res.data) {
        setSuccessMessage(
          `Payment submitted! Invoice #${res.data.invoice_number} is pending Super Admin verification.`
        );
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      } else {
        setError(res.error || "Failed to submit payment. Please verify your details.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error submitting payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg border border-border my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-bg-subtle">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg text-text">SaaS Subscription Payment</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-secondary hover:text-text hover:bg-bg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {successMessage ? (
            <div className="p-6 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-success mx-auto animate-bounce" />
              <h4 className="font-bold text-text text-lg">Payment Received!</h4>
              <p className="text-sm text-text-secondary">{successMessage}</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Step 1: Select Plan */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
                  1. Choose Subscription Plan
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PLANS.map((plan) => (
                    <button
                      key={plan.code}
                      type="button"
                      onClick={() => setSelectedPlan(plan.code)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        selectedPlan === plan.code
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                          : "border-border hover:border-text-secondary/40"
                      }`}
                    >
                      <div className="font-bold text-sm text-text">{plan.name}</div>
                      <div className="text-xs text-primary font-semibold mt-1">
                        {formatCurrency(billingCycle === "yearly" ? plan.yearly / 12 : plan.monthly)}
                        <span className="text-[10px] text-text-secondary font-normal">/mo</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Billing Cycle Toggle */}
              <div className="flex bg-bg-subtle p-1 rounded-lg border border-border text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setBillingCycle("monthly")}
                  className={`flex-1 py-1.5 rounded-md text-center transition-colors ${
                    billingCycle === "monthly"
                      ? "bg-white text-text font-bold shadow-sm"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  Monthly Billing
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle("yearly")}
                  className={`flex-1 py-1.5 rounded-md text-center transition-colors ${
                    billingCycle === "yearly"
                      ? "bg-white text-text font-bold shadow-sm"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  Yearly (Save 20%) 🎉
                </button>
              </div>

              {/* Official Payment Instruction Banner */}
              <div className="p-3.5 bg-accent/5 border border-accent/20 rounded-lg text-xs space-y-1.5">
                <div className="font-bold text-accent flex items-center justify-between">
                  <span>Send Money via Mobile Banking:</span>
                  <span className="text-sm font-extrabold text-primary">
                    Payable: {formatCurrency(payableAmount)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-text font-mono pt-1">
                  <div className="p-2 bg-white rounded border border-border">
                    <span className="font-bold text-[#E2136E]">bKash (Merchant):</span>
                    <div className="text-sm font-bold mt-0.5">01700-000000</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-border">
                    <span className="font-bold text-[#F7941D]">Nagad (Merchant):</span>
                    <div className="text-sm font-bold mt-0.5">01800-000000</div>
                  </div>
                </div>
                <p className="text-[11px] text-text-secondary">
                  Send exact amount, copy the <strong>Transaction ID (TrxID)</strong>, and enter below.
                </p>
              </div>

              {/* Step 2: Payment Details */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-text-secondary uppercase">
                  2. Enter Payment Verification Details
                </label>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("bkash")}
                    className={`py-2 px-3 rounded-lg border font-semibold text-center ${
                      paymentMethod === "bkash"
                        ? "border-[#E2136E] bg-[#E2136E]/10 text-[#E2136E]"
                        : "border-border text-text-secondary"
                    }`}
                  >
                    bKash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("nagad")}
                    className={`py-2 px-3 rounded-lg border font-semibold text-center ${
                      paymentMethod === "nagad"
                        ? "border-[#F7941D] bg-[#F7941D]/10 text-[#F7941D]"
                        : "border-border text-text-secondary"
                    }`}
                  >
                    Nagad
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("bank_transfer")}
                    className={`py-2 px-3 rounded-lg border font-semibold text-center ${
                      paymentMethod === "bank_transfer"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-text-secondary"
                    }`}
                  >
                    Bank / Other
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text mb-1">
                    Transaction ID (TrxID) <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                    placeholder="e.g. 9JK82HF4A2"
                    className="input font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text mb-1">
                    Sender Mobile Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    placeholder="e.g. 01712345678"
                    className="input font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text mb-1">
                    Notes / Reference (Optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Paid from Rahim's personal account"
                    className="input"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-3 border-t border-border">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  icon={<Send className="w-4 h-4" />}
                  disabled={submitting || !transactionId}
                >
                  {submitting ? "Submitting..." : "Submit Payment for Verification"}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
