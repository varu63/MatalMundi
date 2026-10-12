import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, PackagePlus } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { paise, kg, dateTime } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Spinner from '../../components/Spinner';

export default function DashboardHome() {
  const [subs, setSubs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      endpoints.submissions.my({ limit: 4 }),
      endpoints.orders.my({ limit: 4 }),
    ])
      .then(([s, o]) => {
        setSubs(s.data.data.data || []);
        setOrders(o.data.data.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;

  const paid = subs.filter((s) => s.valuation?.estimatedPayoutPaise).reduce((sum, s) => sum + s.valuation.estimatedPayoutPaise, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-ink-500">Total submissions</p>
          <p className="mt-1 text-2xl font-bold text-ink-900">{subs.length}+</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-ink-500">Est. material value</p>
          <p className="mt-1 text-2xl font-bold text-brand-700">{paise(paid)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-ink-500">Active orders</p>
          <p className="mt-1 text-2xl font-bold text-ink-900">
            {orders.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED_BY_ADMIN'].includes(o.status)).length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <TrendingUp className="h-4 w-4 text-brand-600" /> Recent submissions
            </h2>
            <Link to="/dashboard/submissions" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {subs.length === 0 ? (
            <EmptyRow
              icon={<PackagePlus className="h-8 w-8" />}
              text="You haven't submitted any waste yet."
              to="/dashboard/submit"
              action="Submit waste"
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{s.materialType}</p>
                    <p className="text-xs text-ink-500">
                      {kg(s.quantityKg)} · {dateTime(s.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">Recent orders</h2>
            <Link to="/dashboard/orders" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {orders.length === 0 ? (
            <EmptyRow text="No purchase requests yet." to="/marketplace" action="Browse marketplace" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{o.orderNumber}</p>
                    <p className="text-xs text-ink-500">{paise(o.totalPaise)} · {dateTime(o.createdAt)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyRow({ icon, text, to, action }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {icon}
      <p className="text-sm text-ink-500">{text}</p>
      <Link to={to} className="btn-secondary">
        {action}
      </Link>
    </div>
  );
}