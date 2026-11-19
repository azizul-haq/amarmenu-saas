import React, { useState, useEffect, useCallback } from "react";
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Card, Button, Loading } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getTenantSubscriptionDetails } from "../../services/subscriptionService";
import type {
  TenantSubscriptionRecord,
  SubscriptionInvoice,
} from "../../schemas/subscriptionSchema";
import { formatCurrency } from "../../utils/helpers";
import { SubmitPaymentModal } from "../../components/restaurant/SubmitPaymentModal";

export const SubscriptionPage: React.FC = () => {
  const { restaurant, restaurantId: authRestaurantId } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [subscription, setSubscription] = useState<TenantSubscriptionRecord | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);

  const loadData = useCallback(async (rId: string) => {
    setLoading(true);
    setError(null);
    const res = await getTenantSubscriptionDetails(rId);
    if (res.success) {
      setSubscription(res.subscription || null);
      setInvoices(res.invoices);
    } else {
      setError(res.error || "Failed to load subscription details");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let rId = authRestaurantId || restaurant?.id || "";

    if (!rId) {
      const currentRestaurant = localStorage.getItem("current_restaurant");
      if (currentRestaurant) {
        try {
          const parsed = JSON.parse(currentRestaurant);
          rId = parsed.id || "";
        } catch {
          // fallback
        }
      }
    }

    if (!rId) {
      try {
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        rId = user.restaurant_id || "";
      } catch {
        // fallback
      }
    }

    if (rId) {
      setRestaurantId(rId);
      loadData(rId);
    } else {
      setLoading(false);
      setError("Restaurant session not found.");
    }
  }, [authRestaurantId, restaurant?.id, loadData]);

  if (loading && !subscription) {
    return <Loading text="Loading subscription details..." />;
  }

  // Calculate days remaining
  const now = new Date();
  const targetDate = subscription?.trial_ends_at
    ? new Date(subscription.trial_ends_at)
    : subscription?.current_period_end
    ? new Date(subscription.current_period_end)
    : null;

  const daysRemaining = targetDate
    ? Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/15 text-success">
            <CheckCircle2 className="w-4 h-4" /> Active Subscription
          </span>
        );
      case "trial":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-primary/15 text-primary">
            <Sparkles className="w-4 h-4" /> Free Trial ({daysRemaining} days left)
          </span>
        );
      case "grace_period":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-warning/15 text-warning animate-pulse">
            <AlertTriangle className="w-4 h-4" /> Grace Period Active
          </span>
        );
      case "suspended":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-error/15 text-error">
            <XCircle className="w-4 h-4" /> Service Suspended
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-bg-subtle text-text-secondary">
            {status || "Unknown"}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-primary" />
            SaaS Subscription & Billing
          </h2>
          <p className="text-text-secondary text-sm">
            Manage your AmarMenu subscription plan, billing cycles, and payment history
          </p>
        </div>

        <Button
          variant="primary"
          icon={<CreditCard className="w-4 h-4" />}
          onClick={() => setShowPaymentModal(true)}
        >
          Renew / Change Plan
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Grace Period / Expiry Warning Banner */}
      {subscription?.status === "grace_period" && (
        <div className="p-4 bg-warning/10 border-2 border-warning/40 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-bold text-text">Subscription Payment Overdue (Grace Period)</h4>
            <p className="text-text-secondary mt-0.5">
              Your subscription period has ended. You are currently in the 7-day grace period. Please
              submit your renewal payment immediately to prevent automated dashboard suspension.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowPaymentModal(true)}
            className="shrink-0 ml-auto"
          >
            Pay Now
          </Button>
        </div>
      )}

      {/* Plan Status Card */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <span className="text-xs uppercase font-semibold text-text-secondary">Current Plan</span>
              <h3 className="text-2xl font-extrabold text-text capitalize mt-0.5">
                {subscription?.plan_code || "Growth"} Tier
              </h3>
            </div>
            <div>{getStatusBadge(subscription?.status)}</div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-bg-subtle rounded-lg border border-border">
              <span className="text-xs text-text-secondary uppercase">Billing Cycle</span>
              <div className="font-bold text-text capitalize mt-1">
                {subscription?.billing_cycle || "Monthly"}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border">
              <span className="text-xs text-text-secondary uppercase">Plan Price</span>
              <div className="font-bold text-primary mt-1">
                {formatCurrency(subscription?.amount || 2999)}
                <span className="text-xs text-text-secondary font-normal">
                  /{subscription?.billing_cycle === "yearly" ? "yr" : "mo"}
                </span>
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border">
              <span className="text-xs text-text-secondary uppercase">Next Renewal Date</span>
              <div className="font-bold text-text mt-1">
                {targetDate ? targetDate.toLocaleDateString() : "N/A"}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <h4 className="font-semibold text-xs text-text-secondary uppercase mb-2">
              Plan Entitlements:
            </h4>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-text">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Unlimited Tables & Dynamic QR Codes
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Waiter POS & Order State Machine
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Realtime KDS with Audio Alerts
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Bangladesh NBR Mushak-6.3 VAT Reports
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Daily Cash Shifts & EOD Z-Reports
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" /> Append-Only Immutable Audit Trail
              </span>
            </div>
          </div>
        </Card>

        {/* Support & Billing Helpline Card */}
        <Card className="p-6 space-y-4 bg-gradient-to-b from-primary/5 to-transparent border border-border">
          <div className="flex items-center gap-2 text-primary font-bold">
            <ShieldCheck className="w-5 h-5" />
            <h3>AmarMenu Official Billing</h3>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Subscription payments are processed manually via bKash Merchant, Nagad, or direct bank transfer.
          </p>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-2.5 bg-white rounded border border-border">
              <div className="text-[10px] text-text-secondary uppercase font-sans">bKash Merchant</div>
              <div className="font-bold text-text text-sm">01700-000000</div>
            </div>
            <div className="p-2.5 bg-white rounded border border-border">
              <div className="text-[10px] text-text-secondary uppercase font-sans">Nagad Merchant</div>
              <div className="font-bold text-text text-sm">01800-000000</div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => loadData(restaurantId)}
          >
            Refresh Status
          </Button>
        </Card>
      </div>

      {/* Invoice & Payment History */}
      <Card className="overflow-hidden border border-border">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-text">Subscription Payment History</h3>
            <p className="text-xs text-text-secondary">Recent subscription invoices and verification statuses</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-subtle text-text-secondary border-b border-border uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Plan / Cycle</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Method / TrxID</th>
                <th className="py-3 px-4">Date Submitted</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-secondary text-sm">
                    No payment history recorded yet
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-text">
                      {inv.invoice_number}
                    </td>
                    <td className="py-3 px-4 capitalize">
                      <span className="font-semibold text-text">{inv.plan_code}</span>
                      <span className="text-text-secondary text-[11px] block">{inv.billing_cycle}</span>
                    </td>
                    <td className="py-3 px-4 font-bold text-text">
                      {formatCurrency(inv.amount)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="uppercase font-semibold text-primary">{inv.payment_method}</span>
                      {inv.transaction_id && (
                        <span className="font-mono text-text-secondary block text-[11px]">
                          {inv.transaction_id}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-text-secondary">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {inv.status === "paid" && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success">
                          PAID
                        </span>
                      )}
                      {inv.status === "pending" && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-warning/15 text-warning flex items-center justify-center gap-1">
                          <Clock className="w-3 h-3" /> PENDING REVIEW
                        </span>
                      )}
                      {inv.status === "rejected" && (
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold bg-error/10 text-error cursor-help"
                          title={inv.rejection_reason || "Rejected by Super Admin"}
                        >
                          REJECTED
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Submit Payment Modal */}
      {showPaymentModal && restaurantId && (
        <SubmitPaymentModal
          restaurantId={restaurantId}
          currentPlan={subscription?.plan_code || "growth"}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => loadData(restaurantId)}
        />
      )}
    </div>
  );
};

export default SubscriptionPage;
