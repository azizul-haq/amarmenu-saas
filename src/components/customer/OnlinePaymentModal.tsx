import React, { useState } from "react";
import {
  CreditCard,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  X,
  ArrowRight,
  RefreshCw,
  Wallet,
  Printer,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { formatCurrency, copyToClipboard } from "../../utils/helpers";
import {
  processCustomerSandboxPayment,
  type CustomerSandboxPaymentResponse,
} from "../../services/onlinePaymentService";
import type { OnlineGateway } from "../../schemas/onlinePaymentSchema";

interface OnlinePaymentModalProps {
  orderId: string;
  orderNumber: string;
  payableTotal: number;
  customerPhone?: string;
  restaurantName: string;
  onClose: () => void;
  onPaymentSuccess: (res: CustomerSandboxPaymentResponse) => void;
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
  const [step, setStep] = useState<"input" | "verify" | "success">("input");
  const [completion, setCompletion] = useState<CustomerSandboxPaymentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTrx, setCopiedTrx] = useState(false);

  // Form inputs for gateway simulation
  const [phoneInput, setPhoneInput] = useState(customerPhone || "01712345678");
  const [simulatedPin, setSimulatedPin] = useState("1234");
  const [simulatedOtp, setSimulatedOtp] = useState("543210");
  const [cardNumber, setCardNumber] = useState("4111 2222 3333 4444");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvv, setCardCvv] = useState("888");

  // Step 1 -> Step 2 validation
  const handleProceedToVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (gateway !== "sslcommerz" && (!phoneInput || phoneInput.length < 10)) {
      setError("Please provide a valid 11-digit mobile number");
      return;
    }
    if (gateway === "sslcommerz" && (!cardNumber || cardNumber.length < 15)) {
      setError("Please provide a valid 16-digit card number");
      return;
    }
    setStep("verify");
  };

  // Step 2: Complete atomic sandbox payment via database RPC
  const handleConfirmPayment = async () => {
    setError(null);
    setLoading(true);

    const senderNumber = gateway === "sslcommerz" ? cardNumber.replace(/\s+/g, "") : phoneInput;
    const res = await processCustomerSandboxPayment(orderId, gateway, senderNumber);
    setLoading(false);

    if (res.success && res.data) {
      setCompletion(res.data);
      setStep("success");
      onPaymentSuccess(res.data);
    } else {
      setError(res.error || "Payment processing failed. Please try again.");
    }
  };

  const handleCopyTrx = async () => {
    if (!completion?.transaction_id) return;
    const ok = await copyToClipboard(completion.transaction_id);
    if (ok) {
      setCopiedTrx(true);
      setTimeout(() => setCopiedTrx(false), 2000);
    }
  };

  const getHeaderStyle = () => {
    switch (gateway) {
      case "bkash":
        return "bg-gradient-to-r from-[#D81B60] via-[#E2136E] to-[#C2105D] text-white";
      case "sslcommerz":
        return "bg-gradient-to-r from-[#072B4A] via-[#0B3B60] to-[#12588D] text-white";
      case "nagad":
        return "bg-gradient-to-r from-[#EA580C] via-[#F7941D] to-[#D97706] text-white";
      default:
        return "bg-slate-900 text-white";
    }
  };

  const getBrandTitle = () => {
    switch (gateway) {
      case "bkash":
        return "bKash Online Payment";
      case "nagad":
        return "Nagad Direct Checkout";
      case "sslcommerz":
        return "SSLCOMMERZ Secure Gateway";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 flex flex-col">
        {/* Gateway Header with SANDBOX TEST MODE badge */}
        <div className={`p-4 transition-colors flex items-center justify-between ${getHeaderStyle()}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-xs">
              {gateway === "bkash" && <Smartphone className="w-5 h-5" />}
              {gateway === "nagad" && <Wallet className="w-5 h-5" />}
              {gateway === "sslcommerz" && <CreditCard className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black tracking-tight leading-tight">
                  {step === "success" ? "Payment Successful" : getBrandTitle()}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[9px] font-black tracking-widest uppercase border border-white/30 shrink-0">
                  SANDBOX TEST MODE
                </span>
              </div>
              <p className="text-[11px] opacity-90 mt-0.5">
                {restaurantName} • Order #{orderNumber}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-black/20 text-white transition-colors"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Amount Badge */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                Total Payable Amount
              </span>
              <span className="text-[10px] text-gray-400">Includes VAT & Taxes</span>
            </div>
            <span className="text-xl font-black text-gray-900 tracking-tight">
              {formatCurrency(payableTotal)}
            </span>
          </div>

          {/* STEP 1: SELECT GATEWAY & ENTER DETAILS */}
          {step === "input" && (
            <form onSubmit={handleProceedToVerify} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">
                  Select Online Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {/* bKash */}
                  <button
                    type="button"
                    onClick={() => {
                      setGateway("bkash");
                      setError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "bkash"
                        ? "border-[#E2136E] bg-pink-50 ring-2 ring-[#E2136E]/30"
                        : "border-gray-200 hover:border-gray-300 bg-white"
                    }`}
                  >
                    <Smartphone
                      className={`w-5 h-5 ${gateway === "bkash" ? "text-[#E2136E]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">bKash</span>
                    <span className="text-[10px] font-semibold text-pink-600">MFS Wallet</span>
                  </button>

                  {/* Nagad */}
                  <button
                    type="button"
                    onClick={() => {
                      setGateway("nagad");
                      setError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "nagad"
                        ? "border-[#F7941D] bg-orange-50 ring-2 ring-[#F7941D]/30"
                        : "border-gray-200 hover:border-gray-300 bg-white"
                    }`}
                  >
                    <Wallet
                      className={`w-5 h-5 ${gateway === "nagad" ? "text-[#F7941D]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">Nagad</span>
                    <span className="text-[10px] font-semibold text-orange-600">Postal MFS</span>
                  </button>

                  {/* SSLCOMMERZ */}
                  <button
                    type="button"
                    onClick={() => {
                      setGateway("sslcommerz");
                      setError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                      gateway === "sslcommerz"
                        ? "border-[#0B3B60] bg-blue-50 ring-2 ring-[#0B3B60]/30"
                        : "border-gray-200 hover:border-gray-300 bg-white"
                    }`}
                  >
                    <CreditCard
                      className={`w-5 h-5 ${gateway === "sslcommerz" ? "text-[#0B3B60]" : "text-gray-400"}`}
                    />
                    <span className="text-xs font-bold text-gray-800">Card / Net</span>
                    <span className="text-[10px] font-semibold text-blue-600">SSLCOMMERZ</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Inputs Based on Selected Gateway */}
              {gateway !== "sslcommerz" ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-gray-700">
                      {gateway === "bkash" ? "bKash Account Number" : "Nagad Account Number"}
                    </label>
                    <button
                      type="button"
                      onClick={() => setPhoneInput("01712345678")}
                      className="text-[10px] text-accent hover:underline font-semibold"
                    >
                      Use Demo Number
                    </button>
                  </div>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    maxLength={14}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden font-mono"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    🧪 Sandbox demo environment: Any 11-digit Bangladeshi mobile number will work.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Demo Card Number (Visa / Mastercard)
                    </label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="4111 2222 3333 4444"
                      required
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Expiry Date</label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="MM/YY"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl text-center font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">CVV / CVC</label>
                      <input
                        type="password"
                        maxLength={3}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        placeholder="888"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl text-center font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  className={`w-full py-3 px-4 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 text-white ${
                    gateway === "bkash"
                      ? "bg-[#E2136E] hover:bg-[#C2105D]"
                      : gateway === "sslcommerz"
                      ? "bg-[#0B3B60] hover:bg-[#072B4A]"
                      : "bg-[#F7941D] hover:bg-[#D97706]"
                  }`}
                >
                  <span>Proceed to Verification</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: VERIFICATION (PIN / OTP) */}
          {step === "verify" && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Sandbox 2-Step Verification</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Enter the pre-filled demo PIN or OTP below. No actual funds will be deducted.
                  </p>
                </div>
              </div>

              {gateway !== "sslcommerz" ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Account Number
                    </label>
                    <div className="w-full px-3 py-2 text-sm bg-gray-100 border border-gray-200 rounded-xl text-gray-700 font-mono">
                      {phoneInput}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-bold text-gray-700">6-Digit Demo OTP</label>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                        Pre-Hinted: 543210
                      </span>
                    </div>
                    <input
                      type="text"
                      maxLength={6}
                      value={simulatedOtp}
                      onChange={(e) => setSimulatedOtp(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl font-mono tracking-widest text-center focus:ring-2 focus:ring-accent focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-bold text-gray-700">
                        {gateway === "bkash" ? "bKash PIN (Demo)" : "Nagad PIN (Demo)"}
                      </label>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                        Demo PIN: 1234
                      </span>
                    </div>
                    <input
                      type="password"
                      maxLength={5}
                      value={simulatedPin}
                      onChange={(e) => setSimulatedPin(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl font-mono tracking-widest text-center focus:ring-2 focus:ring-accent focus:outline-hidden"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Card Details
                    </label>
                    <div className="w-full px-3 py-2 text-xs bg-gray-100 border border-gray-200 rounded-xl text-gray-700 font-mono">
                      Card Ending in {cardNumber.slice(-4)} • Exp {cardExpiry}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-bold text-gray-700">3D-Secure Bank OTP</label>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                        Demo OTP: 123456
                      </span>
                    </div>
                    <input
                      type="text"
                      maxLength={6}
                      value={simulatedOtp}
                      onChange={(e) => setSimulatedOtp(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl font-mono tracking-widest text-center focus:ring-2 focus:ring-accent focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("input")}
                  disabled={loading}
                  className="w-1/3 py-2.5 px-3 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-xl font-bold text-xs transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPayment}
                  disabled={loading}
                  className={`w-2/3 py-2.5 px-4 rounded-xl font-black text-xs shadow-md transition-all flex items-center justify-center gap-1.5 text-white disabled:opacity-50 ${
                    gateway === "bkash"
                      ? "bg-[#E2136E] hover:bg-[#C2105D]"
                      : gateway === "sslcommerz"
                      ? "bg-[#0B3B60] hover:bg-[#072B4A]"
                      : "bg-[#F7941D] hover:bg-[#D97706]"
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

          {/* STEP 3: GREEN PAYMENT SUCCESS SCREEN WITH RECEIPT */}
          {step === "success" && completion && (
            <div className="text-center space-y-4 py-2 animate-fadeIn">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
                <div className="relative w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shadow-sm">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  Payment Successful!
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  বিল সফলভাবে পরিশোধ করা হয়েছে। ধন্যবাদ!
                </p>
              </div>

              {/* Transaction Summary Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs space-y-2.5 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Transaction ID (TrxID):</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {completion.transaction_id}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyTrx}
                      className="text-gray-400 hover:text-gray-600 p-0.5"
                      title="Copy TrxID"
                    >
                      {copiedTrx ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Invoice Number:</span>
                  <span className="font-mono font-bold text-gray-900">{completion.invoice_number}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Payment Gateway:</span>
                  <span className="font-black text-gray-900 uppercase">{completion.method}</span>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-200 font-bold">
                  <span className="text-gray-600">Total Paid:</span>
                  <span className="text-sm font-black text-emerald-900">
                    {formatCurrency(completion.amount)}
                  </span>
                </div>

                {completion.table_released && (
                  <div className="p-2 bg-emerald-100/70 text-emerald-800 rounded-xl text-[11px] font-bold text-center flex items-center justify-center gap-1.5 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Table Released & Ready for Next Guest</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full py-2.5 px-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-2xs"
                >
                  <Printer className="w-4 h-4 text-gray-600" />
                  <span>Print Digital Receipt / রসিদ প্রিন্ট করুন</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm shadow-md transition-all"
                >
                  Done / সম্পন্ন
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
