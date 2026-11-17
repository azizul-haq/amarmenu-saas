import React, { useState } from "react";
import {
  CreditCard,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Lock,
  X,
  ArrowRight,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "../../utils/helpers";
import {
  initiateOnlinePayment,
  completeOnlinePayment,
  failOnlinePayment,
  generateMockTrxId,
} from "../../services/onlinePaymentService";
import type {
  OnlineGateway,
  PaymentInitiationResult,
  PaymentCompletionResult,
} from "../../schemas/onlinePaymentSchema";

interface OnlinePaymentModalProps {
  orderId: string;
  orderNumber: string;
  payableTotal: number;
  customerPhone?: string;
  restaurantName: string;
  onClose: () => void;
  onPaymentSuccess: (res: PaymentCompletionResult) => void;
}

export const OnlinePaymentModal: React.FC<OnlinePaymentModalProps> = ({
  orderId,
  orderNumber,
  payableTotal,
  customerPhone = "",
  restaurantName,
  onClose,
  onPaymentSuccess,
}) => {
  const [gateway, setGateway] = useState<OnlineGateway>("bkash");
  const [step, setStep] = useState<"select" | "checkout" | "success">("select");
  const [session, setSession] = useState<PaymentInitiationResult | null>(null);
  const [completion, setCompletion] = useState<PaymentCompletionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form inputs for gateway simulation
  const [phoneInput, setPhoneInput] = useState(customerPhone);
  const [simulatedPin, setSimulatedPin] = useState("1234");
  const [simulatedOtp, setSimulatedOtp] = useState("543210");
  const [cardNumber, setCardNumber] = useState("4111 2222 3333 4444");

  // Step 1: Initiate payment session
  const handleInitiate = async () => {
    setError(null);
    setLoading(true);

    const res = await initiateOnlinePayment(orderId, gateway, phoneInput);
    setLoading(false);

    if (res.success && res.data) {
      setSession(res.data);
      setStep("checkout");
    } else {
      setError(res.error || "Failed to initialize payment gateway");
    }
  };

  // Step 2: Complete payment simulation
  const handleConfirmPayment = async () => {
    if (!session) return;
    setError(null);
    setLoading(true);

    const trxId = generateMockTrxId(gateway);
    const valId = gateway === "sslcommerz" ? `VAL_${Date.now()}` : undefined;
    const payload = {
      payer_mobile: phoneInput,
      simulated_at: new Date().toISOString(),
      card_mask: gateway === "sslcommerz" ? cardNumber.slice(-4) : undefined,
    };

    const res = await completeOnlinePayment(session.tran_id, trxId, valId, payload);
    setLoading(false);

    if (res.success && res.data) {
      setCompletion(res.data);
      setStep("success");
      onPaymentSuccess(res.data);
    } else {
      setError(res.error || "Payment processing failed");
    }
  };

  // User cancels checkout
  const handleCancelPayment = async () => {
    if (session) {
      await failOnlinePayment(session.tran_id, "User cancelled gateway checkout");
    }
    onClose();
  };

  const getGatewayColor = () => {
    switch (gateway) {
      case "bkash":
        return "bg-[#E2136E] text-white";
      case "sslcommerz":
        return "bg-[#0B3B60] text-white";
      case "nagad":
        return "bg-[#F7941D] text-white";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 flex flex-col">
        {/* Header */}
        <div className={`p-4 transition-colors flex items-center justify-between ${getGatewayColor()}`}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            <div>
              <h2 className="text-base font-bold leading-tight">
                {step === "success"
                  ? "Payment Confirmed"
                  : gateway === "bkash"
                  ? "bKash Online Checkout"
                  : gateway === "sslcommerz"
                  ? "SSLCOMMERZ Gateway"
                  : "Nagad Online Checkout"}
              </h2>
              <p className="text-[11px] opacity-90">
                {restaurantName} • Order #{orderNumber}
              </p>
            </div>
          </div>
          <button
            onClick={step === "checkout" ? handleCancelPayment : onClose}
            className="p-1 rounded-full hover:bg-black/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Amount Badge */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Payable Total:</span>
            <span className="text-xl font-black text-gray-900">{formatCurrency(payableTotal)}</span>
          </div>

          {/* STEP 1: GATEWAY SELECTION */}
          {step === "select" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">Select Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {/* bKash */}
                  <button
                    type="button"
                    onClick={() => setGateway("bkash")}
                    className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "bkash"
                        ? "border-[#E2136E] bg-pink-50/50 ring-2 ring-[#E2136E]/20"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Smartphone
                      className={`w-5 h-5 ${gateway === "bkash" ? "text-[#E2136E]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">bKash</span>
                    <span className="text-[10px] text-gray-500">MFS</span>
                  </button>

                  {/* SSLCOMMERZ */}
                  <button
                    type="button"
                    onClick={() => setGateway("sslcommerz")}
                    className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "sslcommerz"
                        ? "border-[#0B3B60] bg-blue-50/50 ring-2 ring-[#0B3B60]/20"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <CreditCard
                      className={`w-5 h-5 ${gateway === "sslcommerz" ? "text-[#0B3B60]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">Card / Bank</span>
                    <span className="text-[10px] text-gray-500">SSLCOMMERZ</span>
                  </button>

                  {/* Nagad */}
                  <button
                    type="button"
                    onClick={() => setGateway("nagad")}
                    className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "nagad"
                        ? "border-[#F7941D] bg-amber-50/50 ring-2 ring-[#F7941D]/20"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Wallet
                      className={`w-5 h-5 ${gateway === "nagad" ? "text-[#F7941D]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">Nagad</span>
                    <span className="text-[10px] text-gray-500">MFS</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Customer Mobile Number (01XXXXXXXXX)
                </label>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="01712345678"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleInitiate}
                  disabled={loading}
                  className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Connecting Gateway...</span>
                    </>
                  ) : (
                    <>
                      <span>Proceed to Payment</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: SIMULATED CHECKOUT FLOW */}
          {step === "checkout" && session && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-bold">Sandbox / Test Gateway Environment</p>
                  <p className="text-[11px] mt-0.5">
                    Session: <span className="font-mono">{session.tran_id}</span>
                  </p>
                </div>
              </div>

              {gateway === "bkash" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Your bKash Account Number
                    </label>
                    <input
                      type="text"
                      disabled
                      value={phoneInput || "017XXXXXXXX"}
                      className="w-full px-3 py-2 text-sm bg-gray-100 border border-gray-200 rounded-lg text-gray-700 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      6-Digit OTP (Simulated)
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={simulatedOtp}
                      onChange={(e) => setSimulatedOtp(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono tracking-widest text-center"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      4-Digit bKash PIN (Simulated)
                    </label>
                    <input
                      type="password"
                      maxLength={5}
                      value={simulatedPin}
                      onChange={(e) => setSimulatedPin(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono tracking-widest text-center"
                    />
                  </div>
                </div>
              )}

              {gateway === "sslcommerz" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Card Number (Visa / Mastercard)
                    </label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Expiry</label>
                      <input
                        type="text"
                        defaultValue="12/28"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">CVV</label>
                      <input
                        type="password"
                        defaultValue="888"
                        maxLength={3}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono text-center"
                      />
                    </div>
                  </div>
                </div>
              )}

              {gateway === "nagad" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Nagad Account Number
                    </label>
                    <input
                      type="text"
                      disabled
                      value={phoneInput || "018XXXXXXXX"}
                      className="w-full px-3 py-2 text-sm bg-gray-100 border border-gray-200 rounded-lg text-gray-700 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      4-Digit Nagad PIN (Simulated)
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={simulatedPin}
                      onChange={(e) => setSimulatedPin(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono tracking-widest text-center"
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelPayment}
                  disabled={loading}
                  className="w-1/3 py-2.5 px-3 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-xl font-medium text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPayment}
                  disabled={loading}
                  className={`w-2/3 py-2.5 px-4 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 text-white disabled:opacity-50 ${
                    gateway === "bkash"
                      ? "bg-[#E2136E] hover:bg-[#C2105D]"
                      : gateway === "sslcommerz"
                      ? "bg-[#0B3B60] hover:bg-[#082942]"
                      : "bg-[#F7941D] hover:bg-[#D67C12]"
                  }`}
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Settling Bill...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Confirm & Pay {formatCurrency(payableTotal)}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PAYMENT SUCCESS */}
          {step === "success" && completion && (
            <div className="text-center space-y-4 py-2">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-lg font-black text-gray-900">Payment Successful!</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Your order bill has been auto-settled and verified.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs space-y-2 text-left">
                <div className="flex justify-between">
                  <span className="text-gray-500">Invoice Number:</span>
                  <span className="font-mono font-bold text-accent">{completion.invoice_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Transaction ID:</span>
                  <span className="font-mono font-bold text-gray-800">{completion.gateway_trx_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Method:</span>
                  <span className="font-bold text-gray-800 uppercase">{completion.gateway}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount Paid:</span>
                  <span className="font-black text-gray-900">{formatCurrency(completion.amount)}</span>
                </div>
                {completion.table_reset && (
                  <p className="text-[11px] text-green-700 bg-green-50 p-1.5 rounded mt-2 text-center">
                    ✓ Table status updated & released
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-bold text-sm shadow-md transition-all"
              >
                Close & View Order Receipt
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
