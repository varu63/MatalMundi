import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gavel } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { kg, paise, dateTime, firstImage } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'LEADING', label: 'Leading' },
  { key: 'OUTBID', label: 'Outbid' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
];

export default function MyBids() {
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    endpoints.auctions
      .myBids({ page, limit: 10, status: status || undefined })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [], meta: {} }))
      .finally(() => setLoading(false));
  }, [page, status]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-5">
        <div>
          <h2 className="font-semibold text-ink-900">My bids</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Every bid you placed, with its live standing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              className={`chip ${status === f.key ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
              onClick={() => {
                setStatus(f.key);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner center />
      ) : data.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Gavel className="h-10 w-10 text-ink-300" />
          <p className="text-sm text-ink-500">No bids here yet.</p>
          <Link to="/auctions" className="btn-primary">
            Browse auctions
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
                  <th className="px-5 py-3">My bid</th>
                  <th className="px-5 py-3">Current highest</th>
                  <th className="px-5 py-3">Standing</th>
                  <th className="px-5 py-3">Auction status</th>
                  <th className="px-5 py-3">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((b) => (
                  <tr key={b.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3">
                      <Link
                        to={`/auctions/${b.auction?.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {b.auction?.auctionNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2">
                        {firstImage(b.auction?.images) ? (
                          <img
                            src={firstImage(b.auction.images)}
                            alt=""
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : null}
                        {b.auction?.materialType} · {kg(b.auction?.quantityKg)}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold">{paise(b.bidPerKgPaise)}/kg</td>
                    <td className="px-5 py-3">
                      {b.auction?.currentHighestBidPerKgPaise
                        ? `${paise(b.auction.currentHighestBidPerKgPaise)}/kg`
                        : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.auction?.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{dateTime(b.createdAt)}</td>
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
