import React, { useEffect, useState, useRef } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  Package,
  Phone,
  User,
  MessageSquare,
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
import type { VoidOrderResult } from "../../services/auditService";
import type { Order, OrderItem, Restaurant } from "../../config/supabase";
import { supabase } from "../../config/supabase";
import { formatDateTime, formatCurrency, playSound } from "../../utils/helpers";

const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [settleOrder, setSettleOrder] = useState<Order | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [voidOrder, setVoidOrder] = useState<Order | null>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [restaurantName, setRestaurantName] = useState("Restaurant");
  const [restaurantData, setRestaurantData] = useState<Restaurant | null>(null);
  const previousOrdersRef = useRef<Order[]>([]);

  useEffect(() => {
    // Get restaurant ID from local storage
    const currentRestaurant = localStorage.getItem("current_restaurant");
    if (!currentRestaurant) {
      setLoading(false);
      return;
    }

    const { id: restaurantId, name } = JSON.parse(currentRestaurant);
    if (name) setRestaurantName(name);

    // Fetch full restaurant details (VAT BIN, trade license, etc.)
    supabase
      .from("restaurants")
      .select("*")
      .eq("id", restaurantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setRestaurantData(data as Restaurant);
      });

    // Subscribe to real-time orders
    const subscription = subscribeToOrders(restaurantId, (newOrders) => {
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
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Filter and sort orders
  const filteredOrders = orders
    .filter((order) => {
      if (statusFilter === "all") return true;
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

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      "warning" | "accent-secondary" | "success" | "neutral" | "error"
    > = {
      pending: "warning",
      accepted: "accent-secondary",
      preparing: "accent-secondary",
      ready: "warning",
      completed: "success",
      cancelled: "neutral",
      rejected: "error",
    };
    return (
      <Badge variant={variants[status] || "neutral"}>
        {status === "ready" ? "ready to serve" : status}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-warning" />;
      case "accepted":
        return <Check className="w-5 h-5 text-accent-secondary" />;
      case "preparing":
        return <UtensilsCrossed className="w-5 h-5 text-accent" />;
      case "ready":
        return <Bell className="w-5 h-5 text-warning" />;
      case "completed":
        return <CheckCircle className="w-5 h-5 text-success" />;
      case "cancelled":
      case "rejected":
        return <XCircle className="w-5 h-5 text-error" />;
      default:
        return <Clock className="w-5 h-5 text-text-secondary" />;
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

  if (loading) {
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
      orders: orders.filter((o) => o.status === "pending"),
    },
    {
      id: "accepted",
      title: "To Cook / Kitchen",
      badgeColor: "bg-blue-100 text-blue-800 border-blue-300",
      headerBg: "bg-blue-600",
      borderTop: "border-t-4 border-blue-600",
      orders: orders.filter((o) => o.status === "accepted"),
    },
    {
      id: "preparing",
      title: "Cooking in Kitchen",
      badgeColor: "bg-orange-100 text-orange-800 border-orange-300",
      headerBg: "bg-orange-600",
      borderTop: "border-t-4 border-orange-600",
      orders: orders.filter((o) => o.status === "preparing"),
    },
    {
      id: "ready",
      title: "Ready to Serve",
      badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
      headerBg: "bg-emerald-600",
      borderTop: "border-t-4 border-emerald-600",
      orders: orders.filter((o) => o.status === "ready"),
    },
  ];

  return (
    <div className="space-y-6">
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

          {/* Dual View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
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

      {/* Real-time indicator */}
      <div className="flex items-center space-x-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg w-fit">
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <span>Live Realtime Sync • Waiter confirmation active</span>
      </div>

      {viewMode === "kanban" ? (
        /* ================================================================ */
        /* KANBAN TICKET BOARD VIEW (Inspired by Reference Screens 3-5)      */
        /* ================================================================ */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {kanbanColumns.map((col) => (
            <div
              key={col.id}
              className="bg-slate-100/80 rounded-2xl border border-slate-200 p-3 space-y-3"
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
                <div className="text-center py-10 text-slate-400 text-xs bg-white/50 rounded-xl border border-dashed border-slate-200">
                  No active tickets
                </div>
              ) : (
                <div className="space-y-3">
                  {col.orders.map((order) => {
                    const elapsed = getElapsedMinutes(order.created_at);
                    return (
                      <div
                        key={order.id}
                        className={`bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-xs transition-all hover:shadow-md ${col.borderTop}`}
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
                          {col.id === "pending" && (
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

                          {col.id === "accepted" && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "preparing")}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                            >
                              <ChefHat className="w-3.5 h-3.5" />
                              <span>Start Cooking</span>
                            </button>
                          )}

                          {col.id === "preparing" && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, "ready")}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>Mark Ready to Serve</span>
                            </button>
                          )}

                          {col.id === "ready" && (
                            <button
                              onClick={() => setSettleOrder(order)}
                              className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center justify-center space-x-1"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              <span>Settle Bill & Free Table</span>
                            </button>
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
                            <button
                              onClick={() => setVoidOrder(order)}
                              className="hover:text-red-600"
                            >
                              Void PIN
                            </button>
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
          { id: "accepted", label: "Accepted" },
          { id: "preparing", label: "Preparing" },
          { id: "ready", label: "Ready to Serve", count: readyCount },
          { id: "completed", label: "Completed" },
          { id: "cancelled", label: "Cancelled / Rejected" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-2 rounded-lg font-medium text-xs transition-colors ${
              statusFilter === tab.id
                ? "bg-accent text-white shadow-sm"
                : "bg-bg-subtle text-text-secondary hover:bg-border"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <Card className="text-center py-12">
          <Package className="w-16 h-16 text-text-secondary mx-auto mb-4 opacity-50" />
          <h3 className="text-xl font-semibold text-text mb-2">
            No Orders Found
          </h3>
          <p className="text-text-secondary text-sm">
            No orders match the selected filter ({statusFilter}).
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredOrders.map((order) => (
            <Card
              key={order.id}
              className={`hover:shadow-lg transition-shadow ${
                order.status === "pending"
                  ? "border-l-4 border-l-warning"
                  : order.status === "ready"
                  ? "border-l-4 border-l-success"
                  : ""
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Order Info */}
                <div className="flex-1 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(order.status)}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-text">
                            Order #{order.order_number}
                          </h3>
                          {order.invoice_number && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                              {order.invoice_number}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary">
                          {formatDateTime(order.created_at)}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(order.status)}
                  </div>

                  {/* Details */}
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center space-x-2 text-text-secondary">
                      <Package className="w-4 h-4" />
                      <span>
                        {order.order_type === "counter"
                          ? "Takeaway / Counter"
                          : `Table: ${order.table_number || "Unassigned"}`}
                      </span>
                    </div>
                    {order.customer_phone && (
                      <div className="flex items-center space-x-2 text-text-secondary">
                        <Phone className="w-4 h-4" />
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="text-accent hover:underline font-mono"
                        >
                          {order.customer_phone}
                        </a>
                      </div>
                    )}
                    {order.customer_name && (
                      <div className="flex items-center space-x-2 text-text-secondary">
                        <User className="w-4 h-4" />
                        <span>{order.customer_name}</span>
                      </div>
                    )}
                    <div className="flex items-center space-x-2 text-text-secondary">
                      <span className="font-semibold text-text">
                        {order.items?.length || 0} items
                      </span>
                      <span>•</span>
                      <span className="font-bold text-text text-lg">
                        {formatCurrency(order.total)}
                      </span>
                    </div>
                  </div>

                  {/* Customer Notes */}
                  {order.customer_notes && (
                    <div className="flex items-start space-x-2 text-xs bg-bg-subtle rounded-lg p-2.5">
                      <MessageSquare className="w-4 h-4 text-accent-secondary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-text">Special Instructions:</p>
                        <p className="text-text-secondary">
                          {order.customer_notes}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Rejection / Cancellation Notes */}
                  {(order.cancellation_reason || order.rejection_reason) && (
                    <div className="text-xs text-error bg-red-50 p-2 rounded-lg">
                      <span className="font-bold">Reason: </span>
                      {order.cancellation_reason || order.rejection_reason}
                    </div>
                  )}
                </div>

                {/* State Machine Action Controls */}
                <div className="flex lg:flex-col gap-2 lg:min-w-[170px]">
                  <div className="flex items-center gap-1.5 w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      fullWidth
                      onClick={() => handleViewDetails(order)}
                    >
                      View Details
                    </Button>
                    <button
                      onClick={() => handlePrintKOT(order)}
                      className="p-2 border border-border hover:border-accent hover:text-accent rounded-lg text-text-secondary transition-colors"
                      title="Print KOT Ticket"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Pending: Waiter Verify & Confirm */}
                  {order.status === "pending" && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        className="bg-accent text-white hover:bg-accent-hover font-bold shadow-sm"
                        onClick={() => handleStatusUpdate(order.id, "accepted")}
                      >
                        ✓ Verify & Confirm
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        className="text-error border-error/30 hover:bg-error/10"
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowRejectModal(true);
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {/* Accepted: Kitchen Start Cooking */}
                  {order.status === "accepted" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        className="font-bold"
                        onClick={() => handleStatusUpdate(order.id, "preparing")}
                      >
                        🍳 Start Cooking
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowRejectModal(true);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}

                  {/* Preparing: Kitchen Mark Ready */}
                  {order.status === "preparing" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        className="font-bold bg-amber-500 text-white hover:bg-amber-600"
                        onClick={() => handleStatusUpdate(order.id, "ready")}
                      >
                        🔔 Mark Ready
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowRejectModal(true);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}

                  {/* Ready: Settle Bill & Complete */}
                  {order.status === "ready" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        className="font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-1.5 shadow-sm"
                        onClick={() => setSettleOrder(order)}
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>Settle Bill & Complete</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowRejectModal(true);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}

                  {/* Completed: Print Customer Bill Receipt or Void Bill */}
                  {order.status === "completed" && (
                    <div className="space-y-1.5 w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        fullWidth
                        className="font-bold text-emerald-700 border-emerald-300 hover:bg-emerald-50 flex items-center justify-center gap-1.5"
                        onClick={() => setReceiptOrder(order)}
                      >
                        <Receipt className="w-4 h-4" />
                        <span>Print Bill Receipt</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        className="text-[11px] text-red-600 hover:bg-red-50 flex items-center justify-center gap-1"
                        onClick={() => setVoidOrder(order)}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Void Bill (Manager PIN)</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
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
              <p className="font-medium text-text capitalize">
                {order.order_type}
              </p>
            </div>
            {order.table_number && (
              <div>
                <p className="text-text-secondary">Table Number</p>
                <p className="font-medium text-text">{order.table_number}</p>
              </div>
            )}
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
