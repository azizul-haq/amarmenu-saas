import React, { useEffect, useState, useRef } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  Package,
  UtensilsCrossed,
  Bell,
  Check,
  Calendar,
  Printer,
  Receipt,
  DollarSign,
  ShieldAlert,
  LayoutGrid,
  List,
  ChefHat,
  Search,
  X,
  Plus,
  FileText,
} from "lucide-react";
import {
  Card,
  Button,
  Badge,
  Modal,
  Textarea,
  Loading,
  Alert,
} from "../../components/ui";
import {
  subscribeToOrders,
  updateOrderStatus,
  recordKOTPrint,
} from "../../services/restaurantService";
import type { BillSettlementResult } from "../../services/restaurantService";
import { KOTReceipt } from "../../components/restaurant/KOTReceipt";
import { BillReceiptModal } from "../../components/restaurant/BillReceiptModal";
import { SettleBillModal } from "../../components/restaurant/SettleBillModal";
import { VoidOrderModal } from "../../components/restaurant/VoidOrderModal";
import { CreateOrderModal } from "../../components/restaurant/CreateOrderModal";
import type { VoidOrderResult } from "../../services/auditService";
import type { Order, OrderItem, Restaurant } from "../../config/supabase";
import { supabase } from "../../config/supabase";
import { formatDateTime, formatCurrency, playSound } from "../../utils/helpers";
import { usePermissions } from "../../hooks/usePermissions";
import { useAuth } from "../../context/AuthContext";

