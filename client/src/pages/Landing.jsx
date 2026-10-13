import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  ClipboardCheck,
  DollarSign,
  Globe,
  Package,
  PackagePlus,
  Recycle,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { endpoints } from '../lib/api';
import { paise, dateTime, firstImage } from '../lib/format';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { EmptyRow } from './dashboard/DashboardHome';
import heroImg from '../assets/hero.webp';

const FEATURES = [
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    tile: 'bg-blue-100 text-blue-600',
    title: 'Trusted Trade',
    body: 'Verified users & listings',
  },
  {
    icon: <DollarSign className="h-5 w-5" />,
    tile: 'bg-brand-100 text-brand-700',
    title: 'Fair Pricing',
    body: 'Get the best value',
  },
  {
    icon: <Globe className="h-5 w-5" />,
    tile: 'bg-orange-100 text-orange-600',
    title: 'Wide Network',
    body: 'Across multiple locations',
  },
  {
    icon: <Recycle className="h-5 w-5" />,
    tile: 'bg-teal-100 text-teal-600',
    title: 'Sustainable Future',
    body: 'Support recycling',
  },
];

const STEPS = [
  {
    icon: <PackagePlus className="h-5 w-5" />,
    title: 'List',
    body: 'List your material with photos and quantity.',
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" />,
    title: 'Get appraised',
    body: 'Our team verifies and values your lot.',
  },
  {
    icon: <Banknote className="h-5 w-5" />,
    title: 'Get paid',
    body: 'Receive your payout after pickup.',
  },
];

export default function Landing() {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    endpoints.marketplace
      .list({ limit: 6, sort: 'newest' })
      .then((res) => setListings(res.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    endpoints.orders
      .my({ limit: 4 })
      .then((res) => {
        if (!cancelled) setOrders(res.data.data || []);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const sellTo = user ? '/dashboard/submit' : '/register';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <section
        className="relative overflow-hidden rounded-2xl bg-ink-900 bg-cover shadow-lg"
        style={{ backgroundImage: `url(${heroImg})`, backgroundPosition: 'center right' }}
      >
        <div className="absolute inset-0 bg-[rgba(8,30,60,0.7)] md:hidden" />
        <div
          className="absolute inset-0 hidden md:block"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(8,30,60,0.9) 0%, rgba(8,30,60,0.6) 55%, rgba(8,30,60,0.2) 100%)',
          }}
        />
        <div className="relative px-6 py-16 text-center sm:px-10 sm:py-20">
          <h1 className="mx-auto max-w-xl text-3xl font-extrabold leading-tight text-white sm:text-4xl">
            Turn scrap into <span className="text-brand-400">value</span>. Buy and sell waste
            materials responsibly.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-ink-200 sm:text-lg">
            MetalMundi connects businesses that generate scrap with buyers who can reprocess it —
            with transparent pricing, verified sellers and audited transactions.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/marketplace" className="btn-primary px-6 py-3 text-base">
              Browse materials <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to={sellTo}
              className="btn bg-white/10 px-6 py-3 text-base text-white backdrop-blur hover:bg-white/20"
            >
              Sell your scrap
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="card flex items-start gap-3 p-4">
            <div
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${f.tile}`}
            >
              {f.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900">{f.title}</p>
              <p className="text-xs text-ink-500">{f.body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-6 grid auto-rows-fr gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <TrendingUp className="h-4 w-4 text-brand-600" /> Recent listings
            </h2>
            <Link
              to="/marketplace"
              className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {listings.length === 0 ? (
            <EmptyRow
              icon={<Package className="h-8 w-8" />}
              text="No listings yet."
              to={sellTo}
              action="Sell your first material"
              dark
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {listings.map((l) => (
                <li key={l.id}>
                  <Link to={`/marketplace/${l.id}`} className="flex items-center gap-3 py-3">
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-ink-100">
                      {firstImage(l.images) ? (
                        <img
                          src={firstImage(l.images)}
                          alt={l.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-ink-400">
                          <Recycle className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">
                      {l.title}
                    </p>
                    <p className="flex-shrink-0 text-sm font-bold text-brand-700">
                      {paise(l.pricePerKgPaise)}/kg
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {user ? (
          <section className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-ink-900">Recent orders</h2>
              <Link
                to="/dashboard/orders"
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                View all
              </Link>
            </div>
            {orders === null ? (
              <Spinner label="Loading orders…" />
            ) : orders.length === 0 ? (
              <EmptyRow
                text="No purchase requests yet."
                to="/marketplace"
                action="Browse marketplace"
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-800">{o.orderNumber}</p>
                      <p className="text-xs text-ink-500">
                        {paise(o.totalPaise)} · {dateTime(o.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="card p-6">
            <h2 className="mb-4 font-semibold text-ink-900">How it works</h2>
            <ol className="space-y-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink-800">
                      {i + 1}. {s.title}
                    </p>
                    <p className="text-xs text-ink-500">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </section>
    </div>
  );
}
