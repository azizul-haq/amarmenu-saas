import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  CheckCircle,
  Clock,
  UtensilsCrossed,
  Bell,
  XCircle,
  ArrowLeft,
  Phone,
  MapPin,
  FileText,
  Copy,
  Check,
  RefreshCw,
  CreditCard,
  Printer,
  Sparkles,
} from "lucide-react";
import { getCustomerOrder } from "../../services/restaurantService";
import type { Order, OrderItem } from "../../config/supabase";
import { formatCurrency, formatDateTime, copyToClipboard } from "../../utils/helpers";
import { Card, Button, Loading } from "../../components/ui";
import { OnlinePaymentModal } from "../../components/customer/OnlinePaymentModal";

const OrderStatusPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();

  const [order, setOrder] = useState<(Order & { items: OrderItem[] }) | null>(null);
  const [restaurant, setRestaurant] = useState<{
    name: string;
    name_bn?: string;
    slug: string;
    phone?: string;
    address?: string;
    logo_url?: string;
    vat_bin_no?: string;
    currency: string;
    currency_symbol: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "bn">("en");
  const [copied, setCopied] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // In production builds, the simulator UI is hidden; live gateway redirect will take its place in future chunks
  const isSimulatorEnabled = !import.meta.env.PROD || import.meta.env.VITE_ENABLE_PAYMENT_SIMULATOR === "true";

  const fetchStatus = async () => {
    if (!orderId) return;

    const res = await getCustomerOrder(orderId);
    if (res.found && res.order && res.restaurant) {
      setOrder(res.order);
      setRestaurant(res.restaurant);
      setError(null);
    } else {
      setError(res.error || "Order not found");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();

    // Polling interval (every 4s) until completed or cancelled
    const interval = setInterval(() => {
      if (order?.status !== "completed" && order?.status !== "cancelled" && order?.status !== "rejected") {
        fetchStatus();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [orderId, order?.status]);

  const handleCopyOrderNumber = async () => {
    if (!order?.order_number) return;
    const success = await copyToClipboard(order.order_number);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <Loading text={lang === "bn" ? "অর্ডার স্ট্যাটাস লোড হচ্ছে..." : "Loading order status..."} />;
  }

  if (error || !order || !restaurant) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="text-center p-8 max-w-md w-full">
          <XCircle className="w-16 h-16 text-error mx-auto mb-4" />
          <h2 className="text-xl font-bold text-text mb-2">
            {lang === "bn" ? "অর্ডার খুঁজে পাওয়া যায়নি" : "Order Not Found"}
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            {error || (lang === "bn" ? "আপনার অনুরোধকৃত অর্ডারটি বিদ্যমান নেই।" : "The requested order does not exist.")}
          </p>
          <Link to="/">
            <Button fullWidth>{lang === "bn" ? "হোমে ফিরে যান" : "Go to Homepage"}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const steps = [
    {
      key: "pending",
      title: lang === "bn" ? "অর্ডার গৃহীত" : "Order Placed",
      desc: lang === "bn" ? "রেস্তোরাঁয় অর্ডার পাঠানো হয়েছে" : "Sent to restaurant",
      icon: Clock,
    },
    {
      key: "preparing",
      title: lang === "bn" ? "রান্না হচ্ছে" : "Preparing",
      desc: lang === "bn" ? "রান্নাঘরে খাবার প্রস্তুত হচ্ছে" : "Kitchen is cooking",
      icon: UtensilsCrossed,
    },
    {
      key: "ready",
      title: lang === "bn" ? "পরিবেশনের জন্য প্রস্তুত" : "Ready to Serve",
      desc: lang === "bn" ? "টেবিলে পৌঁছাবে অথবা সংগ্রহ করুন" : "Ready for table / pickup",
      icon: Bell,
    },
    {
      key: "completed",
      title: lang === "bn" ? "সম্পন্ন" : "Completed",
      desc: lang === "bn" ? "ধন্যবাদ, আবার আসবেন!" : "Thank you for dining!",
      icon: CheckCircle,
    },
  ];

  const getStepIndex = (status: string) => {
    switch (status) {
      case "pending":
        return 0;
      case "accepted":
      case "preparing":
        return 1;
      case "ready":
        return 2;
      case "completed":
        return 3;
      default:
        return 0;
    }
  };

  const currentStep = getStepIndex(order.status);
  const isCancelled = order.status === "cancelled" || order.status === "rejected";

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            to={`/menu/${restaurant.slug}`}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{lang === "bn" ? "মেনু দেখুন" : "View Menu"}</span>
          </Link>

          {/* Bilingual Switcher */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs font-bold">
            <button
              onClick={() => setLang("en")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                lang === "en" ? "bg-white text-accent shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang("bn")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                lang === "bn" ? "bg-white text-accent shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              বাং
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Restaurant Header */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 text-center">
          {restaurant.logo_url && (
            <img
              src={restaurant.logo_url}
              alt={restaurant.name}
              className="w-16 h-16 rounded-xl object-cover mx-auto mb-3 border border-gray-100 shadow-sm"
            />
          )}
          <h1 className="text-2xl font-black text-gray-900">
            {lang === "bn" && restaurant.name_bn ? restaurant.name_bn : restaurant.name}
          </h1>
          {restaurant.address && (
            <p className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-gray-400" />
              <span>{restaurant.address}</span>
            </p>
          )}

          {/* Order Number & Table Badge */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-lg">
              <span className="text-xs text-gray-500 font-medium">
                {lang === "bn" ? "অর্ডার নং:" : "Order:"}
              </span>
              <span className="font-mono font-bold text-sm text-gray-900">
                {order.order_number}
              </span>
              <button
                onClick={handleCopyOrderNumber}
                className="text-gray-400 hover:text-accent transition-colors"
                title="Copy order number"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {order.table_number && (
              <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent/10 text-accent font-bold text-xs rounded-lg border border-accent/20">
                <span>📍 {lang === "bn" ? `টেবিল ${order.table_number}` : `Table ${order.table_number}`}</span>
              </div>
            )}

            {order.order_type === "counter" && (
              <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary font-bold text-xs rounded-lg">
                <span>🛍️ {lang === "bn" ? "পার্সেল / টেকঅ্যাওয়ে" : "Takeaway / Parcel"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Stepper Status */}
        {isCancelled ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <XCircle className="w-12 h-12 text-error mx-auto mb-2" />
            <h3 className="text-lg font-bold text-red-900">
              {lang === "bn" ? "অর্ডার বাতিল হয়েছে" : "Order Cancelled"}
            </h3>
            <p className="text-xs text-red-600 mt-1">
              {lang === "bn"
                ? "রেস্তোরাঁ থেকে এই অর্ডারটি বাতিল করা হয়েছে। সহায়তার জন্য রেস্তোরাঁয় যোগাযোগ করুন।"
                : "This order was cancelled by the restaurant. Please contact staff for assistance."}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold text-gray-900">
                {lang === "bn" ? "লাইভ অর্ডার ট্র্যাকিং" : "Live Order Status"}
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{lang === "bn" ? "লাইভ আপডেট" : "Live Updates"}</span>
              </div>
            </div>

            {/* Stepper Grid */}
            <div className="relative">
              {/* Progress Line */}
              <div className="absolute top-5 left-6 right-6 h-1 bg-gray-200 -z-0">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-2 relative z-10">
                {steps.map((step, idx) => {
                  const isDone = idx < currentStep;
                  const isCurrent = idx === currentStep;

                  return (
                    <div key={step.key} className="flex flex-col items-center text-center">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          isDone
                            ? "bg-accent text-white"
                            : isCurrent
                            ? "bg-accent text-white ring-4 ring-accent/20 animate-pulse"
                            : "bg-gray-100 text-gray-400 border-2 border-gray-200"
                        }`}
                      >
                        <step.icon className="w-5 h-5" />
                      </div>
                      <p
                        className={`text-xs font-bold mt-2 leading-tight ${
                          isCurrent ? "text-accent" : isDone ? "text-gray-900" : "text-gray-400"
                        }`}
                      >
                        {step.title}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">
                        {step.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preparation Indicator Banner */}
            {order.status === "preparing" && (
              <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-center text-xs text-amber-800">
                🍳{" "}
                <span className="font-bold">
                  {lang === "bn" ? "শেফ আপনার খাবার রান্না করছেন!" : "Chef is cooking your fresh dishes!"}
                </span>{" "}
                {lang === "bn"
                  ? "কিছুক্ষণের মধ্যেই আপনার টেবিলে পৌঁছে দেওয়া হবে।"
                  : "It will be served hot shortly."}
              </div>
            )}

            {order.status === "ready" && (
              <div className="mt-8 bg-green-50 border border-green-200 rounded-xl p-3.5 text-center text-xs text-green-800">
                🔔{" "}
                <span className="font-bold">
                  {lang === "bn" ? "খাবার সম্পূর্ণ প্রস্তুত!" : "Your order is ready!"}
                </span>{" "}
                {order.order_type === "counter"
                  ? lang === "bn"
                    ? "অনুগ্রহ করে কাউন্টার থেকে পার্সেল সংগ্রহ করুন।"
                    : "Please collect your parcel from the counter."
                  : lang === "bn"
                  ? "ওয়েটার খাবার টেবিলে নিয়ে আসছেন।"
                  : "Waiter is bringing it to your table."}
              </div>
            )}
          </div>
        )}

        {/* Itemized Receipt */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <FileText className="w-4 h-4 text-accent" />
            <h3 className="font-bold text-gray-900 text-sm">
              {lang === "bn" ? "অর্ডারের বিবরণ" : "Order Summary"}
            </h3>
          </div>

          <div className="divide-y divide-gray-100">
            {order.items?.map((item, idx) => (
              <div key={idx} className="py-3 flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">{item.quantity}x</span>
                    <span className="font-semibold text-gray-800">{item.name}</span>
                  </div>

                  {/* Size variant */}
                  {item.selected_size && (
                    <p className="text-xs text-gray-500 pl-6">
                      {lang === "bn" ? "সাইজ: " : "Size: "}
                      <span className="font-medium text-gray-700">{item.selected_size.name}</span>
                    </p>
                  )}

                  {/* Add-ons */}
                  {item.selected_addons && item.selected_addons.length > 0 && (
                    <p className="text-xs text-gray-500 pl-6">
                      + {item.selected_addons.map((a) => a.name).join(", ")}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0 font-medium text-gray-900">
                  {formatCurrency(item.item_total)}
                </div>
              </div>
            ))}
          </div>

          {/* Pricing Breakdown */}
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>{lang === "bn" ? "সাবটোটাল" : "Subtotal"}</span>
              <span className="font-semibold text-gray-900">{formatCurrency(order.subtotal)}</span>
            </div>

            <div className="flex justify-between text-gray-600">
              <div className="flex items-center gap-1">
                <span>{lang === "bn" ? "ভ্যাট (NBR VAT)" : "VAT (5%)"}</span>
                {restaurant.vat_bin_no && (
                  <span className="text-[10px] text-gray-400">BIN: {restaurant.vat_bin_no}</span>
                )}
              </div>
              <span className="font-semibold text-gray-900">{formatCurrency(order.tax)}</span>
            </div>

            <div className="flex justify-between text-base font-black text-gray-900 pt-2 border-t border-gray-100">
              <span>{lang === "bn" ? "সর্বমোট" : "Grand Total"}</span>
              <span className="text-accent">{formatCurrency(order.total)}</span>
            </div>
          </div>
        </div>

        {/* Online Payment / Invoice Status Section */}
        {order.payment_status === "paid" ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-900">
                  {lang === "bn" ? "বিল পরিশোধিত ও সম্পন্ন" : "Bill Paid & Settled"}
                </span>
              </div>
              <span className="px-2.5 py-0.5 bg-emerald-600 text-white text-[11px] font-bold rounded-full uppercase">
                {order.payment_method || "Paid"}
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-3 text-xs space-y-1.5 border border-emerald-100">
              {order.invoice_number && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 font-medium">{lang === "bn" ? "ইনভয়েস নং:" : "Invoice Number:"}</span>
                  <span className="font-mono font-bold text-emerald-800">{order.invoice_number}</span>
                </div>
              )}
              {order.payment_transaction_id && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 font-medium">{lang === "bn" ? "ট্রানজেকশন আইডি:" : "TrxID:"}</span>
                  <span className="font-mono font-medium text-gray-700">{order.payment_transaction_id}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">{lang === "bn" ? "পরিশোধিত অর্থ:" : "Amount Paid:"}</span>
                <span className="font-black text-emerald-900">{formatCurrency(order.total)}</span>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              className="w-full py-2 px-3 bg-white border border-emerald-300 hover:bg-emerald-100/50 text-emerald-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>{lang === "bn" ? "রসিদ প্রিন্ট করুন" : "Print Receipt"}</span>
            </button>
          </div>
        ) : !isCancelled ? (
          isSimulatorEnabled ? (
            <div className="bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-pink-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-accent animate-pulse" />
                  <h3 className="text-sm font-bold text-gray-900">
                    {lang === "bn" ? "অনলাইনে সরাসরি পেমেন্ট করুন" : "Pay Bill Online"}
                  </h3>
                </div>
                <span className="text-xs font-black text-accent">{formatCurrency(order.total)}</span>
              </div>

              <p className="text-xs text-gray-600">
                {lang === "bn"
                  ? "বিকাশ, নগদ বা ডেবিট/ক্রেডিট কার্ড দিয়ে সহজেই আপনার বিল সরাসরি পরিশোধ করুন।"
                  : "Fast & secure digital payment via bKash, Nagad, or Cards (SSLCOMMERZ)."}
              </p>

              <button
                onClick={() => setShowPaymentModal(true)}
                className="w-full py-3 px-4 bg-[#E2136E] hover:bg-[#C2105D] text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                <span>
                  {lang === "bn"
                    ? `বিকাশ / কার্ড দিয়ে পে করুন (${formatCurrency(order.total)})`
                    : `Pay Online with bKash / Card (${formatCurrency(order.total)})`}
                </span>
              </button>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm space-y-2 text-center">
              <div className="inline-flex p-2.5 rounded-full bg-accent/10 text-accent mb-1">
                <CreditCard className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">
                {lang === "bn" ? "কাউন্টারে বিল পরিশোধ করুন" : "Pay at Counter"}
              </h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                {lang === "bn"
                  ? "অনুগ্রহ করে খাবার পরিবেশন শেষে কাউন্টারে ক্যাশ বা কার্ডে বিল পরিশোধ করুন।"
                  : "Please settle your bill with cash or card directly at the restaurant counter after dining."}
              </p>
            </div>
          )
        ) : null}

        {/* Online Payment Modal */}
        {showPaymentModal && restaurant && isSimulatorEnabled && (
          <OnlinePaymentModal
            orderId={order.id}
            orderNumber={order.order_number}
            payableTotal={order.total}
            customerPhone={order.customer_phone}
            restaurantName={restaurant.name}
            onClose={() => setShowPaymentModal(false)}
            onPaymentSuccess={() => {
              fetchStatus();
            }}
          />
        )}

        {/* Customer & Timestamp Info */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-xs text-gray-500 space-y-1.5">
          <p>
            <span className="font-semibold text-gray-700">{lang === "bn" ? "গ্রাহকের নাম: " : "Customer: "}</span>
            {order.customer_name} ({order.customer_phone})
          </p>
          <p>
            <span className="font-semibold text-gray-700">{lang === "bn" ? "অর্ডারের সময়: " : "Placed At: "}</span>
            {formatDateTime(order.created_at)}
          </p>
          {restaurant.phone && (
            <p className="flex items-center gap-1 pt-1 text-gray-700">
              <Phone className="w-3.5 h-3.5 text-accent" />
              <span>{lang === "bn" ? "রেস্তোরাঁ হেল্পলাইন: " : "Restaurant Phone: "}</span>
              <a href={`tel:${restaurant.phone}`} className="font-bold text-accent hover:underline">
                {restaurant.phone}
              </a>
            </p>
          )}
        </div>

        {/* Action Button: Order More Items */}
        <Link to={`/menu/${restaurant.slug}`}>
          <Button fullWidth variant="outline" className="flex items-center justify-center gap-2">
            <UtensilsCrossed className="w-4 h-4" />
            <span>{lang === "bn" ? "আরও খাবার অর্ডার করুন" : "Order More Items"}</span>
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default OrderStatusPage;
