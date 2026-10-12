import { useEffect, useState } from 'react';
import { endpoints } from '../../lib/api';
import { paise, kg } from '../../lib/format';
import Spinner from '../../components/Spinner';
import { Link } from 'react-router-dom';

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    endpoints.admin
      .dashboard()
      .then((r) => setStats(r.data.data.stats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner center />;
  if (!stats) return <p className="text-sm text-ink-500">Could not load dashboard stats.</p>;

  const cards = [
    { label: 'Pending approval', value: stats.pendingSubmissions, to: '/admin/submissions' },
    { label: 'Under review', value: stats.underReview, to: '/admin/submissions' },
    { label: 'Approved · awaiting pickup', value: stats.approvedAwaitingPublication, to: '/admin/submissions' },
    { label: 'Live listings', value: stats.publishedListings, to: '/admin/listings' },
    { label: 'Orders awaiting decision', value: stats.pendingOrders, to: '/admin/orders' },
    { label: 'In progress orders', value: stats.acceptedOrders, to: '/admin/orders' },
    { label: 'Delivered', value: stats.completedDeliveries, to: '/admin/orders' },
    { label: 'Registered users', value: stats.totalUsers, to: '/admin/users' },
  ];

  const bars = [
    { label: 'Available stock', value: stats.activeInventoryKg, max: stats.totalCollectedKg, unit: 'kg' },
    { label: 'Reserved', value: stats.reservedKg, max: stats.totalCollectedKg, unit: 'kg' },
    { label: 'Sold', value: stats.totalSoldKg, max: stats.totalCollectedKg, unit: 'kg' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="card p-5 transition hover:shadow-lg">
            <p className="text-sm text-ink-500">{c.label}</p>
            <p className="mt-1 text-3xl font-bold text-ink-900">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="card p-6">
        <h2 className="mb-4 font-semibold text-ink-900">Inventory health</h2>
        <p className="mb-4 text-sm text-ink-500">
          Total material collected: <span className="font-semibold">{kg(stats.totalCollectedKg)}</span>
        </p>
        <div className="space-y-3 text-sm">
          {bars.map((b) => (
            <Bar key={b.label} {...b} />
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 font-semibold text-ink-900">Live value snapshot</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-ink-50 p-4">
            <p className="text-ink-500">Material at market rate</p>
            <p className="mt-1 text-xl font-bold text-ink-900">{mktValue(stats)}</p>
          </div>
          <div className="rounded-lg bg-brand-50 p-4">
            <p className="text-brand-800">Reserved for accepted orders</p>
            <p className="mt-1 text-xl font-bold text-brand-800">{reservedValue(stats)}</p>
          </div>
          <div className="rounded-lg bg-ink-50 p-4 text-ink-500">
            <p>Order cashflow</p>
            <p className="mt-1 text-xl font-bold text-ink-900">Tracked in Orders</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Approximate market value using the platform's indicative average ₹/kg.
function ratePallmaGreek() {
  return 2000;
}

function mktValue(s) {
  return paise(s.activeInventoryKg * ratePallmaGreek());
}
function reservedValue(s) {
  return paise(s.reservedKg * ratePallmaGreek());
}

function Bar({ label, value = 0, max = 0, unit }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-ink-600">
        <span>{label}</span>
        <span className="font-semibold">
          {value} {unit}
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-100">
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}