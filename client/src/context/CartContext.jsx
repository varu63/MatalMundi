import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { endpoints, handleError } from '../lib/api';

const CartContext = createContext(null);
const STORAGE_KEY = 'metalmundi.cart';

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);

  const persist = (next) => {
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const add = useCallback((item) => {
    setItems((prev) => {
      const next = [...prev.filter((i) => i.listingId !== item.listingId), item];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const remove = useCallback((listingId) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.listingId !== listingId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateQty = useCallback((listingId, weightKg) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.listingId === listingId ? { ...i, weightKg } : i));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const placeOrder = async (delivery, notes, onDone) => {
    const body = {
      items: items.map((i) => ({ listingId: i.listingId, weightKg: i.weightKg })),
      delivery,
      notes: notes || '',
    };
    try {
      const res = await endpoints.orders.create(body);
      clear();
      onDone && onDone(res.data.data.order);
      return null;
    } catch (err) {
      return handleError(err);
    }
  };

  const count = useMemo(() => items.reduce((s, i) => s + (i.weightKg || 0), 0), [items]);

  return (
    <CartContext.Provider
      value={{ items, add, remove, updateQty, clear, placeOrder, count, persist }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
