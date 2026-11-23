import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Zap, Lock, CheckCircle2 } from "lucide-react";
import { supabase } from "../config/supabase";
import { useAuth } from "../context/AuthContext";
import { Button, Modal } from "../components/ui";
import { formatCurrency } from "../utils/helpers";

export type PlanSlug = "starter" | "growth" | "enterprise";

export interface PlanFeatureMap {
  custom_logo: boolean;
  kds: boolean;
  delivery_role: boolean;
  vat_reports: boolean;
  cash_shifts: boolean;
  activity_history: boolean;
  pin_void: boolean;
  audit_logs: boolean;
  csv_export: boolean;
  [key: string]: boolean;
}

export interface PlanConfig {
  slug: PlanSlug;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  maxTables: number | null;
  maxStaff: number | null;
  features: PlanFeatureMap;
}

export const PLAN_CONFIGS: Record<PlanSlug, PlanConfig> = {
  starter: {
    slug: "starter",
    name: "Starter",
    priceMonthly: 1499,
    priceYearly: 14388,
    maxTables: 15,
    maxStaff: 5,
    features: {
      custom_logo: true,
      kds: false,
      delivery_role: false,
      vat_reports: false,
      cash_shifts: false,
      activity_history: false,
      pin_void: false,
      audit_logs: false,
      csv_export: false,
    },
  },
  growth: {
    slug: "growth",
    name: "Growth",
    priceMonthly: 2999,
    priceYearly: 28788,
    maxTables: 50,
    maxStaff: 15,
    features: {
      custom_logo: true,
      kds: true,
      delivery_role: true,
      vat_reports: true,
      cash_shifts: true,
      activity_history: true,
      pin_void: false,
      audit_logs: false,
      csv_export: false,
    },
  },
  enterprise: {
    slug: "enterprise",
    name: "Enterprise",
    priceMonthly: 5999,
    priceYearly: 57588,
    maxTables: null,
    maxStaff: null,
    features: {
      custom_logo: true,
      kds: true,
      delivery_role: true,
      vat_reports: true,
      cash_shifts: true,
      activity_history: true,
      pin_void: true,
      audit_logs: true,
      csv_export: true,
    },
  },
};

export interface PlanLimitsResult {
  planSlug: PlanSlug;
  planName: string;
  maxTables: number | null;
  maxStaff: number | null;
  features: PlanFeatureMap;
  priceMonthly: number;
  priceYearly: number;
  loading: boolean;
  subscriptionStatus: string;
  canAddTable: (currentTableCount: number) => boolean;
  canAddStaff: (currentStaffCount: number) => boolean;
  hasFeature: (featureKey: string) => boolean;
  isFeatureLocked: (featureKey: string) => boolean;
  refresh: () => Promise<void>;
}

