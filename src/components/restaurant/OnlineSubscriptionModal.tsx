import React, { useState } from "react";
import {
  X,
  CreditCard,
  Zap,
  AlertTriangle,
  Smartphone,
  ShieldCheck,
  Check,
} from "lucide-react";
import { Button } from "../ui";
import { renewSubscriptionOnline } from "../../services/subscriptionService";
import { formatCurrency } from "../../utils/helpers";

interface OnlineSubscriptionModalProps {
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
    features: "Up to 15 tables, 5 staff, Custom Logo, QR menu, bKash/Nagad/Cards",
  },
  {
    code: "growth",
    name: "Growth",
    monthly: 2999,
    yearly: 28788,
    features: "Up to 50 tables, 15 staff, KDS, Delivery Role, NBR VAT, Shift Management, Activity History",
  },
  {
    code: "enterprise",
    name: "Enterprise",
    monthly: 5999,
    yearly: 57588,
    features: "Unlimited tables & staff, Manager PIN Void, Tamper Audit, CSV Exports, 24/7 Priority",
  },
] as const;

export const OnlineSubscriptionModal: React.FC<OnlineSubscriptionModalProps> = ({
  restaurantId,
  currentPlan = "growth",
  onClose,
  onSuccess,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth" | "enterprise">(
    (currentPlan as "starter" | "growth" | "enterprise") || "growth"
  );
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [paymentMethod, setPaymentMethod] = useState<"bkash" | "nagad" | "sslcommerz">("bkash");

  // Gateway Simulation Fields
  const [mobileNumber, setMobileNumber] = useState<string>("01712345678");
  const [otp, setOtp] = useState<string>("123456");
  const [pin, setPin] = useState<string>("****");
  const [cardNumber, setCardNumber] = useState<string>("4242 •••• •••• 4242");
  const [cardExpiry, setCardExpiry] = useState<string>("12/28");
  const [cardCvv, setCardCvv] = useState<string>("123");

  const [processing, setProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    invoice_number: string;
    amount: number;
    plan_code: string;
  } | null>(null);

  const planInfo = PLANS.find((p) => p.code === selectedPlan) || PLANS[1];
  const payableAmount = billingCycle === "yearly" ? planInfo.yearly : planInfo.monthly;

  const handlePayAndActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProcessing(true);

    try {
      const prefix = paymentMethod === "bkash" ? "BKS" : paymentMethod === "nagad" ? "NGD" : "SSLCZ";
      const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      const gatewayTrxId = `${prefix}-${Date.now().toString().slice(-6)}${randomSuffix}`;

      const res = await renewSubscriptionOnline({
        restaurantId,
        planCode: selectedPlan,
        billingCycle,
        paymentMethod,
        gatewayTrxId,
        amount: payableAmount,
      });

      if (res.success && res.data) {
        setSuccessData({
          invoice_number: res.data.invoice_number,
          amount: res.data.amount,
          plan_code: res.data.plan_code,
        });
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2200);
      } else {
        setError(res.error || "Failed to renew subscription online.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error processing online payment");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-gradient-to-r from-orange-500 to-amber-500 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-white/20 rounded-lg">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Instant Online Subscription Renewal</h3>
              <p className="text-xs text-orange-100">Zero waiting time — instant activation & receipt</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handlePayAndActivate} className="p-6 space-y-5">
          {successData ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center animate-bounce">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <h4 className="font-bold text-slate-900 text-xl">Subscription Activated & Paid!</h4>
              <p className="text-sm text-slate-600">
                Invoice <strong>#{successData.invoice_number}</strong> for{" "}
                <span className="text-emerald-600 font-bold">{formatCurrency(successData.amount)}</span>{" "}
                has been marked as <strong>PAID</strong>.
              </p>
              <div className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded-lg border border-slate-200 inline-block font-mono">
                Your restaurant subscription is now active. Refreshing dashboard...
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{error}</span>
                </div>
              )}

              {/* Step 1: Select Plan */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  1. Select Plan Tier
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PLANS.map((plan) => (
                    <button
                      key={plan.code}
                      type="button"
                      onClick={() => setSelectedPlan(plan.code)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedPlan === plan.code
                          ? "border-orange-500 bg-orange-50/60 ring-2 ring-orange-400/30 shadow-sm"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className="font-bold text-sm text-slate-900">{plan.name}</div>
                      <div className="text-xs text-orange-600 font-bold mt-1">
                        {formatCurrency(billingCycle === "yearly" ? plan.yearly / 12 : plan.monthly)}
                        <span className="text-[10px] text-slate-400 font-normal">/mo</span>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 italic">
                  {planInfo.features}
                </p>
              </div>

              {/* Billing Cycle Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setBillingCycle("monthly")}
                  className={`flex-1 py-1.5 rounded-lg text-center transition-colors ${
                    billingCycle === "monthly"
                      ? "bg-white text-slate-900 font-bold shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Monthly Billing
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle("yearly")}
                  className={`flex-1 py-1.5 rounded-lg text-center transition-colors ${
                    billingCycle === "yearly"
                      ? "bg-white text-slate-900 font-bold shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Yearly Billing (Save 20%) 🎉
                </button>
              </div>

              {/* Step 2: Payment Gateway */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    2. Instant Payment Gateway
                  </label>
                  <span className="text-xs font-bold text-orange-600">
                    Payable: {formatCurrency(payableAmount)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("bkash")}
                    className={`py-2 px-3 rounded-xl border font-bold text-center flex flex-col items-center justify-center gap-1 transition-all ${
                      paymentMethod === "bkash"
                        ? "border-[#E2136E] bg-[#E2136E]/10 text-[#E2136E] ring-2 ring-[#E2136E]/20"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    bKash Direct
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("nagad")}
                    className={`py-2 px-3 rounded-xl border font-bold text-center flex flex-col items-center justify-center gap-1 transition-all ${
                      paymentMethod === "nagad"
                        ? "border-[#F7941D] bg-[#F7941D]/10 text-[#F7941D] ring-2 ring-[#F7941D]/20"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    Nagad Direct
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("sslcommerz")}
                    className={`py-2 px-3 rounded-xl border font-bold text-center flex flex-col items-center justify-center gap-1 transition-all ${
                      paymentMethod === "sslcommerz"
                        ? "border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Card / SSLCommerz
                  </button>
                </div>

                {/* Gateway Simulated Fields */}
                {paymentMethod === "bkash" || paymentMethod === "nagad" ? (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                    <div className="flex items-center justify-between text-slate-700 font-semibold">
                      <span>{paymentMethod === "bkash" ? "bKash Online Checkout" : "Nagad Payment Gateway"}</span>
                      <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Sandbox Ready
                      </span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Wallet Account Number
                      </label>
                      <input
                        type="text"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="017XXXXXXXX"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          OTP Verification
                        </label>
                        <input
                          type="text"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          placeholder="123456"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Wallet PIN
                        </label>
                        <input
                          type="password"
                          value={pin}
                          onChange={(e) => setPin(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                          placeholder="****"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
                    <div className="flex items-center justify-between text-slate-700 font-semibold">
                      <span>SSLCommerz Card Gateway (Visa / Mastercard)</span>
                      <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        PCI-DSS Compliant
                      </span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Card Number</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Expiry</label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs"
                          placeholder="MM/YY"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">CVV / CVC</label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs"
                          placeholder="123"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Security info */}
              <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-amber-50/60 p-2.5 rounded-lg border border-amber-200/60">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Immediate activation: An official paid invoice is issued instantly and credited to SaaS platform revenue.
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={onClose} disabled={processing}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  icon={<Zap className="w-4 h-4 text-white" />}
                  loading={processing}
                  className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold shadow-sm"
                >
                  Pay {formatCurrency(payableAmount)} & Activate
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
