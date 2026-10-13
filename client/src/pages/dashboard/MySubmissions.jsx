import { useEffect, useState } from 'react';
import { endpoints } from '../../lib/api';
import { kg, paise, dateTime, firstImage } from '../../lib/format';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';
import { PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function MySubmissions() {
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    endpoints.submissions
      .my({ page, limit: 10 })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [], meta: {} }))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <Spinner center />;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-5">
        <h2 className="font-semibold text-ink-900">My waste submissions</h2>
      </div>
      {data.data.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <PackagePlus className="h-10 w-10 text-ink-300" />
          <p className="text-sm text-ink-500">You haven't submitted any waste yet.</p>
          <Link to="/dashboard/submit" className="btn-primary">
            Submit waste
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Submission</th>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Quantity</th>
                  <th className="px-5 py-3">Est. payout</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((s) => (
                  <tr key={s.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3 font-medium text-ink-800">{s.submissionNumber}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2">
                        {firstImage(s.images) ? (
                          <img
                            src={firstImage(s.images)}
                            alt=""
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : null}
                        {s.materialType}
                      </span>
                    </td>
                    <td className="px-5 py-3">{kg(s.quantityKg)}</td>
                    <td className="px-5 py-3">{paise(s.valuation?.estimatedPayoutPaise)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{dateTime(s.createdAt)}</td>
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
