import React, { useEffect, useState, useRef } from "react";
import {
  UtensilsCrossed,
  Clock,
  Bell,
  CheckCircle,
  Printer,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Package,
  Search,
  X,
} from "lucide-react";
import {
  subscribeToKitchenOrders,
  updateOrderStatus,
  recordKOTPrint,
} from "../../services/restaurantService";
import type { Order, OrderItem } from "../../config/supabase";
import { playSound } from "../../utils/helpers";
import { KOTReceipt } from "../../components/restaurant/KOTReceipt";
import { Loading, Button } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

const KitchenKDS: React.FC = () => {
  const {
    restaurant: authRestaurant,
    restaurantId: authRestaurantId,
    user,
    loading: authLoading,
  } = useAuth();
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState(authRestaurant?.name || "Kitchen");
  const [orderTypeFilter, setOrderTypeFilter] = useState<"all" | "table" | "counter">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const prevOrdersCountRef = useRef<number>(0);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
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

    if (!targetRestaurantId || !user) {
      setLoading(false);
      return;
    }

    if (targetName) setRestaurantName(targetName);

    // Subscribe to active kitchen orders
    const subscription = subscribeToKitchenOrders(targetRestaurantId, (orders) => {
      // Check if new tickets arrived
      const newAcceptedCount = orders.filter((o) => o.status === "accepted").length;
      if (soundEnabled && newAcceptedCount > prevOrdersCountRef.current && prevOrdersCountRef.current !== 0) {
        playSound("notification");
      }
      prevOrdersCountRef.current = newAcceptedCount;

      setKitchenOrders(orders);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [soundEnabled, authLoading, user?.id, authRestaurantId, authRestaurant?.id]);

  // Fullscreen mode handler
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: Order["status"]) => {
    const res = await updateOrderStatus(orderId, newStatus);
    if (!res.success) {
      alert(res.error || "Failed to update order status");
    }
  };

  const handlePrintKOT = async (order: Order) => {
    setPrintOrder(order);
    await recordKOTPrint(order.id);
  };

  // Filter orders by order_type & live search query
  const filteredOrders = kitchenOrders.filter((order) => {
    if (orderTypeFilter === "table" && !(order.order_type === "table" || order.order_type === "qr")) return false;
    if (orderTypeFilter === "counter" && order.order_type !== "counter") return false;

    if (searchQuery.trim()) {
      const term = searchQuery.trim().toLowerCase();
      const orderNum = (order.order_number || "").toLowerCase();
      const tableNum = (order.table_number || "").toLowerCase();
      const matchesDish =
        Array.isArray(order.items) &&
        order.items.some(
          (it: any) =>
            (it.name && it.name.toLowerCase().includes(term)) ||
            (it.name_bn && it.name_bn.toLowerCase().includes(term))
        );
      if (!orderNum.includes(term) && !tableNum.includes(term) && !matchesDish) {
        return false;
      }
    }
    return true;
  });

  const queueOrders = filteredOrders.filter((o) => o.status === "accepted");
  const preparingOrders = filteredOrders.filter((o) => o.status === "preparing");
  const readyOrders = filteredOrders.filter((o) => o.status === "ready");

  const getElapsedMinutes = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    return Math.max(0, diff);
  };

  if (loading) {
    return <Loading text="Loading kitchen display..." />;
  }

  return (
    <div className="space-y-4">
      {/* Top KDS Control Bar */}
      <div className="bg-gray-900 text-white p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center font-bold">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
              <span>{restaurantName} Kitchen Display</span>
              <span className="text-xs bg-green-500/20 text-green-400 font-bold px-2 py-0.5 rounded-full border border-green-500/30">
                LIVE
              </span>
            </h2>
            <p className="text-xs text-gray-400">
              Active tickets: {kitchenOrders.length} | To Cook: {queueOrders.length} | On Stove: {preparingOrders.length}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live Kitchen Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter table, order #, dish..."
              className="pl-8 pr-7 py-1.5 bg-gray-800 border border-gray-700 rounded-xl text-xs text-white placeholder-gray-400 focus:outline-none focus:border-accent w-40 sm:w-52"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Order Type Filter */}
          <div className="flex bg-gray-800 p-0.5 rounded-xl border border-gray-700 text-xs font-semibold">
            <button
              onClick={() => setOrderTypeFilter("all")}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                orderTypeFilter === "all" ? "bg-accent text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setOrderTypeFilter("table")}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                orderTypeFilter === "table" ? "bg-accent text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Dine-In
            </button>
            <button
              onClick={() => setOrderTypeFilter("counter")}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                orderTypeFilter === "counter" ? "bg-accent text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Takeaway
            </button>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl border transition-colors ${
              soundEnabled
                ? "bg-gray-800 text-accent border-gray-700 hover:bg-gray-700"
                : "bg-red-500/20 text-red-400 border-red-500/30"
            }`}
            title={soundEnabled ? "Mute audio alerts" : "Enable audio alerts"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-gray-800 text-gray-300 hover:text-white border border-gray-700 transition-colors"
            title="Toggle fullscreen monitor"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 3-Column Kitchen Kanban Queue */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* Column 1: Queue / To Cook (accepted) */}
        <div className="bg-gray-100 rounded-2xl p-4 border border-gray-200 space-y-3 min-h-[500px]">
          <div className="flex items-center justify-between pb-2 border-b border-gray-300">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <h3 className="font-extrabold text-sm text-gray-900 uppercase tracking-wide">
                To Cook / New Queue
              </h3>
            </div>
            <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-0.5 rounded-full border border-amber-300">
              {queueOrders.length}
            </span>
          </div>

          {queueOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs font-semibold">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No pending tickets to cook
            </div>
          ) : (
            <div className="space-y-3">
              {queueOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.accepted_at || order.created_at);
                const isOverdue = elapsed >= 15;
                const isWarning = elapsed >= 10 && elapsed < 15;

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-xl p-4 shadow-sm border-2 transition-all ${
                      isOverdue
                        ? "border-red-500 ring-2 ring-red-400/30"
                        : isWarning
                        ? "border-amber-400"
                        : "border-gray-200"
                    }`}
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-gray-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-gray-900">
                            #{order.order_number}
                          </span>
                          {order.kot_print_count && order.kot_print_count > 0 ? (
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono font-bold">
                              KOT #{order.kot_print_count}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs font-bold text-accent">
                          {order.table_number ? `TABLE: ${order.table_number}` : "TAKEAWAY"}
                        </p>
                      </div>

                      {/* Elapsed Timer */}
                      <div
                        className={`text-xs font-black px-2 py-1 rounded-lg flex items-center gap-1 ${
                          isOverdue
                            ? "bg-red-500 text-white animate-pulse"
                            : isWarning
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>{elapsed}m</span>
                      </div>
                    </div>

                    {/* Ticket Items */}
                    <div className="space-y-2 py-1 divide-y divide-gray-100 text-xs">
                      {order.items?.map((item: OrderItem, idx: number) => (
                        <div key={idx} className="pt-1.5 first:pt-0">
                          <div className="flex justify-between items-baseline font-bold text-gray-900">
                            <span>
                              <span className="text-accent text-sm mr-1 font-black">
                                {item.quantity}x
                              </span>
                              {item.name}
                            </span>
                          </div>
                          {item.selected_size && (
                            <p className="text-[11px] text-gray-500 pl-5">
                              Size: {item.selected_size.name}
                            </p>
                          )}
                          {item.selected_addons && item.selected_addons.length > 0 && (
                            <p className="text-[11px] text-gray-500 pl-5">
                              + {item.selected_addons.map((a) => a.name).join(", ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Special Instructions Box */}
                    {order.customer_notes && (
                      <div className="mt-2.5 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold text-amber-900">
                        ⚠️ NOTE: {order.customer_notes}
                      </div>
                    )}

                    {/* Card Actions */}
                    <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        className="bg-accent hover:bg-accent-hover text-white font-bold text-xs"
                        onClick={() => handleStatusChange(order.id, "preparing")}
                      >
                        🍳 Start Cooking
                      </Button>
                      <button
                        onClick={() => handlePrintKOT(order)}
                        className="p-2 border border-gray-300 hover:border-accent hover:text-accent rounded-lg text-gray-600 transition-colors"
                        title="Print Kitchen Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 2: In Preparation / Cooking (preparing) */}
        <div className="bg-amber-50/60 rounded-2xl p-4 border border-amber-200 space-y-3 min-h-[500px]">
          <div className="flex items-center justify-between pb-2 border-b border-amber-200">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-accent" />
              <h3 className="font-extrabold text-sm text-gray-900 uppercase tracking-wide">
                Cooking / On Stove
              </h3>
            </div>
            <span className="bg-amber-200 text-amber-900 text-xs font-black px-2.5 py-0.5 rounded-full">
              {preparingOrders.length}
            </span>
          </div>

          {preparingOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs font-semibold">
              <UtensilsCrossed className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nothing on the stove right now
            </div>
          ) : (
            <div className="space-y-3">
              {preparingOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.preparing_at || order.created_at);
                const isOverdue = elapsed >= 15;

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-xl p-4 shadow-sm border-2 transition-all ${
                      isOverdue
                        ? "border-red-500 ring-2 ring-red-400/30"
                        : "border-amber-300"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-gray-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-gray-900">
                            #{order.order_number}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-accent">
                          {order.table_number ? `TABLE: ${order.table_number}` : "TAKEAWAY"}
                        </p>
                      </div>

                      <div
                        className={`text-xs font-black px-2 py-1 rounded-lg flex items-center gap-1 ${
                          isOverdue
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>Cooking {elapsed}m</span>
                      </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2 py-1 divide-y divide-gray-100 text-xs">
                      {order.items?.map((item: OrderItem, idx: number) => (
                        <div key={idx} className="pt-1.5 first:pt-0">
                          <div className="flex justify-between items-baseline font-bold text-gray-900">
                            <span>
                              <span className="text-accent text-sm mr-1 font-black">
                                {item.quantity}x
                              </span>
                              {item.name}
                            </span>
                          </div>
                          {item.selected_size && (
                            <p className="text-[11px] text-gray-500 pl-5">
                              Size: {item.selected_size.name}
                            </p>
                          )}
                          {item.selected_addons && item.selected_addons.length > 0 && (
                            <p className="text-[11px] text-gray-500 pl-5">
                              + {item.selected_addons.map((a) => a.name).join(", ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    {order.customer_notes && (
                      <div className="mt-2.5 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold text-amber-900">
                        ⚠️ NOTE: {order.customer_notes}
                      </div>
                    )}

                    {/* Card Actions */}
                    <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1"
                        onClick={() => handleStatusChange(order.id, "ready")}
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>Mark Ready</span>
                      </Button>
                      <button
                        onClick={() => handlePrintKOT(order)}
                        className="p-2 border border-gray-300 hover:border-accent hover:text-accent rounded-lg text-gray-600 transition-colors"
                        title="Print Kitchen Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Column 3: Plated & Ready to Serve (ready) */}
        <div className="bg-green-50/60 rounded-2xl p-4 border border-green-200 space-y-3 min-h-[500px]">
          <div className="flex items-center justify-between pb-2 border-b border-green-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <h3 className="font-extrabold text-sm text-gray-900 uppercase tracking-wide">
                Ready to Serve
              </h3>
            </div>
            <span className="bg-green-200 text-green-900 text-xs font-black px-2.5 py-0.5 rounded-full">
              {readyOrders.length}
            </span>
          </div>

          {readyOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs font-semibold">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No orders waiting to be served
            </div>
          ) : (
            <div className="space-y-3">
              {readyOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-xl p-4 shadow-sm border-2 border-green-400"
                >
                  <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-gray-100">
                    <div>
                      <span className="font-black text-base text-gray-900">
                        #{order.order_number}
                      </span>
                      <p className="text-xs font-bold text-green-700">
                        {order.table_number ? `TABLE: ${order.table_number}` : "TAKEAWAY"}
                      </p>
                    </div>

                    <span className="text-xs font-bold bg-green-100 text-green-800 px-2 py-1 rounded-lg">
                      Ready 🔔
                    </span>
                  </div>

                  <div className="space-y-1.5 py-1 text-xs">
                    {order.items?.map((item: OrderItem, idx: number) => (
                      <div key={idx} className="flex justify-between font-bold text-gray-800">
                        <span>
                          {item.quantity}x {item.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      fullWidth
                      className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs"
                      onClick={() => handleStatusChange(order.id, "completed")}
                    >
                      ✓ Mark Served
                    </Button>
                    <button
                      onClick={() => handlePrintKOT(order)}
                      className="p-2 border border-gray-300 hover:border-accent hover:text-accent rounded-lg text-gray-600 transition-colors"
                      title="Print Ticket"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KOT Print Preview & Thermal Printing Modal */}
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
    </div>
  );
};

export default KitchenKDS;
