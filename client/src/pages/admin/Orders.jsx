import { useCallback, useEffect, useState } from 'react';
import { PackageSearch, Search, ShoppingBag, Truck } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, kg, paise, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';
import OrderWorkflowPanel from './OrderWorkflowPanel';

const STATUS_OPTIONS = [
  { key: '', label: 'All statuses' },
  { key: 'PENDING_ADMIN_APPROVAL', label: 'Awaiting approval' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'INSPECTION_SCHEDULED', label: 'Inspection scheduled' },
  { key: 'INSPECTION_IN_PROGRESS', label: 'Inspection in progress' },
  { key: 'DELIVERY_CHARGE_PENDING', label: 'Delivery charge pending' },
  { key: 'AWAITING_BUYER_CONFIRMATION', label: 'Awaiting buyer confirmation' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'READY_FOR_DISPATCH', label: 'Ready for dispatch' },
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

// Mirrors ORDER_TRANSITIONS on the server — only these moves are accepted.
// The server additionally gates CONFIRMED and dispatch statuses on the
// inspection/charge/buyer-confirmation workflow (see OrderWorkflowPanel).
const TRANSITIONS = {
  PENDING_ADMIN_APPROVAL: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  INSPECTION_SCHEDULED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  INSPECTION_IN_PROGRESS: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  DELIVERY_CHARGE_PENDING: ['AWAITING_BUYER_CONFIRMATION', 'REJECTED', 'CANCELLED'],
  AWAITING_BUYER_CONFIRMATION: ['REJECTED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

const REASON_REQUIRED = ['REJECTED', 'CANCELLED'];

export default function AdminOrders() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .orders({ page, limit: 10, status: status || undefined, search: search || undefined })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, status, search, toast]);

  useEffect(loadList, [loadList]);

  const openDetail = useCallback(
    async (id) => {
      if (selectedId === id) {
        setSelectedId(null);
        setSelected(null);
        return;
      }
      setSelectedId(id);
      setDetailLoading(true);
      setReason('');
      try {
        const res = await endpoints.admin.order(id);
        setSelected(res.data.data.order);
      } catch (err) {
        toast.error(handleError(err));
        setSelected(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedId, toast]
  );

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    const res = await endpoints.admin.order(selectedId);
    setSelected(res.data.data.order);
  }, [selectedId]);

  const move = useCallback(
    async (nextStatus) => {
      if (!selected) return;
      if (REASON_REQUIRED.includes(nextStatus) && reason.trim().length < 5) {
        toast.error('Add a short reason (at least 5 characters) for this decision.');
        return;
      }
      setBusy(true);
      try {
        const res = await endpoints.admin.orderStatus(selected.id, {
          status: nextStatus,
          reason: reason.trim(),
        });
        toast.success(res.data.message || `Order moved to ${nextStatus}`);
        setReason('');
        loadList();
        const fresh = await endpoints.admin.order(selected.id);
        setSelected(fresh.data.data.order);
      } catch (err) {
        toast.error(handleError(err));
      } finally {
        setBusy(false);
      }
    },
    [loadList, reason, selected, toast]
  );

  const allowed = selected ? TRANSITIONS[selected.status] || [] : [];

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <ShoppingBag className="h-4 w-4 text-brand-600" /> Orders
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Approve or decline purchase requests. Stock is reserved as soon as a request is
              placed, so accepting only confirms availability.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setSearch(e.target.search.value);
              }}
              className="relative"
            >
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
              <input
                name="search"
                defaultValue={search}
                placeholder="Search order number…"
                className="input w-56 pl-9"
              />
            </form>
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
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr,420px]">
        <div className="card overflow-hidden">
          {loading ? (
            <Spinner center />
          ) : data.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-500">No orders match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Buyer</th>
                    <th className="px-4 py-3">Material</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Placed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.data.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => openDetail(o.id)}
                      className={`cursor-pointer hover:bg-ink-50/50 ${
                        selectedId === o.id ? 'bg-brand-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
                      <td className="px-4 py-3">{o.buyer?.name || '—'}</td>
                      <td className="px-4 py-3">
                        {o.items?.length
                          ? `${o.items.length} item${o.items.length > 1 ? 's' : ''} · ${kg(
                              o.items.reduce((sum, i) => sum + Number(i.weightKg || 0), 0)
                            )}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold">{paise(o.totalPaise)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-500">{dateTime(o.createdAt)}</td>
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
            <Spinner label="Loading order…" />
          ) : !selected ? (
            <p className="py-10 text-center text-sm text-ink-500">
              Select an order to review its items and decide what happens next.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-xs text-ink-500">{selected.orderNumber}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink-900">{selected.buyer?.name}</h3>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-ink-500">
                  {selected.buyer?.email} · {selected.buyer?.phone || 'no phone'}
                </p>
              </div>

              <div className="rounded-lg bg-ink-50 p-3 text-sm">
                <p className="font-semibold text-ink-800">Delivery</p>
                <p className="text-ink-600">
                  {selected.delivery?.name || '—'}
                  {selected.delivery?.phone ? ` · ${selected.delivery.phone}` : ''}
                </p>
                <p className="text-ink-600">
                  {selected.delivery?.address}
                  {selected.delivery?.city ? `, ${selected.delivery.city}` : ''}
                  {selected.delivery?.state ? `, ${selected.delivery.state}` : ''}
                  {selected.delivery?.postalCode ? ` - ${selected.delivery.postalCode}` : ''}
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <p className="font-semibold text-ink-800">Items</p>
                {(selected.items || []).map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-ink-100 p-3">
                    <p className="font-medium text-ink-800">
                      {item.materialName || item.materialType || 'Material'}
                    </p>
                    <p className="text-xs text-ink-500">
                      {kg(item.weightKg)} · {item.qualityGrade} · {item.condition} ·{' '}
                      {paise(item.unitPricePaise)}/kg
                    </p>
                    <p className="text-sm font-semibold text-ink-900">{paise(item.subtotalPaise)}</p>
                  </div>
                ))}
                <div className="flex justify-between border-t border-ink-100 pt-2 text-sm">
                  <span className="text-ink-600">Total</span>
                  <span className="font-bold text-ink-900">{paise(selected.totalPaise)}</span>
                </div>
              </div>

              {selected.termsRevision > 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Terms revised {selected.termsRevision}× after booking — the buyer must confirm the
                  updated total before dispatch.
                </p>
              )}

              <OrderWorkflowPanel order={selected} onUpdated={refreshDetail} />

              {selected.rejectionReason && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Reason: {selected.rejectionReason}
                </p>
              )}

              {allowed.length > 0 ? (
                <div className="space-y-2 border-t border-ink-100 pt-4">
                  <label className="label" htmlFor="order-reason">
                    Reason (required to reject or cancel)
                  </label>
                  <textarea
                    id="order-reason"
                    className="input h-20"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Visible to the buyer"
                  />
                  <div className="flex flex-wrap gap-2">
                    {allowed.map((next) => (
                      <button
                        key={next}
                        className={next === 'ACCEPTED' ? 'btn-primary' : 'btn-secondary'}
                        disabled={busy}
                        onClick={() => move(next)}
                      >
                        {next === 'ACCEPTED' ? (
                          <>
                            <Truck className="h-4 w-4" /> Accept request
                          </>
                        ) : (
                          titleCase(next)
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 border-t border-ink-100 pt-4 text-sm text-ink-500">
                  <PackageSearch className="h-4 w-4" /> This order has reached a final state.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
