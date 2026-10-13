import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { paise, kg, dateTime } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

export default function MyOrders() {
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    endpoints.orders
      .my({ page, limit: 10 })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [], meta: {} }))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <Spinner center />;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-5">
        <h2 className="font-semibold text-ink-900">My purchase requests</h2>
      </div>
      {data.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <ShoppingBag className="h-10 w-10 text-ink-300" />
          <p className="text-sm text-ink-500">No purchase requests yet.</p>
          <Link to="/marketplace" className="btn-primary">
            Browse marketplace
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Order</th>
                  <th className="px-5 py-3">Items</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((o) => (
                  <tr key={o.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3 font-medium text-ink-800">{o.orderNumber}</td>
                    <td className="px-5 py-3 text-ink-600">
                      {o.items.map((it) => `${kg(it.weightKg)} × ${it.listing?.title || 'material'}`).join(', ')}
                    </td>
                    <td className="px-5 py-3 font-semibold">{paise(o.totalPaise)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4">
            <Pagination page={page} pages={data.meta?.totalPages || 1} onChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}