import React, { useState, useEffect } from "react";
import { Plus, Minus, Trash2, Search, Utensils, ShoppingBag, CheckCircle2, User, Phone } from "lucide-react";
import { Modal, Button, Alert } from "../ui";
import { formatCurrency, generateUUID } from "../../utils/helpers";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { createOrder, updateOrderStatus } from "../../services/restaurantService";

interface MenuItem {
  id: string;
  name: string;
  name_bn?: string;
  base_price: number;
  is_available: boolean;
  category_id?: string;
}

interface TableOption {
  id: string;
  table_number: string;
  qr_token?: string;
}

interface CartItem {
  item: MenuItem;
  quantity: number;
}

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: () => void;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
}) => {
  const { restaurantId, profile, user } = useAuth();
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("dine_in");
  const [tableNumber, setTableNumber] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<TableOption | null>(null);
  const [customerName, setCustomerName] = useState<string>("Walking Customer");
  const [customerPhone, setCustomerPhone] = useState<string>("01700000000");
  const [notes, setNotes] = useState<string>("");

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [searchItem, setSearchItem] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string>("");

  // Load menu items and tables for current restaurant
  useEffect(() => {
    if (!isOpen || !restaurantId) return;

    const loadData = async () => {
      setLoadingData(true);
      try {
        const [itemsRes, tablesRes] = await Promise.all([
          supabase
            .from("menu_items")
            .select("id, name, name_bn, base_price, is_available, category_id")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .eq("is_available", true)
            .order("name", { ascending: true }),
          supabase
            .from("restaurant_tables")
            .select("id, table_number, qr_token")
            .eq("restaurant_id", restaurantId)
            .is("deleted_at", null)
            .eq("is_active", true)
            .order("table_number", { ascending: true }),
        ]);

        if (itemsRes.data) setMenuItems(itemsRes.data);
        if (tablesRes.data) {
          setTables(tablesRes.data);
          if (tablesRes.data.length > 0) {
            setSelectedTable(tablesRes.data[0]);
            setTableNumber(tablesRes.data[0].table_number);
          }
        }
      } catch (err) {
        console.error("Error loading POS items:", err);
      } finally {
        setLoadingData(false);
      }
    };

    loadData();
    // Reset form state on open
    setCart([]);
    setError("");
    setNotes("");
    setCustomerName("Walking Customer");
    setCustomerPhone("01700000000");
    setOrderType("dine_in");
  }, [isOpen, restaurantId]);

  const handleAddToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.item.id === itemId) {
            const nextQty = c.quantity + delta;
            return nextQty > 0 ? { ...c, quantity: nextQty } : null;
          }
          return c;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.item.id !== itemId));
  };

  const subtotal = cart.reduce((sum, c) => sum + (c.item.base_price || 0) * c.quantity, 0);
  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const filteredMenuItems = menuItems.filter((item) => {
    if (!searchItem.trim()) return true;
    const term = searchItem.toLowerCase();
    return (
      item.name.toLowerCase().includes(term) ||
      (item.name_bn && item.name_bn.toLowerCase().includes(term))
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (cart.length === 0) {
      setError("Please add at least one item to the order.");
      return;
    }

    if (orderType === "dine_in" && !tableNumber.trim()) {
      setError("Please select or enter a table number for Dine-in.");
      return;
    }

    setLoading(true);
    try {
      const waiterStaffName =
        profile?.full_name ||
        user?.user_metadata?.full_name ||
        user?.email?.split("@")[0] ||
        "Staff Waiter";

      const orderPayload = {
        restaurant_id: restaurantId!,
        table_id: orderType === "dine_in" && selectedTable ? selectedTable.id : undefined,
        order_type: orderType,
        table_number: orderType === "dine_in" ? tableNumber : undefined,
        qr_token: orderType === "dine_in" && selectedTable?.qr_token ? selectedTable.qr_token : undefined,
        idempotency_key: generateUUID(),
        customer_name: customerName.trim() || "Walking Customer",
        customer_phone: customerPhone.trim() || "01700000000",
        items: cart.map((c) => ({
          menu_item_id: c.item.id,
          name: c.item.name,
          quantity: c.quantity,
          base_price: c.item.base_price,
          client_price: c.item.base_price,
          item_total: Number((c.item.base_price * c.quantity).toFixed(2)),
        })),
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: Number(total.toFixed(2)),
        customer_notes: notes ? `[POS Staff: ${waiterStaffName}] ${notes}` : `[POS Staff: ${waiterStaffName}]`,
      };

      const { data: orderRes, error: orderError } = await createOrder(orderPayload);
      if (orderError || !orderRes?.order_id) {
        throw new Error(orderError?.message || "Failed to place order");
      }

      // Automatically confirm the order and record waiter name
      await updateOrderStatus(orderRes.order_id, "accepted", "Confirmed via Staff POS");

      // Also ensure waiter_name and accepted_by_name are explicitly recorded
      await supabase
        .from("orders")
        .update({
          waiter_name: waiterStaffName,
          accepted_by_name: waiterStaffName,
        })
        .eq("id", orderRes.order_id);

      onOrderCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred while placing order.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New POS Order" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        {/* Top Control Bar: Order Type & Table */}
        <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 grid sm:grid-cols-2 gap-3 items-center">
          {/* Order Type Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Order Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrderType("dine_in")}
                className={`py-2 px-3 rounded-xl border-2 font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  orderType === "dine_in"
                    ? "border-orange-500 bg-orange-50 text-orange-700 shadow-2xs"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
                }`}
              >
                <Utensils className="w-3.5 h-3.5 text-orange-600" />
                <span>Dine-in</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOrderType("takeaway");
                  setTableNumber("");
                }}
                className={`py-2 px-3 rounded-xl border-2 font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  orderType === "takeaway"
                    ? "border-orange-500 bg-orange-50 text-orange-700 shadow-2xs"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5 text-orange-600" />
                <span>Takeaway</span>
              </button>
            </div>
          </div>

          {/* Table Selector (Only for Dine-in) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Table No
            </label>
            {orderType === "dine_in" ? (
              tables.length > 0 ? (
                <select
                  value={tableNumber}
                  onChange={(e) => {
                    setTableNumber(e.target.value);
                    const match = tables.find((t) => t.table_number === e.target.value);
                    setSelectedTable(match || null);
                  }}
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-orange-500"
                >
                  {tables.map((tbl) => (
                    <option key={tbl.id} value={tbl.table_number}>
                      Table {tbl.table_number}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-orange-500"
                  required
                />
              )
            ) : (
              <div className="py-2 px-3 bg-slate-100 border border-slate-200 rounded-xl text-xs font-medium text-slate-400">
                - (No Table / Takeaway Parcel)
              </div>
            )}
          </div>
        </div>

        {/* Customer Details Row */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Customer Name
            </label>
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walking Customer"
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Phone Number
            </label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="017xxxxxxxx"
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Main Grid: Menu Items Selector & Cart Summary */}
        <div className="grid md:grid-cols-12 gap-4 pt-1">
          {/* Menu Items Left Column (7 cols) */}
          <div className="md:col-span-7 space-y-2 border-r border-slate-100 pr-0 md:pr-3">
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchItem}
                  onChange={(e) => setSearchItem(e.target.value)}
                  placeholder="Search dishes to add..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-100 border border-transparent rounded-xl text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-orange-500"
                />
              </div>
              <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
                {filteredMenuItems.length} dishes
              </span>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {loadingData ? (
                <div className="text-center py-8 text-xs text-slate-400">Loading menu...</div>
              ) : filteredMenuItems.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">No dishes found</div>
              ) : (
                filteredMenuItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-xl bg-slate-50/70 hover:bg-orange-50/60 border border-slate-200/80 flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                      {item.name_bn && (
                        <p className="text-[10px] text-slate-400 truncate">{item.name_bn}</p>
                      )}
                      <p className="text-xs font-extrabold text-orange-600">
                        {formatCurrency(item.base_price)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddToCart(item)}
                      className="px-2.5 py-1 bg-white hover:bg-orange-500 hover:text-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shadow-2xs shrink-0"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cart & Total Right Column (5 cols) */}
          <div className="md:col-span-5 bg-slate-50 p-3 rounded-2xl border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 mb-2">
                <span className="text-xs font-bold text-slate-800">Order Items</span>
                <span className="text-[11px] font-bold text-slate-400">
                  {cart.reduce((s, c) => s + c.quantity, 0)} items
                </span>
              </div>

              <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                {cart.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">
                    No items selected yet. Click + Add on any dish.
                  </p>
                ) : (
                  cart.map((c) => (
                    <div
                      key={c.item.id}
                      className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-slate-200/70 shadow-2xs"
                    >
                      <div className="min-w-0 pr-1">
                        <p className="font-bold text-slate-800 truncate">{c.item.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {formatCurrency(c.item.base_price)} × {c.quantity}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(c.item.id, -1)}
                          className="w-5 h-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded flex items-center justify-center font-bold"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="font-black text-xs w-4 text-center">{c.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(c.item.id, 1)}
                          className="w-5 h-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded flex items-center justify-center font-bold"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(c.item.id)}
                          className="w-5 h-5 text-red-500 hover:bg-red-50 rounded flex items-center justify-center ml-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Calculations & Totals */}
            <div className="pt-3 border-t border-slate-200/80 mt-2 space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>VAT (5%)</span>
                <span>{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-dashed border-slate-200">
                <span>Total Payable</span>
                <span className="text-orange-600">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={loading || cart.length === 0}
            className="flex items-center gap-1.5"
          >
            {loading ? (
              <span>Placing Order...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Send to Kitchen ({formatCurrency(total)})</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
