import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, ShoppingCart, Minus, Plus } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { paise, kg } from '../lib/format';

const EMPTY_DELIVERY = {
  name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
};

export default function Cart() {
  const { items, updateQty, remove, placeOrder } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState(EMPTY_DELIVERY);
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const subtotal = items.reduce((s, i) => s + i.weightKg * i.pricePerKgPaise, 0);
  const tax = Math.round(subtotal * 0.18);

  const setField = (k, v) => setDelivery((d) => ({ ...d, [k]: v }));

  const valid =
    delivery.name &&
    delivery.phone &&
    delivery.address &&
    delivery.city &&
    delivery.state &&
    delivery.postalCode;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    setPlacing(true);
    setError('');
    const err = await placeOrder(delivery, notes, (order) => {
      toast.success(`Purchase request ${order.orderNumber} submitted`);
      navigate('/dashboard/orders');
    });
    if (err) {
      setError(err);
      toast.error(err);
    }
    setPlacing(false);
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <ShoppingCart className="mx-auto mb-4 h-14 w-14 text-ink-300" />
        <h1 className="page-title">Your cart is empty</h1>
        <p className="mt-2 text-ink-500">Browse the marketplace and add verified material lots.</p>
        <Link to="/marketplace" className="btn-primary mt-6">
          Browse marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Your cart</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1.6fr,1fr]">
        <div className="space-y-4">
          {items.map((i) => (
            <div
              key={i.listingId}
              className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
            >
              <div className="flex-1">
                <Link
                  to={`/marketplace/${i.listingId}`}
                  className="font-semibold text-ink-900 hover:underline"
                >
                  {i.title}
                </Link>
                <p className="text-sm text-ink-500">{paise(i.pricePerKgPaise)}/kg</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-secondary px-2 py-1"
                  onClick={() => updateQty(i.listingId, Math.max(1, i.weightKg - 10))}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-20 text-center text-sm font-semibold">{i.weightKg} kg</span>
                <button
                  className="btn-secondary px-2 py-1"
                  onClick={() => updateQty(i.listingId, i.weightKg + 10)}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  className="btn p-2 text-red-500 hover:bg-red-50"
                  onClick={() => remove(i.listingId)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="card space-y-3 p-5">
            <h2 className="font-semibold text-ink-900">Delivery details</h2>
            <div>
              <label className="label">Full name</label>
              <input
                className="input"
                value={delivery.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={delivery.phone}
                onChange={(e) => setField('phone', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Address</label>
              <input
                className="input"
                value={delivery.address}
                onChange={(e) => setField('address', e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">City</label>
                <input
                  className="input"
                  value={delivery.city}
                  onChange={(e) => setField('city', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">State</label>
                <input
                  className="input"
                  value={delivery.state}
                  onChange={(e) => setField('state', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">PIN</label>
                <input
                  className="input"
                  value={delivery.postalCode}
                  onChange={(e) => setField('postalCode', e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="card space-y-2 p-5">
            <div className="flex justify-between text-sm text-ink-600">
              <span>Material value ({kg(items.reduce((s, i) => s + i.weightKg, 0))})</span>
              <span>{paise(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-ink-600">
              <span>GST (18%)</span>
              <span>{paise(tax)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-lg font-bold text-ink-900">
              <span>Total</span>
              <span className="text-brand-700">{paise(subtotal + tax)}</span>
            </div>
            <p className="text-xs text-ink-400">
              Final amounts are recomputed server-side on submission.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full" disabled={!valid || placing}>
              {placing ? 'Submitting…' : 'Submit purchase request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
