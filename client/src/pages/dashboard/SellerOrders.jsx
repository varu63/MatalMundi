import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen, Truck, MapPin, ShieldCheck } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, kg, paise, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

// What a seller may do once the buyer's address has been released.
const SELLER_NEXT = {
  CONFIRMED: 'PROCESSING',
  PROCESSING: 'READY_FOR_DISPATCH',
  READY_FOR_DISPATCH: 'DISPATCHED',
  DISPATCHED: 'DELIVERED',
};

const NEXT_LABEL = {
  PROCESSING: 'Start preparing',
  READY_FOR_DISPATCH: 'Mark ready for dispatch',
  DISPATCHED: 'Mark dispatched',
  DELIVERED: 'Mark delivered',
};

export default function SellerOrders() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    endpoints.orders
      .selling({ page, limit: 10 })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, toast]);

  useEffect(load, [load]);

  const advance = async (order, next) => {
    const warning =
      next === 'DELIVERED'
        ? 'Confirm the buyer received the material. This commits the reserved stock as sold.'
        : `Move ${order.orderNumber} to ${titleCase(next)}?`;
    if (!window.confirm(warning)) return;
    setBusyId(order.id);
    try {
      const res = await endpoints.orders.sellerStatus(order.id, { status: next });
      toast.success(res.data.message || 'Order updated');
      load();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <Spinner center />;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-ink-900">
          <PackageOpen className="h-4 w-4 text-brand-600" /> Purchase requests for your material
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">
          MetalMundi inspects each request and agrees the delivery charge with the buyer before
          their address is released to you.
        </p>
      </div>

      {data.data.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-14 text-center">
          <PackageOpen className="h-10 w-10 text-ink-300" />
          <p className="text-sm text-ink-500">No purchase requests yet.</p>
          <Link to="/marketplace" className="btn-secondary">
            Check the marketplace
          </Link>
        </div>
      ) : (
        data.data.map((order) => {
          const next = SELLER_NEXT[order.status];
          const released = order.addressReleased;
          return (
            <div key={order.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-ink-500">{order.orderNumber}</p>
                  <p className="mt-1 font-semibold text-ink-900">
                    {order.items
                      ?.map((it) => `${kg(it.weightKg)} × ${it.materialName || it.materialType}`)
                      .join(', ')}
                  </p>
                  <p className="text-xs text-ink-500">
                    Booked {dateTime(order.createdAt)} · inspection{' '}
                    {titleCase(order.inspectionStatus || 'pending')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.status} />
                  <span className="font-semibold text-ink-900">{paise(order.totalPaise)}</span>
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm">
                {released ? (
                  <>
                    <p className="flex items-center gap-1.5 font-semibold text-ink-800">
                      <MapPin className="h-4 w-4 text-brand-600" /> Buyer delivery details
                    </p>
                    <p className="text-ink-600">
                      {order.delivery?.name} · {order.delivery?.phone}
                    </p>
                    <p className="text-ink-600">
                      {order.delivery?.address}, {order.delivery?.city}, {order.delivery?.state}{' '}
                      {order.delivery?.postalCode}
                    </p>
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-ink-500">
                    <ShieldCheck className="h-4 w-4" />
                    City and state only — {order.delivery?.city || '—'}
                    {order.delivery?.state ? `, ${order.delivery.state}` : ''}. The full address is
                    released once the buyer confirms the final terms.
                  </p>
                )}
              </div>

              {order.termsRevision > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Quantity or charge was revised after booking ({order.termsRevision}×).
                </p>
              )}

              {order.deliveryChargePaise ? (
                <p className="mt-2 text-xs text-ink-500">
                  Delivery charge {paise(order.deliveryChargePaise)} ·{' '}
                  {titleCase(order.deliveryChargeStatus)}
                </p>
              ) : null}

              {next && released && (
                <button
                  className="btn-primary mt-3 inline-flex items-center gap-2"
                  disabled={busyId === order.id}
                  onClick={() => advance(order, next)}
                >
                  <Truck className="h-4 w-4" />
                  {busyId === order.id ? 'Updating…' : NEXT_LABEL[next]}
                </button>
              )}
            </div>
          );
        })
      )}

      <div className="card p-4">
        <Pagination page={page} pages={data.meta?.totalPages || 1} onChange={setPage} />
      </div>
    </div>
  );
}
