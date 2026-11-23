import React, { useState, useEffect, useRef } from "react";
import { Search, X, Loader2, Store, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";

interface SearchResultOrder {
  id: string;
  order_number: string;
  table_number?: string;
  customer_name?: string;
  customer_phone?: string;
  waiter_name?: string;
  status: string;
  total: number;
  created_at: string;
  items?: Array<{ name: string; quantity: number }>;
}

interface SearchResultRestaurant {
  id: string;
  name: string;
  slug: string;
  city?: string;
  phone?: string;
  email?: string;
  subscription_plan?: string;
  is_active: boolean;
}

export const RoleBasedSearchBar: React.FC<{ className?: string; compact?: boolean }> = ({
  className = "",
  compact = false,
}) => {
  const { role, restaurantId } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orderResults, setOrderResults] = useState<SearchResultOrder[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<SearchResultRestaurant[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search logic
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setOrderResults([]);
      setRestaurantResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (role === "super_admin") {
          // Super Admin: search restaurants by name, city, owner email/phone
          const { data: rests } = await supabase
            .from("restaurants")
            .select("id, name, slug, city, phone, email, subscription_plan, is_active")
            .or(`name.ilike.%${trimmed}%,city.ilike.%${trimmed}%,email.ilike.%${trimmed}%,phone.ilike.%${trimmed}%,slug.ilike.%${trimmed}%`)
            .limit(6);
          setRestaurantResults((rests as SearchResultRestaurant[]) || []);

          // Also search orders/invoices if query looks like invoice or order number
          if (trimmed.toLowerCase().includes("inv") || trimmed.toLowerCase().includes("ord") || /^\d+$/.test(trimmed)) {
            const { data: ords } = await supabase
              .from("orders")
              .select("id, order_number, invoice_number, customer_name, customer_phone, status, total, created_at, items")
              .or(`order_number.ilike.%${trimmed}%,invoice_number.ilike.%${trimmed}%`)
              .limit(5);
            setOrderResults((ords as SearchResultOrder[]) || []);
          } else {
            setOrderResults([]);
          }
        } else if (restaurantId) {
          // Restaurant roles: search within caller's restaurant strictly respecting RLS
          let queryBuilder = supabase
            .from("orders")
            .select("id, order_number, table_number, customer_name, customer_phone, waiter_name, accepted_by_name, status, total, created_at, items")
            .eq("restaurant_id", restaurantId);

          if (role === "kitchen" || role === "waiter") {
            // Kitchen/waiter focus on active or pending orders
            queryBuilder = queryBuilder.in("status", ["pending", "accepted", "preparing", "ready"]);
          }

          const { data: ords } = await queryBuilder
            .or(`order_number.ilike.%${trimmed}%,customer_name.ilike.%${trimmed}%,customer_phone.ilike.%${trimmed}%,table_number.ilike.%${trimmed}%,waiter_name.ilike.%${trimmed}%`)
            .order("created_at", { ascending: false })
            .limit(8);

          let results = (ords as SearchResultOrder[]) || [];

          // Also check for dish name matches in items JSONB if fewer than 5 results
          if (results.length < 5) {
            const { data: allRecent } = await supabase
              .from("orders")
              .select("id, order_number, table_number, customer_name, customer_phone, status, total, created_at, items")
              .eq("restaurant_id", restaurantId)
              .order("created_at", { ascending: false })
              .limit(40);

            if (allRecent) {
              const matchedByDish = allRecent.filter((o) => {
                if (results.some((r) => r.id === o.id)) return false;
                if (!Array.isArray(o.items)) return false;
                return o.items.some((it: any) =>
                  (it.name && it.name.toLowerCase().includes(trimmed.toLowerCase())) ||
                  (it.name_bn && it.name_bn.toLowerCase().includes(trimmed.toLowerCase()))
                );
              });
              results = [...results, ...(matchedByDish as SearchResultOrder[])].slice(0, 8);
            }
          }

          setOrderResults(results);
        }
      } catch (err) {
        console.error("Role search error:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, role, restaurantId]);

  const getPlaceholder = () => {
    if (compact) {
      return "Search orders, tables... (Ctrl+K)";
    }
    if (role === "super_admin") {
      return "Search restaurants or invoices... (Ctrl+K)";
    }
    if (role === "kitchen" || role === "waiter") {
      return "Search active tickets... (Ctrl+K)";
    }
    return "Search orders (customer, phone, order #)... (Ctrl+K)";
  };

  const handleSelectOrder = (_orderId: string) => {
    setIsOpen(false);
    setQuery("");
    if (role === "kitchen") {
      navigate("/restaurant/kitchen");
    } else {
      navigate("/restaurant/orders");
    }
  };

  const handleSelectRestaurant = (_slug: string) => {
    setIsOpen(false);
    setQuery("");
    navigate("/admin/restaurants");
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={getPlaceholder()}
          className={`w-full ${
            compact ? "max-w-[240px] sm:max-w-xs md:max-w-sm" : "w-64 sm:w-80 md:w-96"
          } pl-8 pr-7 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-slate-400 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition-colors shadow-2xs`}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setOrderResults([]);
              setRestaurantResults([]);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute left-0 mt-2 w-80 sm:w-96 md:w-[28rem] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-scale-up">
          <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>Search Results for "{query}"</span>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500" />}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {/* Super Admin: Restaurants */}
            {restaurantResults.length > 0 && (
              <div className="p-2">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Restaurants
                </p>
                {restaurantResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelectRestaurant(r.slug)}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-orange-50/60 flex items-center justify-between transition-colors group"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0">
                        <Store className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-slate-800 truncate group-hover:text-orange-600">
                          {r.name}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {r.city ? `${r.city} • ` : ""}{r.email || r.phone}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600 uppercase flex-shrink-0">
                      {r.subscription_plan || "plan"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Orders */}
            {orderResults.length > 0 && (
              <div className="p-2">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Orders ({orderResults.length})
                </p>
                {orderResults.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => handleSelectOrder(o.id)}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-orange-50/60 flex items-center justify-between transition-colors group"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold text-slate-900 group-hover:text-orange-600">
                            #{o.order_number}
                          </span>
                          {o.table_number && (
                            <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded font-medium">
                              T-{o.table_number}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {o.customer_name ? `${o.customer_name} ` : ""}
                          {o.customer_phone ? `(${o.customer_phone})` : ""}
                          {o.waiter_name ? ` • Waiter: ${o.waiter_name}` : ""}
                          {o.items && o.items.length > 0 && (
                            <span className="text-slate-400">
                              {" • "}
                              {o.items.map((it) => `${it.quantity}x ${it.name}`).join(", ")}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-xs font-extrabold text-slate-900">
                        {formatCurrency(o.total)}
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide bg-slate-100 text-slate-600">
                        {o.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && restaurantResults.length === 0 && orderResults.length === 0 && (
              <div className="p-8 text-center text-slate-400">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-medium">No results found matching "{query}"</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Try searching by customer name, phone, order #, or dish
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