// Helper to synchronously read cached orders from sessionStorage for zero-delay instant render
const getCachedOrders = (restId: string | null): Order[] => {
  if (!restId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(`amarmenu_orders_cache_${restId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const Orders: React.FC = () => {
  const {
    restaurant: authRestaurant,
    restaurantId: authRestaurantId,
    profile,
    user,
    session,
    role: userRole,
    loading: authLoading,
  } = useAuth();

  const initialRestId =
    authRestaurantId ||
    authRestaurant?.id ||
    (() => {
      try {
        const raw = sessionStorage.getItem("current_restaurant");
        return raw ? JSON.parse(raw)?.id || "" : "";
      } catch {
        return "";
      }
    })();

  const [orders, setOrders] = useState<Order[]>(() => getCachedOrders(initialRestId));
  const [loading, setLoading] = useState<boolean>(() => orders.length === 0);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [settleOrder, setSettleOrder] = useState<Order | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [voidOrder, setVoidOrder] = useState<Order | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [restaurantName, setRestaurantName] = useState("Restaurant");
  const [restaurantData, setRestaurantData] = useState<Restaurant | null>(null);
  const {
    canConfirmOrder,
    canUpdateKitchenStatus,
    canSettleBill,
    canVoidOrder,
    canVoidSettledBill,
  } = usePermissions();
  const previousOrdersRef = useRef<Order[]>([]);
  const canMarkServed =
    canConfirmOrder ||
    canSettleBill ||
    ["waiter", "owner", "manager", "cashier"].includes(userRole || "");

  useEffect(() => {
    // If auth is still loading, wait before querying so we don't query with unauthenticated state
    if (authLoading) {
      if (orders.length === 0) setLoading(true);
      return;
    }

    let targetRestaurantId = authRestaurantId || authRestaurant?.id || "";
    let targetName = authRestaurant?.name || "";

    if (!targetRestaurantId) {
      const currentRestaurant = sessionStorage.getItem("current_restaurant");
      if (currentRestaurant) {
        try {
          const parsed = JSON.parse(currentRestaurant);
          targetRestaurantId = parsed.id || "";
          if (parsed.name) targetName = parsed.name;
        } catch {
          // fallback
        }
      }
    }

    // Require both restaurantId and authenticated session so we don't query RLS orders table as anon
    if (!targetRestaurantId || !user) {
      setLoading(false);
      return;
    }

    if (targetName) setRestaurantName(targetName);

    // Fetch restaurant details securely via get_my_restaurant() RPC
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_my_restaurant");
        if (!error && data) setRestaurantData(data as Restaurant);
      } catch {
        // ignore
      }
    })();

    let isSubscribed = true;

    // Safety timeout: GUARANTEED to stop "Loading orders..." within 6 seconds
    const safetyTimer = setTimeout(() => {
      if (isSubscribed) {
        console.warn("Orders fetch safety timeout reached - unblocking UI");
        setLoading(false);
      }
    }, 6000);

    // Subscribe to real-time orders
    const subscription = subscribeToOrders(
      targetRestaurantId,
      (newOrders) => {
        if (!isSubscribed) return;

        // Check for new pending orders to play sound
        const previousPending = previousOrdersRef.current.filter(
          (o) => o.status === "pending"
        ).length;
        const currentPending = newOrders.filter(
          (o) => o.status === "pending"
        ).length;

        if (currentPending > previousPending && previousPending !== 0) {
          playSound("notification");
        }

        previousOrdersRef.current = newOrders;
        setOrders(newOrders);
        setOrdersError(null);
        setLoading(false);
        clearTimeout(safetyTimer);
        try {
          if (targetRestaurantId && newOrders.length > 0) {
            sessionStorage.setItem(`amarmenu_orders_cache_${targetRestaurantId}`, JSON.stringify(newOrders.slice(0, 100)));
          }
        } catch {
          // ignore
        }
      },
      (fetchErr) => {
        if (!isSubscribed) return;
        console.error("Orders fetch subscription error:", fetchErr);
        setOrdersError(fetchErr.message || "Failed to load orders");
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    );

    return () => {
      isSubscribed = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [authLoading, user?.id, session?.access_token, authRestaurantId, authRestaurant?.id]);

  // Live search matcher
  const matchesSearch = (order: Order, q: string) => {
    if (!q.trim()) return true;
    const term = q.trim().toLowerCase();
    const orderNum = (order.order_number || "").toLowerCase();
    const invoiceNum = (order.invoice_number || "").toLowerCase();
    const custName = (order.customer_name || "").toLowerCase();
    const custPhone = (order.customer_phone || "").toLowerCase();
    const tableNum = (order.table_number || "").toLowerCase();
    const waiterName = (order.waiter_name || order.accepted_by_name || "").toLowerCase();
    const matchesDish =
      Array.isArray(order.items) &&
      order.items.some(
        (it: any) =>
          (it.name && it.name.toLowerCase().includes(term)) ||
          (it.name_bn && it.name_bn.toLowerCase().includes(term))
      );
    return (
      orderNum.includes(term) ||
      invoiceNum.includes(term) ||
      custName.includes(term) ||
      custPhone.includes(term) ||
      tableNum.includes(term) ||
      waiterName.includes(term) ||
      matchesDish
    );
  };

  // Filter and sort orders
  const filteredOrders = orders
    .filter((order) => {
      if (!matchesSearch(order, searchQuery)) return false;
      if (statusFilter === "all") return true;
      if (statusFilter === "pending") return order.status === "pending";
      if (statusFilter === "confirmed") return order.status === "accepted";
      if (statusFilter === "in_process") {
        return (
          order.status === "preparing" ||
          order.status === "ready" ||
          order.status === "served"
        );
      }
      if (statusFilter === "completed") return order.status === "completed";
      if (statusFilter === "cancelled") {
        return order.status === "cancelled" || order.status === "rejected";
      }
      return order.status === statusFilter;
    })
    .sort((a, b) => {
      // Pending orders first, then by creation date
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

  const handleStatusUpdate = async (
    orderId: string,
    newStatus: Order["status"],
    notes?: string
  ) => {
    const res = await updateOrderStatus(orderId, newStatus, notes);
    if (!res.success) {
      alert(res.error || "Failed to update order status");
    } else if (newStatus === "accepted") {
      const waiterStaffName =
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.email?.split("@")[0] ||
        "Staff Waiter";
      try {
        await supabase
          .from("orders")
          .update({
            waiter_name: waiterStaffName,
            accepted_by_name: waiterStaffName,
          })
          .eq("id", orderId);
      } catch (err) {
        console.warn("Could not set waiter name directly:", err);
      }
    }
  };

  const handleViewDetails = (order: Order) => {
    setSelectedOrder(order);
    setShowDetailsModal(true);
  };

  const handlePrintKOT = async (order: Order) => {
    setPrintOrder(order);
    await recordKOTPrint(order.id);
  };


  const formatOrderDate = (isoStr: string) => {
    if (!isoStr) return "-";
    const d = new Date(isoStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const hoursStr = String(hours).padStart(2, "0");
    return `${day}/${month}/${year} ${hoursStr}:${mins} ${ampm}`;
  };

  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </span>
        );
      case "accepted":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Check className="w-3 h-3 mr-1" />
            Confirmed
          </span>
        );
      case "preparing":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-300">
            <UtensilsCrossed className="w-3 h-3 mr-1" />
            In Process
          </span>
        );
      case "ready":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Bell className="w-3 h-3 mr-1" />
            Ready to Serve
          </span>
        );
      case "served":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
            <UtensilsCrossed className="w-3 h-3 mr-1" />
            Served
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800 border border-green-300">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </span>
        );
      case "cancelled":
      case "rejected":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3 h-3 mr-1" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };


  const getElapsedMinutes = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  };

  if (loading && orders.length === 0) {
    return <Loading text="Loading orders..." />;
  }

  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const readyCount = orders.filter((o) => o.status === "ready").length;

  const kanbanColumns = [
    {
      id: "pending",
      title: "Pending Verification",
      badgeColor: "bg-amber-100 text-amber-800 border-amber-300",
      headerBg: "bg-amber-500",
      borderTop: "border-t-4 border-amber-500",
      orders: orders.filter((o) => o.status === "pending" && matchesSearch(o, searchQuery)),
    },
    {
      id: "accepted",
      title: "To Cook / Kitchen",
      badgeColor: "bg-blue-100 text-blue-800 border-blue-300",
      headerBg: "bg-blue-600",
      borderTop: "border-t-4 border-blue-600",
      orders: orders.filter((o) => o.status === "accepted" && matchesSearch(o, searchQuery)),
    },
    {
      id: "preparing",
      title: "Cooking in Kitchen",
      badgeColor: "bg-orange-100 text-orange-800 border-orange-300",
      headerBg: "bg-orange-600",
      borderTop: "border-t-4 border-orange-600",
      orders: orders.filter((o) => o.status === "preparing" && matchesSearch(o, searchQuery)),
    },
    {
      id: "ready",
      title: "Ready & Served",
      badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
      headerBg: "bg-emerald-600",
      borderTop: "border-t-4 border-emerald-600",
      orders: orders.filter((o) => (o.status === "ready" || o.status === "served") && matchesSearch(o, searchQuery)),
    },
  ];

  return (
    <div className="space-y-6">
      {ordersError && (
        <div className="flex items-center justify-between p-4 bg-rose-50 border border-rose-200 rounded-xl">
          <div className="text-sm text-rose-700 font-medium">
            {ordersError}
          </div>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Live Orders Hub</h2>
          <p className="text-sm text-slate-500">
            Real-time multi-stage pipeline, waiter confirmation, and cashier settlement
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {readyCount > 0 && (
            <Badge variant="warning" className="text-xs px-2.5 py-1 font-bold">
              🔔 {readyCount} Ready
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="warning" className="text-xs px-2.5 py-1 animate-pulse font-bold">
              ⚡ {pendingCount} Pending
            </Badge>
          )}

          {/* Create New Order Button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Order</span>
          </button>

          {/* Dual View Mode Toggle */}
          <div className="flex items-center bg-white/90 p-1 rounded-xl border border-slate-200/80 shadow-2xs">
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "kanban"
                  ? "bg-white text-orange-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Ticket Board</span>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "list"
                  ? "bg-white text-orange-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Data List</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search and Real-time Status Controls Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Live Filter Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search orders by customer, phone, order #, table, or dish..."
            className="w-full pl-9 pr-8 py-2 bg-white/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 shadow-2xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Real-time indicator */}
        <div className="flex items-center space-x-2 text-xs font-medium text-emerald-800 bg-white/90 border border-emerald-200/80 px-3 py-1.5 rounded-lg shadow-2xs w-fit">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span>Live Realtime Sync • Waiter confirmation active</span>
        </div>
      </div>

      {viewMode === "kanban" ? (
        /* ================================================================ */
        /* KANBAN TICKET BOARD VIEW (Inspired by Reference Screens 3-5)      */
        /* ================================================================ */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {kanbanColumns.map((col) => (
            <div
              key={col.id}
              className="bg-white/60 rounded-2xl border border-slate-200/80 p-3 space-y-3 shadow-xs"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between px-1 py-1">
                <div className="flex items-center space-x-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.headerBg}`} />
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                    {col.title}
                  </h3>
                </div>
                <span
                  className={`text-xs font-black px-2 py-0.5 rounded-full border ${col.badgeColor}`}
                >
                  {col.orders.length}
                </span>
              </div>

              {/* Order Cards */}
              {col.orders.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs bg-white/40 rounded-xl border border-dashed border-slate-300/60">
                  No active tickets
                </div>
              ) : (
                <div className="space-y-3">
                  {col.orders.map((order) => {
                    const elapsed = getElapsedMinutes(order.created_at);
                    return (
                      <div
                        key={order.id}
                        className={`bg-white/95 rounded-xl border border-slate-200/90 p-3.5 shadow-xs transition-all hover:shadow-md hover:bg-white ${col.borderTop}`}
                      >
                        {/* Top Bar: Table & Elapsed */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-black text-xs px-2.5 py-0.5 rounded-md bg-slate-900 text-white">
                            {order.order_type === "counter"
                              ? "Takeaway"
                              : `Table ${order.table_number || "QR"}`}
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium">
                            ⏱ {elapsed}
                          </span>
                        </div>

                        {/* Order Number & Price */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono font-bold text-xs text-slate-800">
                            #{order.order_number}
                          </span>
                          <span className="font-black text-sm text-slate-900">
                            {formatCurrency(order.total)}
                          </span>
                        </div>

                        {/* Customer Phone if present */}
                        {order.customer_phone && (
                          <p className="text-[11px] font-mono text-slate-500 mb-2 truncate">
                            📞 {order.customer_phone}
                          </p>
                        )}

                        {/* Items Checklist */}
                        <div className="bg-slate-50 rounded-lg p-2.5 text-xs space-y-1 my-2 border border-slate-100">
                          {order.items?.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-slate-700 text-[11px]"
                            >
                              <span className="truncate pr-1">
                                <span className="font-bold text-orange-600 mr-1.5">
                                  {item.quantity}x
                                </span>
                                {item.name}
                              </span>
                            </div>
                          ))}
                          {order.customer_notes && (
                            <p className="text-[10px] text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 mt-1 truncate">
                              💬 {order.customer_notes}
                            </p>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-2 space-y-1.5 border-t border-slate-100">
                          {col.id === "pending" && canConfirmOrder && (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleStatusUpdate(order.id, "accepted")}
                                className="flex-1 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Verify & Accept</span>
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setShowRejectModal(true);
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                                title="Reject order"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          )}

                          {col.id === "accepted" && canUpdateKitchenStatus && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "preparing")}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                            >
                              <ChefHat className="w-3.5 h-3.5" />
                              <span>Start Cooking</span>
                            </button>
                          )}

                          {col.id === "preparing" && canUpdateKitchenStatus && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "ready")}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>Mark Ready to Serve</span>
                            </button>
                          )}

                          {col.id === "ready" && (
                            <div className="space-y-1.5 w-full">
                              {order.status === "ready" && canMarkServed && (
                                <button
                                  onClick={() => handleStatusUpdate(order.id, "served")}
                                  className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                                >
                                  <UtensilsCrossed className="w-3.5 h-3.5" />
                                  <span>Mark as Served</span>
                                </button>
                              )}

                              {order.status === "served" && (
                                <div className="space-y-1">
                                  <div className="w-full py-1.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    <span>Served to Table</span>
                                  </div>
                                  {order.payment_method === "cash" && (
                                    <div className="w-full py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-[11px] font-bold flex items-center justify-center space-x-1">
                                      <span>💵 Guest opted for Cash Payment</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {canSettleBill && (
                                <button
                                  onClick={() => setSettleOrder(order)}
                                  className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                  <span>Settle Bill & Free Table</span>
                                </button>
                              )}
                            </div>
                          )}

                          {/* Secondary Utilities */}
                          <div className="flex items-center justify-between text-[11px] pt-1 text-slate-400">
                            <button
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowDetailsModal(true);
                              }}
                              className="hover:text-slate-800 underline"
                            >
                              Details
                            </button>
                            <button
                              onClick={() => handlePrintKOT(order)}
                              className="hover:text-slate-800 flex items-center space-x-0.5"
                            >
                              <Printer className="w-3 h-3" />
                              <span>KOT ({order.kot_print_count || 0})</span>
                            </button>
                            {(canVoidOrder || canVoidSettledBill) && (
                              <button
                                onClick={() => setVoidOrder(order)}
                                className="hover:text-red-600"
                              >
                                Void PIN
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ================================================================ */
        /* DATA TABLE / LIST VIEW                                           */
        /* ================================================================ */
        <div className="space-y-4">
          {/* Status Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All" },
              { id: "pending", label: "Pending", count: pendingCount },
              { id: "confirmed", label: "Confirmed", count: orders.filter((o) => o.status === "accepted").length },
              { id: "in_process", label: "In Process", count: orders.filter((o) => o.status === "preparing" || o.status === "ready" || o.status === "served").length },
              { id: "completed", label: "Completed", count: orders.filter((o) => o.status === "completed").length },
              { id: "cancelled", label: "Cancelled", count: orders.filter((o) => o.status === "cancelled" || o.status === "rejected").length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-4 py-2 rounded-xl font-bold text-xs transition-all ${
                  statusFilter === tab.id
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white/90 text-slate-600 hover:bg-white border border-slate-200 shadow-2xs"
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      statusFilter === tab.id
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Production-grade POS Orders Table */}
          {filteredOrders.length === 0 ? (
            <Card className="text-center py-12 bg-white/90 border border-slate-200">
              <Package className="w-16 h-16 text-slate-300 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-bold text-slate-800 mb-1">
                No Orders Found
              </h3>
              <p className="text-slate-500 text-xs">
                No orders match the selected filter ({statusFilter}) or search term.
              </p>
            </Card>
          ) : (
            <div className="bg-white/95 rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">SL.</th>
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Table No</th>
                      <th className="py-3 px-4">Waiter</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Order Type</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Order Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrders.map((order, idx) => {
                      const sl = String(idx + 1).padStart(5, "0");
                      const isTakeaway = order.order_type === "takeaway" || order.order_type === "counter";
                      const waiter = order.waiter_name || order.accepted_by_name || "-";
                      const customer = order.customer_name?.trim() || "Walking Customer";
                      const formattedDate = formatOrderDate(order.created_at);

                      return (
                        <tr
                          key={order.id}
                          className="hover:bg-slate-50/70 transition-colors"
                        >
                          {/* SL. */}
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-400">
                            {sl}
                          </td>

                          {/* Order ID */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-extrabold text-slate-900">
                                #{order.order_number}
                              </span>
                              {order.invoice_number && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                                  {order.invoice_number}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Table No */}
                          <td className="py-3.5 px-4">
                            {isTakeaway ? (
                              <span className="text-slate-400 font-bold text-sm">-</span>
                            ) : (
                              <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                {order.table_number ? `Table ${order.table_number}` : "-"}
                              </span>
                            )}
                          </td>

                          {/* Waiter */}
                          <td className="py-3.5 px-4">
                            {waiter === "-" ? (
                              <span className="text-slate-400 italic text-[11px]">- (Pending)</span>
                            ) : (
                              <span className="font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-200/80">
                                {waiter}
                              </span>
                            )}
                          </td>

                          {/* Customer */}
                          <td className="py-3.5 px-4">
                            <div>
                              <p className="font-bold text-slate-800 truncate max-w-[140px]">
                                {customer}
                              </p>
                              {order.customer_phone && (
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {order.customer_phone}
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Order Type */}
                          <td className="py-3.5 px-4">
                            {isTakeaway ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                🛍️ Takeaway
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                🍽️ Dine in
                              </span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="py-3.5 px-4 text-slate-500 font-medium whitespace-nowrap">
                            {formattedDate}
                          </td>

                          {/* Amount */}
                          <td className="py-3.5 px-4 font-black text-slate-900 whitespace-nowrap">
                            {formatCurrency(order.total)}
                          </td>

                          {/* Order Status */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {getOrderStatusBadge(order.status)}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {order.status === "pending" && canConfirmOrder && (
                                <button
                                  onClick={() => handleStatusUpdate(order.id, "accepted")}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors"
                                >
                                  Confirm
                                </button>
                              )}
                              {order.status === "accepted" && canUpdateKitchenStatus && (
                                <button
                                  onClick={() => handleStatusUpdate(order.id, "preparing")}
                                  className="px-2.5 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors"
                                >
                                  Cook
                                </button>
                              )}
                              {order.status === "preparing" && canUpdateKitchenStatus && (
                                <button
                                  onClick={() => handleStatusUpdate(order.id, "ready")}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors"
                                >
                                  Ready
                                </button>
                              )}
                              {order.status === "ready" && canMarkServed && (
                                <button
                                  onClick={() => handleStatusUpdate(order.id, "served")}
                                  className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center gap-1"
                                >
                                  <UtensilsCrossed className="w-3 h-3" />
                                  Mark Served
                                </button>
                              )}
                              {canSettleBill &&
                                (order.status === "ready" ||
                                  order.status === "served" ||
                                  order.status === "accepted" ||
                                  order.status === "preparing") && (
                                  <button
                                    onClick={() => setSettleOrder(order)}
                                    className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors"
                                  >
                                    Settle
                                  </button>
                                )}
                              <button
                                onClick={() => handleViewDetails(order)}
                                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
                                title="View Details"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handlePrintKOT(order)}
                                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
                                title="Print KOT"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {order.status === "completed" && (
                                <button
                                  onClick={() => setReceiptOrder(order)}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-emerald-200"
                                  title="Print Receipt"
                                >
                                  <Receipt className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(canVoidOrder || canVoidSettledBill) && order.status !== "cancelled" && (
                                <button
                                  onClick={() => setVoidOrder(order)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-200 text-[10px] font-bold"
                                  title="Void with Manager PIN"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Details Modal */}
      <OrderDetailsModal
        isOpen={showDetailsModal}
        order={selectedOrder}
        onClose={() => {
          setShowDetailsModal(false);
          setSelectedOrder(null);
        }}
        onVoid={(order) => {
          setVoidOrder(order);
        }}
      />

      {/* Reject / Cancel Order Modal */}
      <RejectOrderModal
        isOpen={showRejectModal}
        order={selectedOrder}
        onClose={() => {
          setShowRejectModal(false);
          setSelectedOrder(null);
        }}
        onReject={handleStatusUpdate}
      />

      {/* KOT Receipt Thermal Print Preview */}
      {printOrder && (
        <KOTReceipt
          order={printOrder}
          restaurantName={restaurantName}
          restaurantLogo={restaurantData?.logo_url || undefined}
          onClose={() => setPrintOrder(null)}
          onPrint={async () => {
            await recordKOTPrint(printOrder.id);
          }}
        />
      )}

      {/* Settle Bill Modal */}
      {settleOrder && (
        <SettleBillModal
          order={settleOrder}
          onClose={() => setSettleOrder(null)}
          onSettled={(result: BillSettlementResult) => {
            const updated: Order = {
              ...settleOrder,
              status: "completed",
              invoice_number: result.invoice_number,
              tendered_amount: result.tendered_amount,
              change_amount: result.change_amount,
              payment_method: result.payment_method,
              completed_at: result.completed_at || result.settled_at,
            };
            setSettleOrder(null);
            setOrders((prev) =>
              prev.map((o) => (o.id === updated.id ? updated : o))
            );
            setReceiptOrder(updated);
          }}
        />
      )}

      {/* Bill Receipt Modal */}
      {receiptOrder && (
        <BillReceiptModal
          order={receiptOrder}
          restaurant={restaurantData}
          onClose={() => setReceiptOrder(null)}
        />
      )}

      {/* Void Order Modal */}
      {voidOrder && (
        <VoidOrderModal
          order={voidOrder}
          onClose={() => setVoidOrder(null)}
          onVoided={(result: VoidOrderResult) => {
            const updated: Order = {
              ...voidOrder,
              status: "cancelled",
              cancellation_reason: `Manager Void: Order #${result.order_number}`,
              cancelled_at: result.voided_at,
            };
            setVoidOrder(null);
            setShowDetailsModal(false);
            setOrders((prev) =>
              prev.map((o) => (o.id === updated.id ? updated : o))
            );
          }}
        />
      )}

      {/* Staff POS Create Order Modal */}
      {showCreateModal && (
        <CreateOrderModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onOrderCreated={() => {
            // Real-time channel will sync orders
          }}
        />
      )}
    </div>
  );
};

// Order Details Modal Component with Timeline
interface OrderDetailsModalProps {
  isOpen: boolean;
  order: Order | null;
  onClose: () => void;
  onVoid?: (order: Order) => void;
}

const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  isOpen,
  order,
  onClose,
  onVoid,
}) => {
  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Order #${order.order_number}`}
      size="lg"
    >
      <div className="space-y-6">
        {/* Status Timeline */}
        <div className="bg-bg-subtle rounded-xl p-4 border border-border">
          <h4 className="font-bold text-xs text-text uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-accent" />
            <span>Order Lifecycle & Verification</span>
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-white rounded-lg border border-border/50">
              <span className="text-[10px] text-text-secondary block font-semibold">
                Placed At
              </span>
              <span className="font-medium text-text">
                {formatDateTime(order.created_at)}
              </span>
            </div>

            {order.accepted_at && (
              <div className="p-2 bg-white rounded-lg border border-border/50">
                <span className="text-[10px] text-text-secondary block font-semibold">
                  Waiter Verified
                </span>
                <span className="font-medium text-text">
                  {formatDateTime(order.accepted_at)}
                </span>
              </div>
            )}

            {order.preparing_at && (
              <div className="p-2 bg-white rounded-lg border border-border/50">
                <span className="text-[10px] text-text-secondary block font-semibold">
                  Cooking Started
                </span>
                <span className="font-medium text-text">
                  {formatDateTime(order.preparing_at)}
                </span>
              </div>
            )}

            {order.ready_at && (
              <div className="p-2 bg-white rounded-lg border border-border/50">
                <span className="text-[10px] text-text-secondary block font-semibold">
                  Ready to Serve
                </span>
                <span className="font-medium text-text">
                  {formatDateTime(order.ready_at)}
                </span>
              </div>
            )}

            {order.served_at && (
              <div className="p-2 bg-white rounded-lg border border-border/50">
                <span className="text-[10px] text-text-secondary block font-semibold">
                  Served to Table
                </span>
                <span className="font-medium text-text">
                  {formatDateTime(order.served_at)}
                </span>
              </div>
            )}

            {order.completed_at && (
              <div className="p-2 bg-white rounded-lg border border-border/50">
                <span className="text-[10px] text-text-secondary block font-semibold">
                  Served & Paid
                </span>
                <span className="font-medium text-text">
                  {formatDateTime(order.completed_at)}
                </span>
              </div>
            )}

            {order.cancelled_at && (
              <div className="p-2 bg-red-50 rounded-lg border border-red-200">
                <span className="text-[10px] text-red-600 block font-semibold">
                  Cancelled / Rejected
                </span>
                <span className="font-medium text-red-800">
                  {formatDateTime(order.cancelled_at)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Customer Information */}
        <div className="bg-bg-subtle rounded-lg p-4 space-y-2">
          <h4 className="font-semibold text-text mb-3">Customer Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-text-secondary">Name</p>
              <p className="font-medium text-text">
                {order.customer_name || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-text-secondary">Phone</p>
              <p className="font-medium text-text">
                {order.customer_phone || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-text-secondary">Order Type</p>
              <p className="font-bold text-text">
                {order.order_type === "takeaway" || order.order_type === "counter"
                  ? "Takeaway / Parcel"
                  : "Dine-in"}
              </p>
            </div>
            <div>
              <p className="text-text-secondary">Table Number</p>
              <p className="font-bold text-text">
                {order.order_type === "takeaway" || order.order_type === "counter"
                  ? "-"
                  : order.table_number || "-"}
              </p>
            </div>
            <div>
              <p className="text-text-secondary">Assigned Waiter</p>
              <p className="font-bold text-orange-600">
                {order.waiter_name || order.accepted_by_name || "Pending Confirmation"}
              </p>
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div>
          <h4 className="font-semibold text-text mb-3">Order Items</h4>
          <div className="space-y-2">
            {order.items?.map((item: OrderItem, index: number) => (
              <div
                key={index}
                className="flex items-start justify-between p-3 bg-bg-subtle rounded-lg text-sm"
              >
                <div className="flex-1">
                  <p className="font-medium text-text">
                    {item.quantity}x {item.name}
                  </p>
                  {item.selected_size && (
                    <p className="text-xs text-text-secondary">
                      Size: {item.selected_size.name}
                    </p>
                  )}
                  {item.selected_addons && item.selected_addons.length > 0 && (
                    <p className="text-xs text-text-secondary">
                      Add-ons: {item.selected_addons.map((a) => a.name).join(", ")}
                    </p>
                  )}
                </div>
                <p className="font-semibold text-text">
                  {formatCurrency(item.item_total || 0)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing */}
        <div className="border-t border-border pt-4 space-y-2 text-sm">
          <div className="flex justify-between text-text-secondary">
            <span>Subtotal</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-text-secondary">
            <span>VAT (5%)</span>
            <span>{formatCurrency(order.tax)}</span>
          </div>
          {order.discount && order.discount > 0 && (
            <div className="flex justify-between text-success">
              <span>Discount</span>
              <span>-{formatCurrency(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-text pt-2 border-t border-border">
            <span>Total</span>
            <span>{formatCurrency(order.total)}</span>
          </div>
        </div>

        {/* Billing & Settlement Details */}
        {order.invoice_number && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-emerald-200">
              <span className="font-bold text-emerald-950">Fiscal Invoice Number</span>
              <span className="font-mono font-bold text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300">
                {order.invoice_number}
              </span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>Payment Mode</span>
              <span className="font-bold uppercase">{order.payment_method || "CASH"}</span>
            </div>
            {order.tendered_amount !== undefined && order.tendered_amount !== null && (
              <>
                <div className="flex justify-between text-gray-700">
                  <span>Cash Received / Tendered</span>
                  <span className="font-bold">{formatCurrency(order.tendered_amount)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-800 pt-1 border-t border-emerald-200/60">
                  <span>Change Returned</span>
                  <span>{formatCurrency(order.change_amount || 0)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Notes */}
        {order.customer_notes && (
          <div className="bg-accent-secondary/10 border border-accent-secondary/20 rounded-lg p-4">
            <h4 className="font-semibold text-text mb-2">Customer Notes</h4>
            <p className="text-text-secondary text-sm">
              {order.customer_notes}
            </p>
          </div>
        )}

        {/* Cancellation/Rejection Details */}
        {(order.cancellation_reason || order.rejection_reason) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h4 className="font-semibold text-red-900 mb-1">
              {order.status === "rejected" ? "Rejection Reason" : "Cancellation Reason"}
            </h4>
            <p className="text-red-700 text-sm">
              {order.rejection_reason || order.cancellation_reason}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {onVoid && order.status !== "cancelled" && order.status !== "rejected" && (
            <Button
              variant="outline"
              onClick={() => onVoid(order)}
              className="text-red-600 border-red-200 hover:bg-red-50 flex items-center justify-center gap-1.5"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Void Order</span>
            </Button>
          )}
          <Button onClick={onClose} fullWidth>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// Reject / Cancel Order Modal
interface RejectOrderModalProps {
  isOpen: boolean;
  order: Order | null;
  onClose: () => void;
  onReject: (orderId: string, status: Order["status"], notes?: string) => void;
}

const RejectOrderModal: React.FC<RejectOrderModalProps> = ({
  isOpen,
  order,
  onClose,
  onReject,
}) => {
  const [reason, setReason] = useState("");
  const isPending = order?.status === "pending";

  const handleAction = (status: "cancelled" | "rejected") => {
    if (!order) return;
    onReject(order.id, status, reason);
    onClose();
    setReason("");
  };

  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isPending ? "Reject / Cancel Order" : "Cancel Order"}
      size="md"
    >
      <div className="space-y-4">
        <Alert
          type="warning"
          message={
            isPending
              ? "Are you sure you want to reject this incoming order? The customer will be notified."
              : "Are you sure you want to cancel this order? This action cannot be undone."
          }
        />

        <Textarea
          label="Reason (Optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="E.g., Out of ingredients, Kitchen closed, Customer requested, etc."
          rows={3}
        />

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} fullWidth>
            Back
          </Button>
          {isPending ? (
            <Button
              variant="danger"
              onClick={() => handleAction("rejected")}
              fullWidth
            >
              Reject Order
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => handleAction("cancelled")}
              fullWidth
            >
              Cancel Order
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default Orders;
