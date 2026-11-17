import React, { createContext, useContext, useState, useEffect } from "react";
import type { MenuItem } from "../config/supabase";

export interface CartVariant {
  name: string;
  name_bn?: string;
  price: number;
}

export interface CartItem {
  cartKey: string;
  id: string; // menuItem id
  name: string;
  name_bn?: string | null;
  base_price: number;
  quantity: number;
  selectedSize?: CartVariant;
  selectedAddons: CartVariant[];
  itemTotal: number;
  image_url?: string | null;
}

interface CartContextType {
  cart: CartItem[];
  addItem: (
    item: MenuItem,
    quantity?: number,
    selectedSize?: CartVariant,
    selectedAddons?: CartVariant[]
  ) => void;
  updateQuantity: (cartKey: string, delta: number) => void;
  removeItem: (cartKey: string) => void;
  clearCart: () => void;
  subtotal: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{
  restaurantSlug: string;
  children: React.ReactNode;
}> = ({ restaurantSlug, children }) => {
  const storageKey = `amarmenu_cart_${restaurantSlug}`;

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Save to localStorage whenever cart changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch (e) {
      console.error("Failed to persist cart to storage", e);
    }
  }, [cart, storageKey]);

  const generateCartKey = (
    itemId: string,
    size?: CartVariant,
    addons: CartVariant[] = []
  ) => {
    const sizePart = size ? size.name : "none";
    const addonsPart = addons
      .map((a) => a.name)
      .sort()
      .join(",");
    return `${itemId}_size:${sizePart}_addons:${addonsPart}`;
  };

  const addItem = (
    item: MenuItem,
    quantity: number = 1,
    selectedSize?: CartVariant,
    selectedAddons: CartVariant[] = []
  ) => {
    const basePrice = selectedSize ? selectedSize.price : item.base_price;
    const addonsSum = selectedAddons.reduce((sum, a) => sum + a.price, 0);
    const unitTotal = basePrice + addonsSum;
    const cartKey = generateCartKey(item.id, selectedSize, selectedAddons);

    setCart((prevCart) => {
      const existingIdx = prevCart.findIndex((ci) => ci.cartKey === cartKey);
      if (existingIdx >= 0) {
        const next = [...prevCart];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + quantity,
        };
        return next;
      }

      const newItem: CartItem = {
        cartKey,
        id: item.id,
        name: item.name,
        name_bn: item.name_bn,
        base_price: item.base_price,
        quantity,
        selectedSize,
        selectedAddons,
        itemTotal: unitTotal,
        image_url: item.image_url,
      };

      return [...prevCart, newItem];
    });
  };

  const updateQuantity = (cartKey: string, delta: number) => {
    setCart((prevCart) => {
      const idx = prevCart.findIndex((ci) => ci.cartKey === cartKey);
      if (idx === -1) return prevCart;

      const newQty = prevCart[idx].quantity + delta;
      if (newQty <= 0) {
        return prevCart.filter((ci) => ci.cartKey !== cartKey);
      }

      const next = [...prevCart];
      next[idx] = { ...next[idx], quantity: newQty };
      return next;
    });
  };

  const removeItem = (cartKey: string) => {
    setCart((prevCart) => prevCart.filter((ci) => ci.cartKey !== cartKey));
  };

  const clearCart = () => {
    setCart([]);
  };

  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        subtotal,
        itemCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};
