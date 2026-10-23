import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { MapPin, Package, ArrowLeft, ShoppingCart, AlertCircle } from 'lucide-react';
import { endpoints, handleError } from '../lib/api';
import { paise, kg, titleCase, imageUrl } from '../lib/format';
import Spinner from '../components/Spinner';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function ListingDetail() {
  const { id } = useParams();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');
  const [activeImg, setActiveImg] = useState(0);
  const { add } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    endpoints.marketplace
      .get(id)
      .then((r) => setListing(r.data.data.listing))
      .catch((err) => setError(handleError(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const breakdown = useMemo(() => {
    if (!listing || !qty) return null;
    const weightKg = Number(qty);
    const subtotal = weightKg * listing.pricePerKgPaise;
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + tax;
    return { weightKg, subtotal, tax, total };
  }, [listing, qty]);

  if (loading) return <Spinner center />;
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
        <h1 className="page-title">{error}</h1>
        <Link to="/marketplace" className="btn-secondary mt-6">
          <ArrowLeft className="h-4 w-4" /> Back to marketplace
        </Link>
      </div>
    );
  }
  if (!listing) return null;

  const images = listing.images?.length ? listing.images : [{ url: null }];
  const maxQty = listing.availableQuantityKg;
  const minQty = listing.minPurchaseKg || 0;

  const addToCart = () => {
    const w = Number(qty);
    if (!w || w <= 0) {
      setError('Enter an order quantity.');
      return false;
    }
    if (minQty && w < minQty) {
      setError(`Minimum purchase is ${minQty} kg.`);
      return false;
    }
    if (w > maxQty) {
      setError(`Only ${maxQty} kg is currently available.`);
      return false;
    }
    add({
      listingId: listing.id,
      title: listing.title,
      pricePerKgPaise: listing.pricePerKgPaise,
      weightKg: w,
    });
    return true;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link
        to="/marketplace"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1.5fr,1fr]">
        <div>
          <div className="card overflow-hidden">
            <div className="aspect-[4/3] bg-ink-100">
              {images[activeImg]?.url ? (
                <img
                  src={imageUrl(images[activeImg])}
                  alt={listing.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-ink-300">No image</div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 p-3">
                {images.map((img, i) => (
                  <button
                    key={img.publicId || i}
                    onClick={() => setActiveImg(i)}
                    className={`h-16 w-20 overflow-hidden rounded-lg border-2 ${i === activeImg ? 'border-brand-600' : 'border-transparent'}`}
                  >
                    {img.url && <img src={img.url} alt="" className="h-full w-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-sm uppercase tracking-wide text-brand-700">{listing.materialType}</p>
            <h1 className="mt-1 text-2xl font-bold text-ink-900">{listing.title}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
              <MapPin className="h-4 w-4" />
              {[listing.city, listing.state].filter(Boolean).join(', ') ||
                [listing.location?.city, listing.location?.state].filter(Boolean).join(', ') ||
                'Pickup locality on request'}
              {typeof listing.distanceKm === 'number' && (
                <span className="font-semibold text-brand-700">· {listing.distanceKm} km away</span>
              )}
            </p>
          </div>

          <div className="card p-5">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-extrabold text-brand-700">
                {paise(listing.pricePerKgPaise)}
                <span className="text-lg">/kg</span>
              </span>
              <span className="chip bg-ink-100 text-ink-700">
                {kg(listing.availableQuantityKg)} available
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-ink-500">Condition</p>
                <p className="font-medium capitalize">{titleCase(listing.condition)}</p>
              </div>
              <div>
                <p className="text-ink-500">Quality grade</p>
                <p className="font-medium">{listing.qualityGrade}</p>
              </div>
              <div>
                <p className="text-ink-500">Min. purchase</p>
                <p className="font-medium">{minQty ? kg(minQty) : 'None'}</p>
              </div>
              <div>
                <p className="text-ink-500">Delivery</p>
                <p className="font-medium">{listing.deliveryTerms || 'Pickup from facility'}</p>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <label className="label" htmlFor="listingdetail-order-quantity-kg">Order quantity (kg)</label>
            <input id="listingdetail-order-quantity-kg"
              type="number"
              className="input"
              min={minQty || 0}
              max={maxQty}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setError('');
              }}
              placeholder={`Up to ${maxQty} kg`}
            />
            {breakdown && (
              <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-sm">
                <div className="flex justify-between text-ink-600">
                  <span>
                    {breakdown.weightKg} kg × {paise(listing.pricePerKgPaise)}/kg
                  </span>
                  <span>{paise(breakdown.subtotal)}</span>
                </div>
                <div className="flex justify-between text-ink-600">
                  <span>GST (estimated)</span>
                  <span>{paise(breakdown.tax)}</span>
                </div>
                <div className="flex justify-between border-t border-ink-100 pt-2 font-bold text-ink-900">
                  <span>Total</span>
                  <span>{paise(breakdown.total)}</span>
                </div>
                <p className="pt-1 text-xs text-ink-400">
                  Indicative only — GST and the final total are recomputed from the material's
                  pricing rules when you submit.
                </p>
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              onClick={() => {
                if (addToCart()) navigate('/cart');
              }}
              className="btn-primary mt-4 w-full"
              disabled={!user}
            >
              <ShoppingCart className="h-4 w-4" />
              {user ? 'Buy now' : 'Log in to order'}
            </button>
            <button
              onClick={() => {
                if (addToCart()) toast.success(`Added ${qty} kg to your cart`);
              }}
              className="btn-secondary mt-2 w-full"
              disabled={!user}
            >
              Add to cart
            </button>
            {!user && (
              <p className="mt-2 text-center text-xs text-ink-500">
                <Link className="font-semibold text-brand-700 hover:underline" to="/login">
                  Log in
                </Link>{' '}
                to place a purchase request.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-8 p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink-900">About this material</h2>
        <p className="text-sm leading-relaxed text-ink-600">{listing.description}</p>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
          <Package className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This lot has been inspected by MetalMundi. Placing a request reserves the quantity
            straight away, and our team reviews it before dispatch.
          </span>
        </div>
      </div>
    </div>
  );
}
