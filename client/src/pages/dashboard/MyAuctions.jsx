import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gavel } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { kg, paise, dateTime, firstImage } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

export default function MyAuctions() {
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    endpoints.auctions
      .my({ page, limit: 10 })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [], meta: {} }))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <Spinner center />;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-5">
        <h2 className="font-semibold text-ink-900">My auctions</h2>
        <p className="mt-0.5 text-xs text-ink-500">Auctions you created from waste submissions.</p>
      </div>
      {data.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Gavel className="h-10 w-10 text-ink-300" />
          <p className="text-sm text-ink-500">You haven't created any auctions yet.</p>
          <Link to="/dashboard/submit" className="btn-primary">
            Start an auction
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Auction</th>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Quantity</th>
                  <th className="px-5 py-3">Starting</th>
                  <th className="px-5 py-3">Highest bid</th>
                  <th className="px-5 py-3">Bids</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3">
                      <Link
                        to={`/auctions/${a.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {a.auctionNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2">
                        {firstImage(a.images) ? (
                          <img
                            src={firstImage(a.images)}
                            alt=""
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : null}
                        {a.materialType}
                      </span>
                    </td>
                    <td className="px-5 py-3">{kg(a.quantityKg)}</td>
                    <td className="px-5 py-3">{paise(a.startingPricePerKgPaise)}/kg</td>
                    <td className="px-5 py-3">
                      {a.currentHighestBidPerKgPaise ? (
                        <span className="font-semibold text-brand-700">
                          {paise(a.currentHighestBidPerKgPaise)}/kg
                        </span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">{a.bidCount}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{a.endAt ? dateTime(a.endAt) : '—'}</td>
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
