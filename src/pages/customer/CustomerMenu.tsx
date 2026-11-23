import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Search,
  Package,
  Lock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  Card,
  Button,
  Input,
  Modal,
  Loading,
  Alert,
} from "../../components/ui";
import {
  subscribeToMenuItems,
  subscribeToTables,
  createOrder,
  verifyTableQRToken,
} from "../../services/restaurantService";
import type { MenuItem, Restaurant, RestaurantTable } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";
import { customerCheckoutSchema } from "../../schemas/orderSchema";
import { supabase } from "../../config/supabase";
import {
  CartProvider,
  useCart,
  type CartVariant,
} from "../../context/CartContext";

const CustomerMenuContent: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Priority: if ?token= is provided, use that. Fallback to ?table= if passed as token.
  const tokenParam = searchParams.get("token");
  const tableParam = searchParams.get("table");
  const activeToken = tokenParam || tableParam;

  const [lang, setLang] = useState<"en" | "bn">("en");
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [showItemModal, setShowItemModal] = useState(false);

  // Cart from CartContext
  const {
    cart,
    addItem,
    updateQuantity,
    clearCart,
    subtotal,
    itemCount,
  } = useCart();

  // Table QR Detection state
  const [detectedTable, setDetectedTable] = useState<{
    id: string;
    table_number: string;
    capacity: number;
  } | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);

  // Load restaurant & menu items with guaranteed setLoading(false)
  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const loadData = async () => {
      if (!slug) {
        if (isMounted) setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 1. Fetch restaurant
        const { data: restData, error: restError } = await supabase
          .from("restaurants")
          .select(
            "id, name, name_bn, slug, address, city, phone, restaurant_type, logo_url, qr_code_url, currency, currency_symbol, default_vat_rate, service_charge_rate, status, is_active, created_at, updated_at"
          )
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();

        if (restError || !restData) {
          console.warn("Restaurant not found:", restError);
          if (isMounted) setRestaurant(null);
          return;
        }

        if (isMounted) {
          setRestaurant(restData as unknown as Restaurant);
        }

        // 2. Fetch categories map for display
        const { data: catData } = await supabase
          .from("menu_categories")
          .select("id, name, name_bn")
          .eq("restaurant_id", restData.id)
          .is("deleted_at", null)
          .order("display_order", { ascending: true });

        const catMap = new Map<string, { name: string; name_bn?: string }>();
        if (catData) {
          for (const c of catData) {
            catMap.set(c.id, { name: c.name, name_bn: c.name_bn });
          }
        }

        // 3. Fetch menu items directly
        const { data: itemsData, error: itemsError } = await supabase
          .from("menu_items")
          .select("*")
          .eq("restaurant_id", restData.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (itemsError) {
          console.warn("Failed to load menu items directly:", itemsError);
        }

        if (isMounted && itemsData) {
          const enriched = itemsData.map((item) => {
            const cat = item.category_id ? catMap.get(item.category_id) : undefined;
            return {
              ...item,
              category: item.category || cat?.name || "General",
            };
          });
          setMenuItems(enriched as MenuItem[]);
        }

        // 4. Realtime subscription for live updates
        subscription = subscribeToMenuItems(restData.id, (realtimeItems) => {
          if (!isMounted) return;
          const enriched = realtimeItems.map((item) => {
            const cat = item.category_id ? catMap.get(item.category_id) : undefined;
            return {
              ...item,
              category: item.category || cat?.name || "General",
            };
          });
          setMenuItems(enriched as MenuItem[]);
        });
      } catch (err) {
        console.error("Error loading menu data:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [slug]);

  // Verify Table QR Token if present
  useEffect(() => {
    if (!slug || !activeToken) {
      setDetectedTable(null);
      setTableError(null);
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await verifyTableQRToken(slug, activeToken);
        if (res.valid && res.table) {
          setDetectedTable(res.table);
          setTableError(null);
        } else {
          setDetectedTable(null);
          if (tokenParam || (tableParam && tableParam.length > 10)) {
            setTableError(
              res.error ||
                (lang === "bn"
                  ? "অকার্যকর বা মেয়াদোত্তীর্ণ টেবিল QR কোড। অনুগ্রহ করে পুনরায় স্ক্যান করুন।"
                  : "Invalid or expired table QR code. Please scan the QR code on your table again.")
            );
          }
        }
      } catch (err) {
        console.warn("verifyTableQRToken error:", err);
        setDetectedTable(null);
      }
    };

    verifyToken();
  }, [slug, activeToken, tokenParam, tableParam, lang]);

  const categories = [
    "all",
    ...new Set(menuItems.map((item) => item.category).filter(Boolean)),
  ];

  const filteredItems = menuItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.name_bn && item.name_bn.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory =
      categoryFilter === "all" || item.category === categoryFilter;
    return matchesSearch && matchesCategory && item.is_available;
  });

  const handleItemClick = (item: MenuItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (
      (item.sizes && item.sizes.length > 0) ||
      (item.addons && item.addons.length > 0)
    ) {
      setSelectedItem(item);
      setShowItemModal(true);
    } else {
      addItem(item, 1);
    }
  };

  const handleIncrement = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const itemCartEntries = cart.filter((ci) => ci.id === item.id);
    if (itemCartEntries.length > 0) {
      // If item is already in cart, increment the most recently added entry
      const target = itemCartEntries[itemCartEntries.length - 1];
      updateQuantity(target.cartKey, 1);
    } else {
      handleItemClick(item, e);
    }
  };

  const handleDecrement = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const itemCartEntries = cart.filter((ci) => ci.id === item.id);
    if (itemCartEntries.length > 0) {
      // Decrement the most recently added entry; CartContext automatically removes it when quantity reaches 0
      const target = itemCartEntries[itemCartEntries.length - 1];
      updateQuantity(target.cartKey, -1);
    }
  };

  const getItemCountInCart = (itemId: string) => {
    return cart
      .filter((ci) => ci.id === itemId)
      .reduce((sum, ci) => sum + ci.quantity, 0);
  };

  if (loading) {
    return <Loading text={lang === "bn" ? "মেনু লোড হচ্ছে..." : "Loading menu..."} />;
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <Card className="text-center p-8 max-w-md w-full">
          <Package className="w-16 h-16 text-text-secondary mx-auto mb-4 opacity-50" />
          <h2 className="text-2xl font-bold text-text mb-2">
            {lang === "bn" ? "রেস্তোরাঁ পাওয়া যায়নি" : "Restaurant Not Found"}
          </h2>
          <p className="text-text-secondary text-sm">
            {lang === "bn"
              ? "আপনার অনুরোধকৃত রেস্তোরাঁটি সক্রিয় নেই অথবা বিদ্যমান নয়।"
              : "The restaurant you're looking for doesn't exist or is currently inactive."}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Sticky Header */}
      <div className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-screen-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              {restaurant.logo_url ? (
                <img
                  src={restaurant.logo_url}
                  alt={restaurant.name}
                  className="w-11 h-11 rounded-xl object-cover border border-gray-100 shadow-sm flex-shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-orange-100 border border-orange-200 text-orange-600 font-extrabold flex items-center justify-center text-base shadow-2xs flex-shrink-0">
                  {restaurant.name ? restaurant.name.charAt(0).toUpperCase() : "🍽️"}
                </div>
              )}
              <div>
                <h1 className="font-bold text-base text-gray-900 leading-tight">
                  {lang === "bn" && restaurant.name_bn ? restaurant.name_bn : restaurant.name}
                </h1>
                <p className="text-xs text-gray-500">
                  {restaurant.restaurant_type || "Restaurant"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Detected Table Badge */}
              {detectedTable && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-xl">
                  <span className="text-xs font-bold text-accent">
                    📍 {lang === "bn" ? `টেবিল ${detectedTable.table_number}` : `Table ${detectedTable.table_number}`}
                  </span>
                  <span className="text-[10px] bg-accent text-white px-1.5 py-0.5 rounded font-medium">
                    {lang === "bn" ? "ডাইন-ইন" : "Dine-in"}
                  </span>
                </div>
              )}

              {/* Language Switcher */}
              <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    lang === "en" ? "bg-white text-accent shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
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

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={lang === "bn" ? "খাবার খুঁজুন..." : "Search for dishes..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 bg-gray-50 focus:bg-white"
            />
          </div>
        </div>
      </div>

      {/* Table Error Banner */}
      {tableError && (
        <div className="max-w-screen-lg mx-auto px-4 pt-3">
          <Alert type="error" message={tableError} />
        </div>
      )}

      {/* Category Tabs */}
      <div className="bg-white border-b sticky top-[108px] z-30">
        <div className="max-w-screen-lg mx-auto px-4">
          <div className="flex gap-2 overflow-x-auto py-2.5 scrollbar-hide">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setCategoryFilter(category || "all")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  categoryFilter === category
                    ? "bg-accent text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {category === "all" ? (lang === "bn" ? "সব মেনু" : "All Items") : category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu Item Grid */}
      <div className="max-w-screen-lg mx-auto px-4 py-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium text-sm">
              {lang === "bn" ? "কোন খাবার পাওয়া যায়নি" : "No items found"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredItems.map((item) => {
              const countInCart = getItemCountInCart(item.id);
              const hasVariations =
                (item.sizes && item.sizes.length > 0) ||
                (item.addons && item.addons.length > 0);

              const minPrice =
                item.sizes && item.sizes.length > 0
                  ? Math.min(...item.sizes.map((s) => s.price))
                  : item.base_price;

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 flex flex-col justify-between"
                >
                  <div
                    className={hasVariations ? "cursor-pointer" : undefined}
                    onClick={(e) => {
                      if (hasVariations) {
                        handleItemClick(item, e);
                      }
                    }}
                  >
                    <div className="relative h-36 bg-gray-100 overflow-hidden">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            target.onerror = null;
                            target.style.display = "none";
                            const fallback = target.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        className={`w-full h-full flex items-center justify-center bg-gray-100 ${
                          item.image_url ? "hidden" : "flex"
                        }`}
                      >
                        <Package className="w-10 h-10 text-gray-300" />
                      </div>
                      {!item.is_available && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <span className="bg-black/80 text-white text-[11px] font-bold px-2 py-1 rounded">
                            {lang === "bn" ? "পণ্যটি শেষ" : "Sold Out"}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="p-3">
                      <h3 className="font-bold text-sm text-gray-900 leading-snug line-clamp-1">
                        {lang === "bn" && item.name_bn ? item.name_bn : item.name}
                      </h3>
                      {(item.description || item.description_bn) && (
                        <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5 leading-relaxed">
                          {lang === "bn" && item.description_bn
                            ? item.description_bn
                            : item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-3 pt-0">
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                      <div>
                        <span className="text-[10px] text-gray-400 block leading-tight">
                          {hasVariations ? (lang === "bn" ? "শুরু" : "Starts at") : ""}
                        </span>
                        <p className="font-extrabold text-sm text-gray-900">
                          {formatCurrency(minPrice)}
                        </p>
                      </div>

                      {item.is_available && (
                        <div>
                          {countInCart === 0 ? (
                            <button
                              type="button"
                              onClick={(e) => handleItemClick(item, e)}
                              className="px-3.5 py-1.5 border border-accent bg-accent/5 hover:bg-accent hover:text-white text-accent font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-sm active:scale-95"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>{lang === "bn" ? "যোগ করুন" : "Add"}</span>
                            </button>
                          ) : (
                            <div
                              className="flex items-center bg-accent text-white rounded-lg shadow-sm overflow-hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => handleDecrement(item, e)}
                                className="p-1.5 px-2 hover:bg-accent-hover text-white transition-colors flex items-center justify-center active:scale-95"
                                aria-label="Decrease quantity"
                              >
                                <Minus className="w-3 h-3 stroke-[2.5]" />
                              </button>
                              <span className="min-w-[1.5rem] px-1 text-center font-extrabold text-xs select-none">
                                {countInCart}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => handleIncrement(item, e)}
                                className="p-1.5 px-2 hover:bg-accent-hover text-white transition-colors flex items-center justify-center active:scale-95"
                                aria-label="Increase quantity"
                              >
                                <Plus className="w-3 h-3 stroke-[2.5]" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Modal */}
      <CartModal
        isOpen={showCart}
        lang={lang}
        onClose={() => setShowCart(false)}
        onCheckout={() => {
          setShowCart(false);
          setShowCheckout(true);
        }}
      />

      {/* Item Customization Modal */}
      <ItemCustomizationModal
        isOpen={showItemModal}
        item={selectedItem}
        lang={lang}
        onClose={() => setShowItemModal(false)}
        onAdd={(item, qty, size, addons) => {
          addItem(item, qty, size, addons);
          setShowItemModal(false);
        }}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={showCheckout}
        lang={lang}
        restaurantId={restaurant.id}
        detectedTable={detectedTable}
        tableError={tableError}
        qrToken={activeToken || undefined}
        onClose={() => setShowCheckout(false)}
        onSuccess={(orderId) => {
          clearCart();
          setShowCheckout(false);
          navigate(`/order/${orderId}`);
        }}
      />

      {/* Floating Bottom Cart Bar */}
      {itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-accent text-white shadow-[0_-4px_20px_rgba(0,0,0,0.15)] z-40">
          <div className="max-w-screen-lg mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white text-accent font-black text-xs w-6 h-6 rounded-full flex items-center justify-center">
                {itemCount}
              </div>
              <span className="font-extrabold text-base tracking-tight">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <button
              onClick={() => setShowCart(true)}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl font-bold text-xs transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>{lang === "bn" ? "কার্ট দেখুন" : "View Cart"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Cart Modal
interface CartModalProps {
  isOpen: boolean;
  lang: "en" | "bn";
  onClose: () => void;
  onCheckout: () => void;
}

const CartModal: React.FC<CartModalProps> = ({
  isOpen,
  lang,
  onClose,
  onCheckout,
}) => {
  const { cart, updateQuantity, removeItem, subtotal, itemCount } = useCart();
  const tax = subtotal * 0.05; // 5% NBR VAT
  const total = subtotal + tax;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lang === "bn" ? "আপনার কার্ট" : "Your Cart"}
      size="md"
    >
      <div className="space-y-4">
        {cart.length === 0 ? (
          <div className="text-center py-10">
            <ShoppingCart className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium text-sm">
              {lang === "bn" ? "আপনার কার্ট সম্পূর্ণ খালি" : "Your cart is empty"}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {cart.map((item) => (
                <div
                  key={item.cartKey}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="flex-1 mr-3">
                    <h4 className="font-bold text-xs text-gray-900">
                      {lang === "bn" && item.name_bn ? item.name_bn : item.name}
                    </h4>
                    {item.selectedSize && (
                      <p className="text-[11px] text-gray-500">
                        {lang === "bn" ? "সাইজ: " : "Size: "}
                        {lang === "bn" && item.selectedSize.name_bn
                          ? item.selectedSize.name_bn
                          : item.selectedSize.name}
                      </p>
                    )}
                    {item.selectedAddons.length > 0 && (
                      <p className="text-[11px] text-gray-500">
                        +{" "}
                        {item.selectedAddons
                          .map((a) => (lang === "bn" && a.name_bn ? a.name_bn : a.name))
                          .join(", ")}
                      </p>
                    )}
                    <p className="text-accent font-bold text-xs mt-1">
                      {formatCurrency(item.itemTotal * item.quantity)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-white border border-gray-200 rounded-lg shadow-sm">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.cartKey, -1)}
                        className="p-1.5 hover:bg-gray-100 text-gray-600 rounded-l-lg transition-colors active:scale-95"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-7 text-center font-bold text-xs text-gray-900 select-none">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.cartKey, 1)}
                        className="p-1.5 hover:bg-gray-100 text-gray-600 rounded-r-lg transition-colors active:scale-95"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(item.cartKey)}
                      className="p-1.5 text-gray-400 hover:text-error hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                      title="Remove"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Price calculation */}
            <div className="border-t border-gray-100 pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>{lang === "bn" ? "সাবটোটাল" : "Subtotal"}</span>
                <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>{lang === "bn" ? "ভ্যাট (৫%)" : "VAT (5%)"}</span>
                <span className="font-semibold text-gray-900">{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-gray-900 pt-2 border-t border-gray-100">
                <span>{lang === "bn" ? "সর্বমোট" : "Grand Total"}</span>
                <span className="text-accent">{formatCurrency(total)}</span>
              </div>
            </div>

            <Button onClick={onCheckout} fullWidth size="lg">
              {lang === "bn"
                ? `চেকআউটে যান (${itemCount} টি আইটেম)`
                : `Proceed to Checkout (${itemCount} items)`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
};

// Item Customization Modal
interface ItemCustomizationModalProps {
  isOpen: boolean;
  item: MenuItem | null;
  lang: "en" | "bn";
  onClose: () => void;
  onAdd: (
    item: MenuItem,
    quantity: number,
    size?: CartVariant,
    addons?: CartVariant[]
  ) => void;
}

const ItemCustomizationModal: React.FC<ItemCustomizationModalProps> = ({
  isOpen,
  item,
  lang,
  onClose,
  onAdd,
}) => {
  const [selectedSize, setSelectedSize] = useState<CartVariant | undefined>(undefined);
  const [selectedAddons, setSelectedAddons] = useState<CartVariant[]>([]);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (item?.sizes && item.sizes.length > 0) {
      setSelectedSize(item.sizes[0]);
    } else {
      setSelectedSize(undefined);
    }
    setSelectedAddons([]);
    setQuantity(1);
  }, [item]);

  if (!item) return null;

  const toggleAddon = (addon: CartVariant) => {
    if (selectedAddons.find((a) => a.name === addon.name)) {
      setSelectedAddons(selectedAddons.filter((a) => a.name !== addon.name));
    } else {
      setSelectedAddons([...selectedAddons, addon]);
    }
  };

  const basePrice = selectedSize ? selectedSize.price : item.base_price;
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + a.price, 0);
  const unitPrice = basePrice + addonsTotal;
  const total = unitPrice * quantity;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lang === "bn" && item.name_bn ? item.name_bn : item.name}
      size="md"
    >
      <div className="space-y-4">
        {item.image_url && (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-44 object-cover rounded-xl"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}

        {(item.description || item.description_bn) && (
          <p className="text-xs text-gray-500">
            {lang === "bn" && item.description_bn ? item.description_bn : item.description}
          </p>
        )}

        {/* Sizes */}
        {item.sizes && item.sizes.length > 0 && (
          <div>
            <h4 className="font-bold text-xs text-gray-900 mb-2">
              {lang === "bn" ? "সাইজ নির্বাচন করুন" : "Select Size"}
            </h4>
            <div className="space-y-1.5">
              {item.sizes.map((size) => (
                <button
                  type="button"
                  key={size.name}
                  onClick={() => setSelectedSize(size)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    selectedSize?.name === size.name
                      ? "border-accent bg-accent/5 text-accent ring-1 ring-accent"
                      : "border-gray-200 text-gray-700 hover:border-accent/40"
                  }`}
                >
                  <span>{lang === "bn" && size.name_bn ? size.name_bn : size.name}</span>
                  <span className="font-bold">{formatCurrency(size.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Addons */}
        {item.addons && item.addons.length > 0 && (
          <div>
            <h4 className="font-bold text-xs text-gray-900 mb-2">
              {lang === "bn" ? "এড-অন (ঐচ্ছিক)" : "Add-ons (Optional)"}
            </h4>
            <div className="space-y-1.5">
              {item.addons.map((addon) => {
                const isSelected = !!selectedAddons.find((a) => a.name === addon.name);
                return (
                  <button
                    type="button"
                    key={addon.name}
                    onClick={() => toggleAddon(addon)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                      isSelected
                        ? "border-accent bg-accent/5 text-accent ring-1 ring-accent"
                        : "border-gray-200 text-gray-700 hover:border-accent/40"
                    }`}
                  >
                    <span>{lang === "bn" && addon.name_bn ? addon.name_bn : addon.name}</span>
                    <span className="font-bold">+{formatCurrency(addon.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quantity and Total */}
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="p-1.5 hover:bg-white text-gray-600 rounded-md transition-colors active:scale-95"
              aria-label="Decrease quantity"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-8 text-center font-bold text-xs text-gray-900 select-none">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => q + 1)}
              className="p-1.5 hover:bg-white text-gray-600 rounded-md transition-colors active:scale-95"
              aria-label="Increase quantity"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-gray-400 block leading-tight">
              {lang === "bn" ? "মোট মূল্য" : "Total"}
            </span>
            <span className="font-extrabold text-base text-gray-900">
              {formatCurrency(total)}
            </span>
          </div>
        </div>

        <Button
          onClick={() => onAdd(item, quantity, selectedSize, selectedAddons)}
          fullWidth
          size="lg"
        >
          {lang === "bn" ? "কার্টে যোগ করুন" : "Add to Cart"}
        </Button>
      </div>
    </Modal>
  );
};

// Checkout Modal
interface CheckoutModalProps {
  isOpen: boolean;
  lang: "en" | "bn";
  restaurantId: string;
  detectedTable?: { id: string; table_number: string; capacity: number } | null;
  tableError?: string | null;
  qrToken?: string;
  onClose: () => void;
  onSuccess: (orderId: string) => void;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  lang,
  restaurantId,
  detectedTable,
  tableError,
  qrToken,
  onClose,
  onSuccess,
}) => {
  const { cart, subtotal } = useCart();
  const tax = subtotal * 0.05; // 5% NBR VAT
  const total = subtotal + tax;

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<"table" | "takeaway">("table");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Live Tables Realtime State
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>(detectedTable?.id || "");
  const [selectedTableNumber, setSelectedTableNumber] = useState<string>(detectedTable?.table_number || "");
  const [tablesLoading, setTablesLoading] = useState<boolean>(true);

  // Subscribe to tables live with Supabase Realtime
  useEffect(() => {
    if (!restaurantId || !isOpen) return;

    let isMounted = true;
    setTablesLoading(true);

    const subscription = subscribeToTables(restaurantId, (liveTables) => {
      if (!isMounted) return;
      const sorted = [...liveTables].sort((a, b) =>
        a.table_number.localeCompare(b.table_number, undefined, { numeric: true, sensitivity: "base" })
      );
      setTables(sorted);
      setTablesLoading(false);

      if (detectedTable) {
        const found = sorted.find(
          (t) => t.id === detectedTable.id || t.table_number === detectedTable.table_number
        );
        if (found) {
          setSelectedTableId(found.id);
          setSelectedTableNumber(found.table_number);
        }
      } else if (qrToken) {
        const qrMatch = sorted.find((t) => t.qr_token === qrToken);
        if (qrMatch && qrMatch.status === "available") {
          setSelectedTableId(qrMatch.id);
          setSelectedTableNumber(qrMatch.table_number);
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [restaurantId, isOpen, detectedTable, qrToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (orderType === "table") {
      if (tableError) {
        setError(tableError);
        return;
      }
      if (!selectedTableId) {
        setError(
          lang === "bn"
            ? "অনুগ্রহ করে ডাইন-ইনের জন্য একটি খালি টেবিল নির্বাচন করুন।"
            : "Please select an available table for your dine-in order."
        );
        return;
      }
      const selectedTable = tables.find((t) => t.id === selectedTableId);
      if (selectedTable && selectedTable.status !== "available") {
        setError(
          lang === "bn"
            ? "এই টেবিলটি ইতোমধ্যে বুকড হয়ে গেছে। অনুগ্রহ করে অন্য খালি টেবিল নির্বাচন করুন।"
            : "This table is already occupied. Please select another available table."
        );
        return;
      }
    }

    // Zod validation with customerCheckoutSchema
    const effectiveOrderType = orderType === "takeaway" ? "takeaway" : detectedTable ? "qr" : "dine_in";
    const validationResult = customerCheckoutSchema.safeParse({
      customer_name: customerName,
      customer_phone: customerPhone,
      order_type: effectiveOrderType,
      table_id: orderType === "takeaway" ? undefined : selectedTableId,
      table_number: orderType === "takeaway" ? undefined : selectedTableNumber,
      customer_notes: notes || undefined,
    });

    if (!validationResult.success) {
      const firstError =
        validationResult.error.issues[0]?.message || "Please check your inputs";
      setError(firstError);
      return;
    }

    const validData = validationResult.data;
    setLoading(true);

    const orderPayload = {
      restaurant_id: restaurantId,
      table_id: orderType === "takeaway" ? undefined : selectedTableId,
      order_type: effectiveOrderType as "dine_in" | "takeaway" | "qr" | "counter" | "table",
      table_number: orderType === "takeaway" ? undefined : selectedTableNumber,
      qr_token: orderType === "takeaway" ? undefined : (detectedTable ? qrToken : undefined),
      idempotency_key: idempotencyKey,
      customer_name: validData.customer_name,
      customer_phone: validData.customer_phone,
      items: cart.map((item) => ({
        menu_item_id: item.id,
        name: item.name,
        quantity: item.quantity,
        base_price: item.base_price,
        client_price: item.itemTotal,
        selected_size: item.selectedSize
          ? { name: item.selectedSize.name, price: item.selectedSize.price }
          : undefined,
        selected_addons: item.selectedAddons.map((a) => ({
          name: a.name,
          price: a.price,
        })),
        item_total: Number((item.itemTotal * item.quantity).toFixed(2)),
      })),
      subtotal: Number(subtotal.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      total: Number(total.toFixed(2)),
      customer_notes: validData.customer_notes,
    };

    const { data: orderRes, error: orderError } = await createOrder(orderPayload);
    setLoading(false);

    if (!orderError && orderRes?.order_id) {
      onSuccess(orderRes.order_id);
    } else {
      setError(orderError?.message || "Failed to place order. Please try again.");
      // Regenerate idempotency key on failure so retry is permitted
      setIdempotencyKey(crypto.randomUUID());
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={lang === "bn" ? "অর্ডার নিশ্চিতকরণ" : "Checkout"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        {/* Order Type Selector: Dine-in vs Takeaway */}
        <div>
          <label className="label mb-1.5 text-xs font-bold text-gray-700">
            {lang === "bn" ? "অর্ডারের ধরণ" : "Order Type"}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOrderType("table")}
              className={`p-2.5 rounded-xl border-2 font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                orderType === "table"
                  ? "border-accent bg-accent/10 text-accent shadow-xs"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              <span>🍽️</span>
              <span>{lang === "bn" ? "ডাইন-ইন" : "Dine-in"}</span>
            </button>
            <button
              type="button"
              onClick={() => setOrderType("takeaway")}
              className={`p-2.5 rounded-xl border-2 font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                orderType === "takeaway"
                  ? "border-accent bg-accent/10 text-accent shadow-xs"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              <span>🛍️</span>
              <span>{lang === "bn" ? "টেকঅ্যাওয়ে" : "Takeaway"}</span>
            </button>
          </div>
        </div>

        {/* Table Badge if Dine-in with QR detected */}
        {orderType === "table" && detectedTable && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-emerald-600 text-white rounded-lg flex items-center justify-center shadow-xs">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-emerald-700 uppercase font-bold tracking-wider">
                  {lang === "bn" ? "ডাইন-ইন টেবিল (QR দ্বারা যাচাইকৃত)" : "Dine-In Table (QR Verified)"}
                </p>
                <p className="text-base font-extrabold text-emerald-950 leading-tight">
                  {detectedTable.table_number}
                </p>
              </div>
            </div>
            <span className="text-[11px] bg-emerald-600 text-white px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-xs">
              <CheckCircle2 className="w-3 h-3" />
              QR Verified
            </span>
          </div>
        )}

        {/* Live Available Table Grid if Dine-in without QR */}
        {orderType === "table" && !detectedTable && (
          <div className="space-y-2 border border-gray-200 bg-gray-50/70 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <span>{lang === "bn" ? "খালি টেবিল নির্বাচন করুন" : "Select Available Table"}</span>
                <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[10px] font-semibold text-gray-600 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{lang === "bn" ? "লাইভ আপডেট" : "Live Realtime"}</span>
              </div>
            </div>

            {tablesLoading ? (
              <div className="py-6 flex flex-col items-center justify-center text-gray-400 text-xs">
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                <span>{lang === "bn" ? "টেবিল লোড হচ্ছে..." : "Loading tables..."}</span>
              </div>
            ) : tables.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs text-center font-medium">
                {lang === "bn"
                  ? "কোন টেবিল পাওয়া যায়নি। অনুগ্রহ করে কর্মীকে জানান।"
                  : "No tables found. Please contact restaurant staff."}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-52 overflow-y-auto pr-1">
                  {tables.map((t) => {
                    const isAvailable = t.status === "available";
                    const isSelected = selectedTableId === t.id;

                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!isAvailable}
                        onClick={() => {
                          if (isAvailable) {
                            setSelectedTableId(t.id);
                            setSelectedTableNumber(t.table_number);
                            setError("");
                          }
                        }}
                        className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center relative ${
                          !isAvailable
                            ? "border-red-200/80 bg-red-50/60 text-red-400 opacity-60 cursor-not-allowed"
                            : isSelected
                            ? "border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/30 scale-[1.02]"
                            : "border-emerald-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/60 text-gray-800"
                        }`}
                      >
                        <span className={`text-xs font-black tracking-tight ${isSelected ? "text-white" : ""}`}>
                          {t.table_number}
                        </span>
                        <span
                          className={`text-[9px] font-medium mt-0.5 ${
                            !isAvailable
                              ? "text-red-500 font-bold"
                              : isSelected
                              ? "text-emerald-100"
                              : "text-emerald-600 font-semibold"
                          }`}
                        >
                          {!isAvailable
                            ? lang === "bn"
                              ? "বুকড"
                              : "Occupied"
                            : t.capacity
                            ? `${t.capacity} ${lang === "bn" ? "সিট" : "seats"}`
                            : lang === "bn"
                            ? "খালি"
                            : "Available"}
                        </span>
                        {isSelected && (
                          <span className="absolute -top-1 -right-1 bg-white text-emerald-600 rounded-full p-0.5 shadow-xs">
                            <CheckCircle2 className="w-3 h-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Status legend & Selection indicator */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-200/70 text-[10px] text-gray-500">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>{lang === "bn" ? "খালি" : "Available"}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span>{lang === "bn" ? "বুকড" : "Occupied"}</span>
                    </span>
                  </div>
                  {selectedTableNumber && (
                    <span className="font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md">
                      {lang === "bn" ? `নির্বাচিত: ${selectedTableNumber}` : `Selected: ${selectedTableNumber}`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Customer Name */}
        <Input
          label={lang === "bn" ? "আপনার নাম" : "Your Name"}
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder={lang === "bn" ? "পুরো নাম লিখুন" : "Enter your full name"}
          required
        />

        {/* Phone Number */}
        <Input
          label={lang === "bn" ? "মোবাইল নম্বর" : "Phone Number"}
          type="tel"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="01712345678"
          helperText={
            lang === "bn"
              ? "অর্ডার স্ট্যাটাস ও যোগাযোগের জন্য এই নম্বর ব্যবহৃত হবে"
              : "Used for order updates and verification"
          }
          required
        />

        {/* Notes */}
        <div>
          <label className="label mb-1.5 text-xs">
            {lang === "bn" ? "বিশেষ নির্দেশনাবলী (ঐচ্ছিক)" : "Special Instructions (Optional)"}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              lang === "bn"
                ? "ঝাল কম/বেশি, অ্যালার্জি বা অন্য কোন নির্দেশনা..."
                : "Less spicy, allergies, extra cutlery..."
            }
            rows={2}
            className="input-field text-xs"
          />
        </div>

        {/* Order Summary Recap */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-1.5 text-xs">
          <div className="flex justify-between text-gray-600">
            <span>{lang === "bn" ? "সাবটোটাল" : "Subtotal"}</span>
            <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>{lang === "bn" ? "ভ্যাট (৫%)" : "VAT (5%)"}</span>
            <span className="font-semibold text-gray-900">{formatCurrency(tax)}</span>
          </div>
          <div className="flex justify-between text-sm font-extrabold text-gray-900 pt-1.5 border-t border-gray-200">
            <span>{lang === "bn" ? "পরিশোধযোগ্য মোট" : "Payable Total"}</span>
            <span className="text-accent">{formatCurrency(total)}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} fullWidth>
            {lang === "bn" ? "ফিরে যান" : "Cancel"}
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            {lang === "bn" ? "অর্ডার নিশ্চিত করুন" : "Place Order"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// Top-level exported component wrapped with CartProvider
const CustomerMenu: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  return (
    <CartProvider restaurantSlug={slug || "default"}>
      <CustomerMenuContent />
    </CartProvider>
  );
};

export default CustomerMenu;
