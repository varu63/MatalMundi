import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { endpoints, handleError } from '../lib/api';

const CartContext = createContext(null);
const STORAGE_KEY = 'metalmundi.cart';

function newKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `cart-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);
  // Reused while the cart is untouched so a double-click or a retried submit
  // resolves to the same order instead of creating a second one.
  const submission = useRef({ fingerprint: null, key: null });

  const keyFor = (list) => {
    const fingerprint = list.map((i) => `${i.listingId}:${i.weightKg}`).join('|');
    if (submission.current.fingerprint !== fingerprint) {
      submission.current = { fingerprint, key: newKey() };
    }
    return submission.current.key;
  };

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
      idempotencyKey: keyFor(items),
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
