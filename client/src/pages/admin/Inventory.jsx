import { useCallback, useEffect, useState } from 'react';
import { Boxes, History } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, kg, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const STATUS_OPTIONS = [
  { key: '', label: 'All lots' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'DEPLETED', label: 'Depleted' },
  { key: 'ARCHIVED', label: 'Archived' },
];

export default function AdminInventory() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .inventory({ page, limit: 10, status: status || undefined })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, status, toast]);

  useEffect(loadList, [loadList]);

  const openDetail = useCallback(
    async (id) => {
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
        return;
      }
      setSelectedId(id);
      setDetailLoading(true);
      try {
        const res = await endpoints.admin.lot(id);
        setDetail(res.data.data);
      } catch (err) {
        toast.error(handleError(err));
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedId, toast]
  );

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <Boxes className="h-4 w-4 text-brand-600" /> Inventory
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Stock held per lot, traced back to the seller and the submission it came from.
            </p>
          </div>
          <select
            className="input w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.key || 'all'} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr,420px]">
        <div className="card overflow-hidden">
          {loading ? (
            <Spinner center />
          ) : data.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-500">No inventory lots match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Lot</th>
                    <th className="px-4 py-3">Material</th>
                    <th className="px-4 py-3">Seller</th>
                    <th className="px-4 py-3">Accepted</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3">Reserved</th>
                    <th className="px-4 py-3">Sold</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.data.map((lot) => (
                    <tr
                      key={lot.id}
                      onClick={() => openDetail(lot.id)}
                      className={`cursor-pointer hover:bg-ink-50/50 ${
                        selectedId === lot.id ? 'bg-brand-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{lot.lotNumber}</td>
                      <td className="px-4 py-3">
                        {lot.materialType}
                        <span className="block text-xs text-ink-500">
                          {lot.qualityGrade} · {lot.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3">{lot.seller?.name || '—'}</td>
                      <td className="px-4 py-3">{kg(lot.acceptedQuantityKg)}</td>
                      <td className="px-4 py-3 font-semibold">{kg(lot.availableQuantityKg)}</td>
                      <td className="px-4 py-3">{kg(lot.reservedQuantityKg)}</td>
                      <td className="px-4 py-3">{kg(lot.soldQuantityKg)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lot.lotStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pages={data.meta.totalPages || 1} onChange={setPage} />
        </div>

        <div className="card p-5">
          {detailLoading ? (
            <Spinner label="Loading lot…" />
          ) : !detail?.lot ? (
            <p className="py-10 text-center text-sm text-ink-500">
              Select a lot to see its stock movements.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-xs text-ink-500">{detail.lot.lotNumber}</p>
                <h3 className="mt-1 font-semibold text-ink-900">{detail.lot.materialType}</h3>
                <p className="text-xs text-ink-500">
                  {detail.lot.seller?.name} ·{' '}
                  {detail.lot.location?.city}
                  {detail.lot.location?.state ? `, ${detail.lot.location.state}` : ''}
                </p>
                <p className="text-xs text-ink-500">
                  Received {dateTime(detail.lot.receivedAt)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">Available</p>
                  <p className="font-semibold text-ink-900">{kg(detail.lot.availableQuantityKg)}</p>
                </div>
                <div className="rounded-lg bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">Reserved</p>
                  <p className="font-semibold text-ink-900">{kg(detail.lot.reservedQuantityKg)}</p>
                </div>
                <div className="rounded-lg bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">Sold</p>
                  <p className="font-semibold text-ink-900">{kg(detail.lot.soldQuantityKg)}</p>
                </div>
                <div className="rounded-lg bg-ink-50 p-3">
                  <p className="text-xs text-ink-500">Accepted</p>
                  <p className="font-semibold text-ink-900">{kg(detail.lot.acceptedQuantityKg)}</p>
                </div>
              </div>

              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                  <History className="h-4 w-4" /> Movements
                </p>
                {(detail.movements || []).length === 0 ? (
                  <p className="mt-2 text-sm text-ink-500">No movements recorded yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.movements.map((m) => (
                      <li key={m.id} className="rounded-lg border border-ink-100 p-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-ink-800">{titleCase(m.type)}</span>
                          <span className="text-ink-600">{kg(m.quantityKg)}</span>
                        </div>
                        <p className="mt-1 text-ink-500">{m.reason || '—'}</p>
                        <p className="mt-1 text-ink-400">{dateTime(m.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
