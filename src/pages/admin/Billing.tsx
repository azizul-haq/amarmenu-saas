import React, { useState, useEffect, useCallback } from "react";
import {
  CreditCard,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  Shield,
  Layers,
  Search,
  Plus,
  Edit,
  Archive,
  Check,
} from "lucide-react";
import { Card, Button, Loading } from "../../components/ui";
import {
  getPlatformBillingOverview,
  verifySubscriptionPayment,
  evaluateSubscriptionGraceAndLock,
  adminOverrideSubscription,
  exportSubscriptionInvoicesCSV,
  adminListPlans,
  adminSavePlan,
  adminTogglePlanStatus,
} from "../../services/subscriptionService";
import type {
  PlatformBillingOverview,
  SubscriptionInvoice,
  TenantSubscriptionRecord,
  SubscriptionPlanRecord,
} from "../../schemas/subscriptionSchema";
import { formatCurrency } from "../../utils/helpers";

export const Billing: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"pending" | "subscriptions" | "invoices" | "plans">("pending");
  const [loading, setLoading] = useState<boolean>(true);
  const [overview, setOverview] = useState<PlatformBillingOverview | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Sweep loading
  const [sweeping, setSweeping] = useState<boolean>(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Verify (Approve) Modal state
  const [approvingInvoice, setApprovingInvoice] = useState<SubscriptionInvoice | null>(null);
  const [typedVerifyAmount, setTypedVerifyAmount] = useState<string>("");

  // Reject Modal state
  const [rejectingInvoice, setRejectingInvoice] = useState<SubscriptionInvoice | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [processingAction, setProcessingAction] = useState<boolean>(false);

  // Override Modal state
  const [overrideModalSub, setOverrideModalSub] = useState<TenantSubscriptionRecord | null>(null);
  const [overridePlan, setOverridePlan] = useState<"starter" | "growth" | "enterprise">("growth");
  const [overrideStatus, setOverrideStatus] = useState<"trial" | "active" | "grace_period" | "suspended">("active");
  const [overrideDays, setOverrideDays] = useState<number>(30);

  // Plan Edit/Create Modal state
  const [showPlanModal, setShowPlanModal] = useState<boolean>(false);
  const [planForm, setPlanForm] = useState<{
    id?: string;
    name: string;
    display_name: string;
    description: string;
    price_monthly: number;
    price_yearly: number;
    max_tables: string;
    max_staff: string;
    features: string;
    is_active: boolean;
  }>({
    name: "",
    display_name: "",
    description: "",
    price_monthly: 0,
    price_yearly: 0,
    max_tables: "",
    max_staff: "",
    features: "",
    is_active: true,
  });

  const loadBillingData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [overviewRes, plansRes] = await Promise.all([
      getPlatformBillingOverview(),
      adminListPlans(),
    ]);

    if (overviewRes.success && overviewRes.data) {
      setOverview(overviewRes.data);
    } else {
      setError(overviewRes.error || "Failed to load billing overview");
    }

    if (plansRes.success) {
      setPlans(plansRes.plans);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  // Plan handlers
  const handleOpenEditPlan = (plan: SubscriptionPlanRecord) => {
    setPlanForm({
      id: plan.id,
      name: plan.name,
      display_name: plan.display_name,
      description: plan.description || "",
      price_monthly: plan.price_monthly,
      price_yearly: plan.price_yearly,
      max_tables: plan.max_tables !== null && plan.max_tables !== undefined ? String(plan.max_tables) : "",
      max_staff: plan.max_staff !== null && plan.max_staff !== undefined ? String(plan.max_staff) : "",
      features: (plan.features || []).join("\n"),
      is_active: plan.is_active,
    });
    setShowPlanModal(true);
  };

  const handleOpenCreatePlan = () => {
    setPlanForm({
      name: "",
      display_name: "",
      description: "",
      price_monthly: 0,
      price_yearly: 0,
      max_tables: "",
      max_staff: "",
      features: "",
      is_active: true,
    });
    setShowPlanModal(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planForm.name.trim() || !planForm.display_name.trim()) {
      setError("Plan identifier and display name are required.");
      return;
    }

    setProcessingAction(true);
    setError(null);

    const featureList = planForm.features
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    const res = await adminSavePlan({
      id: planForm.id,
      name: planForm.name.trim(),
      display_name: planForm.display_name.trim(),
      description: planForm.description.trim(),
      price_monthly: Number(planForm.price_monthly) || 0,
      price_yearly: Number(planForm.price_yearly) || 0,
      max_tables: planForm.max_tables ? parseInt(planForm.max_tables) : null,
      max_staff: planForm.max_staff ? parseInt(planForm.max_staff) : null,
      features: featureList,
      is_active: planForm.is_active,
    });

    if (res.success) {
      setActionSuccess("Subscription plan saved successfully!");
      setShowPlanModal(false);
      setTimeout(() => setActionSuccess(null), 3000);
      await loadBillingData();
    } else {
      setError(res.error || "Failed to save plan.");
    }
    setProcessingAction(false);
  };

  const handleTogglePlan = async (plan: SubscriptionPlanRecord) => {
    setProcessingAction(true);
    const res = await adminTogglePlanStatus(plan.id, !plan.is_active);
    if (res.success) {
      setActionSuccess(`Plan '${plan.display_name}' ${!plan.is_active ? "activated" : "archived"} successfully.`);
      setTimeout(() => setActionSuccess(null), 3000);
      await loadBillingData();
    } else {
      setError(res.error || "Failed to update plan status.");
    }
    setProcessingAction(false);
  };

  // Handle Verify (Approve)
  const handleConfirmApprove = async () => {
    if (!approvingInvoice) return;
    const numAmount = parseFloat(typedVerifyAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid verified amount matching the invoice.");
      return;
    }
    setProcessingAction(true);
    setError(null);
    try {
      const res = await verifySubscriptionPayment({
        invoiceId: approvingInvoice.id,
        action: "approve",
        amount: numAmount,
      });
      if (res.success) {
        setActionSuccess("Subscription verified and account activated successfully!");
        setTimeout(() => setActionSuccess(null), 3000);
        setApprovingInvoice(null);
        setTypedVerifyAmount("");
        await loadBillingData();
      } else {
        setError(res.error || "Failed to approve payment");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error verifying payment");
    } finally {
      setProcessingAction(false);
    }
  };

  // Handle Reject
  const handleConfirmReject = async () => {
    if (!rejectingInvoice || !rejectReason.trim()) return;
    setProcessingAction(true);
    setError(null);
    try {
      const res = await verifySubscriptionPayment({
        invoiceId: rejectingInvoice.id,
        action: "reject",
        amount: rejectingInvoice.amount,
        rejectionReason: rejectReason.trim(),
      });
      if (res.success) {
        setActionSuccess("Payment was rejected.");
        setTimeout(() => setActionSuccess(null), 3000);
        setRejectingInvoice(null);
        setRejectReason("");
        await loadBillingData();
      } else {
        setError(res.error || "Failed to reject payment");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error rejecting payment");
    } finally {
      setProcessingAction(false);
    }
  };

  // Handle Grace & Lock Sweep
  const handleRunSweep = async () => {
    setSweeping(true);
    setError(null);
    try {
      const res = await evaluateSubscriptionGraceAndLock();
      if (res.success && res.data) {
        setActionSuccess(
          `Sweep Complete: ${res.data.grace_period_assigned} tenants entered grace period, ${res.data.suspended_and_locked} suspended/locked.`
        );
        setTimeout(() => setActionSuccess(null), 4000);
        await loadBillingData();
      } else {
        setError(res.error || "Failed to run evaluation sweep");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error running sweep");
    } finally {
      setSweeping(false);
    }
  };

  // Handle Admin Override Submission
  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideModalSub) return;
    setProcessingAction(true);
    setError(null);
    try {
      const res = await adminOverrideSubscription({
        restaurantId: overrideModalSub.restaurant_id,
        planCode: overridePlan,
        status: overrideStatus,
        extendDays: overrideDays,
      });
      if (res.success) {
        setActionSuccess("Subscription modified successfully.");
        setTimeout(() => setActionSuccess(null), 3000);
        setOverrideModalSub(null);
        await loadBillingData();
      } else {
        setError(res.error || "Failed to update subscription");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error modifying subscription");
    } finally {
      setProcessingAction(false);
    }
  };

  if (loading && !overview) {
    return <Loading text="Loading Platform Subscriptions & Billing..." />;
  }

  const metrics = overview?.metrics;
  const pendingInvoices = (overview?.invoices || []).filter((i) => i.status === "pending");
  const filteredInvoices = (overview?.invoices || []).filter((i) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      i.invoice_number.toLowerCase().includes(q) ||
      (i.restaurant_name && i.restaurant_name.toLowerCase().includes(q)) ||
      (i.transaction_id && i.transaction_id.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-primary" />
            Subscriptions & Billing Management
          </h2>
          <p className="text-text-secondary text-sm">
            Verify bKash/Nagad payments, monitor tenant subscription lifecycles, and enforce grace periods
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className={`w-4 h-4 ${sweeping ? "animate-spin" : ""}`} />}
            onClick={handleRunSweep}
            disabled={sweeping}
            title="Scan subscriptions and assign grace period or auto-lock suspended accounts"
          >
            {sweeping ? "Sweeping..." : "Run Grace & Lock Sweep"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            icon={<Download className="w-4 h-4" />}
            onClick={() => exportSubscriptionInvoicesCSV(overview?.invoices || [])}
            disabled={!overview?.invoices.length}
          >
            Export Invoices CSV
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3 bg-success/10 border border-success/30 text-success rounded-lg text-sm flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Platform MRR</span>
            <DollarSign className="w-4 h-4 text-success" />
          </div>
          <div className="text-xl font-bold text-text">
            {formatCurrency(metrics?.total_mrr || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Monthly Recurring</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Projected ARR</span>
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div className="text-xl font-bold text-text">
            {formatCurrency(metrics?.total_arr || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Annual Recurring</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-warning">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-warning">Pending Review</span>
            <Clock className="w-4 h-4 text-warning" />
          </div>
          <div className="text-xl font-bold text-warning">
            {metrics?.pending_verifications || 0}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">bKash/Nagad to verify</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Active Paying</span>
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div className="text-xl font-bold text-text">
            {metrics?.active_subscriptions || 0}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Paid accounts</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Free Trials</span>
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <div className="text-xl font-bold text-text">
            {metrics?.trial_subscriptions || 0}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">In 14-day trial</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-error">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-error">Overdue / Locked</span>
            <XCircle className="w-4 h-4 text-error" />
          </div>
          <div className="text-xl font-bold text-error">
            {(metrics?.grace_subscriptions || 0) + (metrics?.suspended_subscriptions || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">
            {metrics?.grace_subscriptions || 0} grace, {metrics?.suspended_subscriptions || 0} locked
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border space-x-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab("pending")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "pending"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <Clock className="w-4 h-4" />
          Pending Verifications ({pendingInvoices.length})
        </button>
        <button
          onClick={() => setActiveTab("subscriptions")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "subscriptions"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <Shield className="w-4 h-4" />
          Tenant Subscriptions ({overview?.subscriptions.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "invoices"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          All Invoices History
        </button>
        <button
          onClick={() => setActiveTab("plans")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "plans"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <Layers className="w-4 h-4" />
          Subscription Plans ({plans.length})
        </button>
      </div>

      {/* TAB 1: PENDING VERIFICATIONS */}
      {activeTab === "pending" && (
        <Card className="overflow-hidden border border-border">
          <div className="p-4 border-b border-border bg-bg-subtle flex items-center justify-between">
            <h3 className="font-bold text-sm text-text">
              Manual Mobile Banking Verifications (bKash & Nagad)
            </h3>
            <span className="text-xs text-text-secondary">
              Review transaction IDs against your merchant statements before approving
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-subtle text-text-secondary border-b border-border uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Restaurant</th>
                  <th className="py-3 px-4">Plan / Cycle</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Channel / TrxID</th>
                  <th className="py-3 px-4">Sender Phone</th>
                  <th className="py-3 px-4">Date Submitted</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-text-secondary text-sm">
                      No pending payment verifications! All tenant payments are up to date. 🎉
                    </td>
                  </tr>
                ) : (
                  pendingInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-bg-subtle/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-text">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 px-4 font-semibold text-text">
                        {inv.restaurant_name || "Restaurant"}
                      </td>
                      <td className="py-3 px-4 capitalize">
                        <span className="font-bold text-primary">{inv.plan_code}</span>
                        <span className="text-text-secondary text-[11px] block">{inv.billing_cycle}</span>
                      </td>
                      <td className="py-3 px-4 font-bold text-text">
                        {formatCurrency(inv.amount)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="uppercase font-bold text-[#E2136E]">
                          {inv.payment_method}
                        </span>
                        <span className="font-mono text-text font-bold block text-xs bg-bg-subtle px-1.5 py-0.5 rounded border border-border mt-0.5 inline-block">
                          {inv.transaction_id || "N/A"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-text">
                        {inv.sender_number || "N/A"}
                      </td>
                      <td className="py-3 px-4 text-text-secondary whitespace-nowrap">
                        {new Date(inv.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            onClick={() => {
                              setApprovingInvoice(inv);
                              setTypedVerifyAmount(inv.amount.toString());
                            }}
                            disabled={processingAction}
                          >
                            Verify & Activate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-error border-error/30 hover:bg-error/10"
                            icon={<XCircle className="w-3.5 h-3.5" />}
                            onClick={() => {
                              setRejectingInvoice(inv);
                              setRejectReason("");
                            }}
                            disabled={processingAction}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 2: TENANT SUBSCRIPTIONS */}
      {activeTab === "subscriptions" && (
        <Card className="overflow-hidden border border-border">
          <div className="p-4 border-b border-border bg-bg-subtle flex items-center justify-between">
            <h3 className="font-bold text-sm text-text">
              Active Tenant Subscriptions & Lifecycle State
            </h3>
            <span className="text-xs text-text-secondary">
              Directly override plan tiers, extend trial periods, or reactivate suspended accounts
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-subtle text-text-secondary border-b border-border uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Restaurant</th>
                  <th className="py-3 px-4">Plan Tier</th>
                  <th className="py-3 px-4">Monthly Rate</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Period / Renewal</th>
                  <th className="py-3 px-4 text-center">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overview?.subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-text">{sub.restaurant_name}</div>
                      <div className="text-[10px] text-text-secondary font-mono">{sub.owner_phone}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-primary uppercase">
                      {sub.plan_code}
                    </td>
                    <td className="py-3 px-4 font-bold text-text">
                      {formatCurrency(sub.amount)}
                    </td>
                    <td className="py-3 px-4">
                      {sub.status === "active" && (
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-success/15 text-success">
                          ACTIVE
                        </span>
                      )}
                      {sub.status === "trial" && (
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-primary/15 text-primary">
                          TRIAL
                        </span>
                      )}
                      {sub.status === "grace_period" && (
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-warning/20 text-warning animate-pulse">
                          GRACE PERIOD
                        </span>
                      )}
                      {sub.status === "suspended" && (
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-error/15 text-error">
                          SUSPENDED
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-text-secondary whitespace-nowrap">
                      {new Date(sub.current_period_end).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setOverrideModalSub(sub);
                          setOverridePlan(
                            (sub.plan_code as "starter" | "growth" | "enterprise") || "growth"
                          );
                          setOverrideStatus(
                            (sub.status as "trial" | "active" | "grace_period" | "suspended") || "active"
                          );
                          setOverrideDays(30);
                        }}
                      >
                        Override / Extend
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: ALL INVOICES HISTORY */}
      {activeTab === "invoices" && (
        <Card className="overflow-hidden border border-border">
          <div className="p-4 border-b border-border bg-bg-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="font-bold text-sm text-text">Complete SaaS Invoice Archive</h3>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-text-secondary absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search invoice, tenant, or TrxID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input py-1.5 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-subtle text-text-secondary border-b border-border uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Restaurant</th>
                  <th className="py-3 px-4">Plan / Cycle</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Method / TrxID</th>
                  <th className="py-3 px-4">Submitted At</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-text-secondary text-sm">
                      No invoices found matching your filter
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-bg-subtle/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-text">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 px-4 font-semibold text-text">
                        {inv.restaurant_name}
                      </td>
                      <td className="py-3 px-4 capitalize">
                        <span className="font-semibold text-primary">{inv.plan_code}</span>
                        <span className="text-text-secondary text-[10px] block">{inv.billing_cycle}</span>
                      </td>
                      <td className="py-3 px-4 font-bold text-text">
                        {formatCurrency(inv.amount)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="uppercase font-semibold text-text">{inv.payment_method}</span>
                        {inv.transaction_id && (
                          <span className="font-mono text-text-secondary block text-[10px]">
                            {inv.transaction_id}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-text-secondary whitespace-nowrap">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {inv.status === "paid" && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success">
                            PAID
                          </span>
                        )}
                        {inv.status === "pending" && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-warning/15 text-warning">
                            PENDING
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
      )}

      {/* TAB 4: SUBSCRIPTION PLANS MANAGEMENT */}
      {activeTab === "plans" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-text flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                Subscription Pricing Tiers & Feature Limits
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Define pricing tiers (Starter, Growth, Enterprise), adjust table/staff quotas, and manage promotional plans
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={handleOpenCreatePlan}
            >
              Create New Plan
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((p) => {
              const features = Array.isArray(p.features) ? p.features : [];
              return (
                <Card
                  key={p.id}
                  className={`p-6 flex flex-col justify-between border ${
                    !p.is_active
                      ? "opacity-60 bg-bg-subtle border-border"
                      : p.name === "growth"
                      ? "ring-2 ring-primary border-primary shadow-md"
                      : "border-border shadow-xs"
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xl font-black text-text">{p.display_name}</h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-bg-subtle text-text-secondary border border-border uppercase">
                            {p.name}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary mt-1 min-h-[32px]">
                          {p.description || "General restaurant management tier."}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          p.is_active ? "bg-success/15 text-success" : "bg-neutral-200 text-neutral-600"
                        }`}
                      >
                        {p.is_active ? "ACTIVE" : "ARCHIVED"}
                      </span>
                    </div>

                    <div className="border-t border-b border-border py-3 space-y-1">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-text">
                          {formatCurrency(p.price_monthly)}
                        </span>
                        <span className="text-xs text-text-secondary font-medium">/month</span>
                      </div>
                      <div className="text-xs text-emerald-600 font-semibold">
                        Annual: {formatCurrency(p.price_yearly)}/yr (20% off)
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-bg-subtle border border-border">
                        <span className="text-[10px] uppercase font-bold text-text-secondary block">
                          Table Limit
                        </span>
                        <span className="font-bold text-text">
                          {p.max_tables ? `${p.max_tables} Tables` : "Unlimited"}
                        </span>
                      </div>
                      <div className="p-2 rounded bg-bg-subtle border border-border">
                        <span className="text-[10px] uppercase font-bold text-text-secondary block">
                          Staff Accounts
                        </span>
                        <span className="font-bold text-text">
                          {p.max_staff ? `${p.max_staff} Staff` : "Unlimited"}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-text-secondary">
                      <span className="font-bold text-text">{p.active_subscribers || 0}</span> active restaurant tenant{(p.active_subscribers || 0) === 1 ? "" : "s"}
                    </div>

                    <ul className="space-y-2 text-xs text-text-secondary pt-1">
                      {features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex items-center gap-2 pt-5 border-t border-border mt-5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      icon={<Edit className="w-3.5 h-3.5" />}
                      onClick={() => handleOpenEditPlan(p)}
                    >
                      Edit Plan
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      title={p.is_active ? "Archive this plan" : "Activate this plan"}
                      onClick={() => handleTogglePlan(p)}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* VERIFY / APPROVE MODAL */}
      {approvingInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-border p-5 space-y-4">
            <h4 className="font-bold text-text text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              Verify & Activate Payment
            </h4>
            <div className="text-xs text-text-secondary space-y-1.5 bg-bg-subtle p-3 rounded-lg border border-border">
              <div className="flex justify-between">
                <span>Invoice:</span>
                <span className="font-semibold text-text">{approvingInvoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span>Restaurant:</span>
                <span className="font-semibold text-text">{approvingInvoice.restaurant_name}</span>
              </div>
              <div className="flex justify-between">
                <span>Method / TrxID:</span>
                <span className="font-mono text-text uppercase">
                  {approvingInvoice.payment_method} - {approvingInvoice.transaction_id || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Invoice Amount:</span>
                <span className="font-bold text-primary">৳{approvingInvoice.amount.toLocaleString()}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">
                Type Verified Amount (৳) <span className="text-error">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={typedVerifyAmount}
                onChange={(e) => setTypedVerifyAmount(e.target.value)}
                placeholder="Type the exact verified payment amount"
                className="input text-xs font-mono"
              />
              <p className="text-[11px] text-text-secondary mt-1">
                Must match the bank / MFS statement amount exactly.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setApprovingInvoice(null)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmApprove}
                disabled={processingAction || !typedVerifyAmount || parseFloat(typedVerifyAmount) <= 0}
              >
                {processingAction ? "Verifying..." : "Confirm & Activate"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-border p-5 space-y-4">
            <h4 className="font-bold text-text text-base">Reject Subscription Payment</h4>
            <p className="text-xs text-text-secondary">
              Provide a reason for rejecting Invoice #{rejectingInvoice.invoice_number} (TrxID:{" "}
              {rejectingInvoice.transaction_id || "N/A"}). The restaurant owner will see this reason.
            </p>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">
                Rejection Reason <span className="text-error">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Transaction ID was not found in our bKash statement"
                className="input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectingInvoice(null)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-error hover:bg-error/90 text-white"
                onClick={handleConfirmReject}
                disabled={processingAction || rejectReason.trim().length < 3}
              >
                {processingAction ? "Rejecting..." : "Confirm Rejection"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* OVERRIDE / EXTEND MODAL */}
      {overrideModalSub && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveOverride}
            className="bg-white rounded-xl shadow-xl w-full max-w-md border border-border p-5 space-y-4"
          >
            <h4 className="font-bold text-text text-base">
              Manage Subscription: {overrideModalSub.restaurant_name}
            </h4>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Plan Tier</label>
              <select
                value={overridePlan}
                onChange={(e) =>
                  setOverridePlan(e.target.value as "starter" | "growth" | "enterprise")
                }
                className="input text-xs"
              >
                <option value="starter">Starter (৳1,499/mo)</option>
                <option value="growth">Growth (৳2,999/mo)</option>
                <option value="enterprise">Enterprise (৳5,999/mo)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Subscription Status</label>
              <select
                value={overrideStatus}
                onChange={(e) =>
                  setOverrideStatus(
                    e.target.value as "trial" | "active" | "grace_period" | "suspended"
                  )
                }
                className="input text-xs"
              >
                <option value="active">Active (Paid)</option>
                <option value="trial">Free Trial</option>
                <option value="grace_period">Grace Period (7 Days)</option>
                <option value="suspended">Suspended / Locked</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">
                Extend Access By (Days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={overrideDays}
                onChange={(e) => setOverrideDays(parseInt(e.target.value) || 30)}
                className="input text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOverrideModalSub(null)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={processingAction}>
                {processingAction ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* PLAN EDIT / CREATE MODAL */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePlan}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg border border-border p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h4 className="font-bold text-text text-base">
                {planForm.id ? `Edit Plan: ${planForm.display_name}` : "Create New Subscription Plan"}
              </h4>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="text-text-secondary hover:text-text"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Plan Identifier (slug) <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(planForm.id)}
                  value={planForm.name}
                  onChange={(e) => setPlanForm({ ...planForm, name: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                  placeholder="e.g. starter, growth"
                  className="input text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Display Title <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={planForm.display_name}
                  onChange={(e) => setPlanForm({ ...planForm, display_name: e.target.value })}
                  placeholder="e.g. Starter Tier"
                  className="input text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Description</label>
              <input
                type="text"
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Target restaurant tier description..."
                className="input text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Monthly Price (৳ BDT) <span className="text-error">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={planForm.price_monthly}
                  onChange={(e) => setPlanForm({ ...planForm, price_monthly: Number(e.target.value) || 0 })}
                  className="input text-xs font-bold text-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Yearly Price (৳ BDT) <span className="text-error">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={planForm.price_yearly}
                  onChange={(e) => setPlanForm({ ...planForm, price_yearly: Number(e.target.value) || 0 })}
                  className="input text-xs font-bold text-emerald-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Max Tables (empty = unlimited)
                </label>
                <input
                  type="number"
                  min={1}
                  value={planForm.max_tables}
                  onChange={(e) => setPlanForm({ ...planForm, max_tables: e.target.value })}
                  placeholder="Unlimited"
                  className="input text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text mb-1">
                  Max Staff Accounts (empty = unlimited)
                </label>
                <input
                  type="number"
                  min={1}
                  value={planForm.max_staff}
                  onChange={(e) => setPlanForm({ ...planForm, max_staff: e.target.value })}
                  placeholder="Unlimited"
                  className="input text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">
                Plan Feature Highlights (one per line)
              </label>
              <textarea
                rows={4}
                value={planForm.features}
                onChange={(e) => setPlanForm({ ...planForm, features: e.target.value })}
                placeholder="Unlimited tables&#10;Waiter POS App&#10;KDS Display"
                className="input text-xs font-mono"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="plan_is_active"
                checked={planForm.is_active}
                onChange={(e) => setPlanForm({ ...planForm, is_active: e.target.checked })}
                className="rounded border-border text-primary"
              />
              <label htmlFor="plan_is_active" className="text-xs font-medium text-text cursor-pointer">
                Plan is active for new tenant subscriptions
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPlanModal(false)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={processingAction}>
                {processingAction ? "Saving..." : "Save Plan"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Billing;
