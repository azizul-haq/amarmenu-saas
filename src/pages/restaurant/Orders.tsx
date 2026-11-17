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
} from "../../services/restaurantService";
import type { Order, OrderItem } from "../../config/supabase";
import { formatDateTime, formatCurrency, playSound } from "../../utils/helpers";

const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const previousOrdersRef = useRef<Order[]>([]);

  useEffect(() => {
    // Get restaurant ID from local storage
    const currentRestaurant = localStorage.getItem("current_restaurant");
    if (!currentRestaurant) {
      setLoading(false);
      return;
    }

    const { id: restaurantId } = JSON.parse(currentRestaurant);

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

  if (loading) {
    return <Loading text="Loading orders..." />;
  }

  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const readyCount = orders.filter((o) => o.status === "ready").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text mb-2">Orders</h2>
          <p className="text-text-secondary">
            Manage, verify, and track customer orders in real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readyCount > 0 && (
            <Badge variant="warning" className="text-sm px-3 py-1 font-bold">
              🔔 {readyCount} Ready to Serve
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="warning" className="text-sm px-3 py-1 animate-pulse font-bold">
              ⚡ {pendingCount} Pending Confirmation
            </Badge>
          )}
        </div>
      </div>

      {/* Real-time indicator */}
      <div className="flex items-center space-x-2 text-sm text-success">
        <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
        <span>Live order updates • Waiter confirmation active</span>
      </div>

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
                        <h3 className="text-lg font-bold text-text">
                          Order #{order.order_number}
                        </h3>
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
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth
                    onClick={() => handleViewDetails(order)}
                  >
                    View Details
                  </Button>

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

                  {/* Ready: Waiter Serve & Complete */}
                  {order.status === "ready" && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        className="font-bold bg-green-600 text-white hover:bg-green-700"
                        onClick={() => handleStatusUpdate(order.id, "completed")}
                      >
                        ✓ Mark Served & Paid
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
                </div>
              </div>
            </Card>
          ))}
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
    </div>
  );
};

// Order Details Modal Component with Timeline
interface OrderDetailsModalProps {
  isOpen: boolean;
  order: Order | null;
  onClose: () => void;
}

const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  isOpen,
  order,
  onClose,
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

        <Button onClick={onClose} fullWidth>
          Close
        </Button>
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