export const usePlanLimits = (): PlanLimitsResult => {
  const { restaurant, restaurantId: authRestaurantId, role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  const resolvedRestaurantId = useMemo(() => {
    if (authRestaurantId) return authRestaurantId;
    if (restaurant?.id) return restaurant.id;
    try {
      const stored = sessionStorage.getItem("current_restaurant");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.id) return parsed.id;
      }
    } catch {
      // ignore
    }
    return null;
  }, [authRestaurantId, restaurant?.id]);

  // Initial plan from restaurant record
  const initialPlanSlug: PlanSlug = useMemo(() => {
    const raw = (restaurant as any)?.subscription_plan || "growth";
    return (raw === "starter" || raw === "enterprise" ? raw : "growth") as PlanSlug;
  }, [restaurant]);

  const [activePlanSlug, setActivePlanSlug] = useState<PlanSlug>(initialPlanSlug);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("active");
  const [dbLimits, setDbLimits] = useState<{
    maxTables: number | null;
    maxStaff: number | null;
    features: PlanFeatureMap;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchPlanData = useCallback(async () => {
    if (!resolvedRestaurantId && !isSuperAdmin) {
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch active subscription for tenant
      let currentSlug: PlanSlug = initialPlanSlug;
      let status = "active";

      if (resolvedRestaurantId) {
        const { data: subData } = await supabase
          .from("subscriptions")
          .select("id, plan_code, status, plan_id")
          .eq("restaurant_id", resolvedRestaurantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subData?.plan_code) {
          const code = subData.plan_code.toLowerCase().trim();
          if (code === "starter" || code === "growth" || code === "enterprise") {
            currentSlug = code as PlanSlug;
          }
        }
        if (subData?.status) {
          status = subData.status;
        }
      }

      setActivePlanSlug(currentSlug);
      setSubscriptionStatus(status);

      // 2. Fetch plan record from plans table
      const { data: planRecord } = await supabase
        .from("plans")
        .select("name, max_tables, max_staff, features")
        .eq("name", currentSlug)
        .maybeSingle();

      if (planRecord) {
        let parsedFeatures: PlanFeatureMap = { ...PLAN_CONFIGS[currentSlug].features };
        if (planRecord.features && typeof planRecord.features === "object" && !Array.isArray(planRecord.features)) {
          parsedFeatures = { ...parsedFeatures, ...(planRecord.features as PlanFeatureMap) };
        }
        setDbLimits({
          maxTables: planRecord.max_tables,
          maxStaff: planRecord.max_staff,
          features: parsedFeatures,
        });
      }
    } catch (e) {
      console.warn("Failed to fetch subscription plan limits from DB:", e);
    } finally {
      setLoading(false);
    }
  }, [resolvedRestaurantId, initialPlanSlug, isSuperAdmin]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  const baseConfig = PLAN_CONFIGS[activePlanSlug] || PLAN_CONFIGS.growth;
  const maxTables = dbLimits ? dbLimits.maxTables : baseConfig.maxTables;
  const maxStaff = dbLimits ? dbLimits.maxStaff : baseConfig.maxStaff;
  const features = dbLimits ? dbLimits.features : baseConfig.features;

  const canAddTable = useCallback(
    (currentTableCount: number): boolean => {
      if (isSuperAdmin) return true;
      if (maxTables === null || maxTables === undefined) return true;
      return currentTableCount < maxTables;
    },
    [isSuperAdmin, maxTables]
  );

  const canAddStaff = useCallback(
    (currentStaffCount: number): boolean => {
      if (isSuperAdmin) return true;
      if (maxStaff === null || maxStaff === undefined) return true;
      return currentStaffCount < maxStaff;
    },
    [isSuperAdmin, maxStaff]
  );

  const hasFeature = useCallback(
    (featureKey: string): boolean => {
      if (isSuperAdmin) return true;
      return Boolean(features[featureKey]);
    },
    [isSuperAdmin, features]
  );

  const isFeatureLocked = useCallback(
    (featureKey: string): boolean => {
      return !hasFeature(featureKey);
    },
    [hasFeature]
  );

  return {
    planSlug: activePlanSlug,
    planName: baseConfig.name,
    maxTables,
    maxStaff,
    features,
    priceMonthly: baseConfig.priceMonthly,
    priceYearly: baseConfig.priceYearly,
    loading,
    subscriptionStatus,
    canAddTable,
    canAddStaff,
    hasFeature,
    isFeatureLocked,
    refresh: fetchPlanData,
  };
};

/**
 * Clean In-App Banner notifying users when limits are reached or a feature is locked
 */
interface UpgradePlanBannerProps {
  title?: string;
  description?: string;
  requiredPlan?: "growth" | "enterprise";
  featureName?: string;
  currentCount?: number;
  maxLimit?: number | null;
  onUpgradeClick?: () => void;
  className?: string;
}

export const UpgradePlanBanner: React.FC<UpgradePlanBannerProps> = ({
  title,
  description,
  requiredPlan = "growth",
  featureName,
  currentCount,
  maxLimit,
  onUpgradeClick,
  className = "",
}) => {
  const reqPlanName = requiredPlan === "enterprise" ? "Enterprise Tier" : "Growth Tier";

  const defaultTitle = featureName
    ? `${featureName} is locked on your current plan`
    : maxLimit !== undefined && maxLimit !== null
    ? `Plan Limit Reached (${currentCount || 0}/${maxLimit})`
    : `Upgrade to ${reqPlanName}`;

  const defaultDesc = featureName
    ? `Unlock ${featureName} and scale your restaurant operations by upgrading to the ${reqPlanName}.`
    : maxLimit !== undefined && maxLimit !== null
    ? `You have reached the maximum quota of ${maxLimit} allowed under your plan. Upgrade to increase your capacity.`
    : `Get full access to all advanced modules by upgrading to ${reqPlanName}.`;

  const handleAction = () => {
    if (onUpgradeClick) {
      onUpgradeClick();
    } else {
      window.location.href = "/restaurant/subscription";
    }
  };

  return (
    <div
      className={`p-4 rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5 text-amber-700">
          <Lock className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span>{title || defaultTitle}</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 border border-amber-300">
              {reqPlanName} Required
            </span>
          </h4>
          <p className="text-xs text-gray-600 mt-0.5 max-w-xl leading-relaxed">
            {description || defaultDesc}
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="primary"
        onClick={handleAction}
        icon={<Zap className="w-3.5 h-3.5" />}
        className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold shrink-0 self-end sm:self-center shadow-xs"
      >
        Upgrade Plan
      </Button>
    </div>
  );
};

/**
 * Interactive Upgrade Plan Modal showcasing 3-tier comparison
 */
interface UpgradePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  highlightPlan?: PlanSlug;
  featureReason?: string;
}

export const UpgradePlanModal: React.FC<UpgradePlanModalProps> = ({
  isOpen,
  onClose,
  highlightPlan = "growth",
  featureReason,
}) => {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="SaaS Subscription Plans & Quotas" size="lg">
      <div className="space-y-4">
        {featureReason && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{featureReason}</span>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {Object.entries(PLAN_CONFIGS).map(([key, plan]) => {
            const isTarget = key === highlightPlan;
            return (
              <div
                key={key}
                className={`p-4 rounded-xl border flex flex-col justify-between ${
                  isTarget
                    ? "border-accent ring-2 ring-accent/30 bg-accent/5 shadow-sm"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-extrabold text-base text-gray-900">{plan.name}</h4>
                    {key === "growth" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent text-white">
                        Popular
                      </span>
                    )}
                  </div>
                  <div className="mb-3">
                    <span className="text-2xl font-black text-gray-900">
                      {formatCurrency(plan.priceMonthly)}
                    </span>
                    <span className="text-xs text-gray-500">/mo</span>
                    <div className="text-[11px] text-emerald-600 font-semibold">
                      Annual: {formatCurrency(plan.priceYearly)}/yr (20% off)
                    </div>
                  </div>

                  <div className="space-y-1.5 py-2.5 border-t border-b border-gray-100 text-xs">
                    <div className="flex justify-between font-semibold text-gray-700">
                      <span>Max Tables:</span>
                      <span className="font-bold text-gray-900">
                        {plan.maxTables ? `${plan.maxTables} Tables` : "Unlimited"}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold text-gray-700">
                      <span>Max Staff:</span>
                      <span className="font-bold text-gray-900">
                        {plan.maxStaff ? `${plan.maxStaff} Staff` : "Unlimited"}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-1.5 py-3 text-xs text-gray-600">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                      <span>Custom Restaurant Logo</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.kds ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.kds ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.kds ? "text-gray-900" : "text-gray-400 line-through"}>
                        Real-time Kitchen KDS
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.delivery_role ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.delivery_role ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.delivery_role ? "text-gray-900" : "text-gray-400 line-through"}>
                        Delivery Role Dispatch
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.vat_reports ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.vat_reports ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.vat_reports ? "text-gray-900" : "text-gray-400 line-through"}>
                        NBR Mushak-6.3 VAT
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.cash_shifts ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.cash_shifts ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.cash_shifts ? "text-gray-900" : "text-gray-400 line-through"}>
                        Cashier Shifts & Z-Report
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.pin_void ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.pin_void ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.pin_void ? "text-gray-900" : "text-gray-400 line-through"}>
                        Manager PIN Void
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.audit_logs ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.audit_logs ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.audit_logs ? "text-gray-900" : "text-gray-400 line-through"}>
                        Tamper-Proof Audit Trail
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={plan.features.csv_export ? "text-success font-bold" : "text-gray-300"}>
                        {plan.features.csv_export ? "✓" : "✕"}
                      </span>
                      <span className={plan.features.csv_export ? "text-gray-900" : "text-gray-400 line-through"}>
                        CSV Data Exports
                      </span>
                    </li>
                  </ul>
                </div>

                <Button
                  size="sm"
                  variant={isTarget ? "primary" : "outline"}
                  fullWidth
                  onClick={() => {
                    onClose();
                    window.location.href = "/restaurant/subscription";
                  }}
                  className="mt-2 text-xs font-bold"
                >
                  Select {plan.name}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
