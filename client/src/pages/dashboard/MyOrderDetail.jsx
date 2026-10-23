import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Clock, IndianRupee } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, kg, paise } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Spinner from '../../components/Spinner';

const CHARGE_AWAITING = 'AWAITING_BUYER_CONFIRMATION';

export default function MyOrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await endpoints.orders.get(id);
      setOrder(res.data.data.order);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner center />;

  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/dashboard/orders" className="btn-secondary mt-4">
          <ArrowLeft className="h-4 w-4" /> Back to my orders
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const awaitingAction =
    order.status === 'AWAITING_BUYER_CONFIRMATION' && order.deliveryChargeStatus === CHARGE_AWAITING;
  const bookedKg = (order.items || []).reduce((s, i) => s + Number(i.weightKg || 0), 0);

  const act = async (kind) => {
    setBusy(kind);
    try {
      const res =
        kind === 'confirm'
          ? await endpoints.orders.confirm(order.id, { note })
          : await endpoints.orders.decline(order.id, { reason });
      toast.success(res.data.message || 'Order updated');
      const fresh = await endpoints.orders.get(order.id);
      setOrder(fresh.data.data.order);
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/dashboard/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> My orders
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-xs text-ink-500">{order.orderNumber}</p>
            <h2 className="text-lg font-semibold text-ink-900">Purchase request</h2>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-xs text-ink-500">Placed {dateTime(order.createdAt)}</p>
        {order.quoteIsProvisional && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            This total is provisional. The final amount depends on the inspection result and the
            delivery charge our team confirms with you.
          </p>
        )}
      </div>

      {awaitingAction && (
        <div className="card border-brand-200 bg-brand-50/40 p-5">
          <h3 className="flex items-center gap-2 font-semibold text-ink-900">
            <IndianRupee className="h-4 w-4 text-brand-600" /> Confirm your final terms
          </h3>
          <p className="mt-1 text-sm text-ink-600">
            The inspection {order.inspection?.status === 'PASSED' ? 'passed' : 'is recorded'} for{' '}
            {kg(bookedKg)} of material. Review the delivery charge below. Once you confirm, the
            seller receives your delivery address and can dispatch.
          </p>
          <ChargeBreakdown order={order} />
          <label className="label mt-3" htmlFor="order-confirm-note">
            Note for our team (optional)
          </label>
          <textarea
            id="order-confirm-note"
            className="input h-16"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything we should know before dispatch"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => act('confirm')}>
              <CheckCircle2 className="h-4 w-4" />
              {busy === 'confirm' ? 'Confirming…' : `Confirm ${paise(order.totalPaise)}`}
            </button>
            <details className="w-full">
              <summary className="cursor-pointer text-sm text-ink-600">
                Decline or request a review
              </summary>
              <label className="label mt-2" htmlFor="order-decline-reason">
                Why are you declining?
              </label>
              <textarea
                id="order-decline-reason"
                className="input h-16"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                className="btn-secondary mt-2"
                disabled={busy || reason.trim().length < 5}
                onClick={() => {
                  if (window.confirm('Cancel this purchase request? The stock reservation will be released.')) {
                    act('decline');
                  }
                }}
              >
                <XCircle className="h-4 w-4" />
                {busy === 'decline' ? 'Cancelling…' : 'Cancel this order'}
              </button>
            </details>
          </div>
        </div>
      )}

      <div className="card p-5">
        <h3 className="font-semibold text-ink-900">Materials</h3>
        <div className="mt-3 space-y-2">
          {(order.items || []).map((item, idx) => (
            <div key={idx} className="rounded-lg border border-ink-100 p-3 text-sm">
              <p className="font-medium text-ink-800">{item.materialName || item.materialType}</p>
              <p className="text-xs text-ink-500">
                {kg(item.weightKg)} × {paise(item.unitPricePaise)}/kg · grade {item.qualityGrade} ·{' '}
                {item.condition}
              </p>
              <p className="mt-1 font-semibold text-ink-900">{paise(item.subtotalPaise)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-ink-100 pt-3">
          <ChargeBreakdown order={order} />
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-ink-900">Delivery address</h3>
        <p className="mt-1 text-sm text-ink-600">
          {order.delivery?.name} · {order.delivery?.phone}
        </p>
        <p className="text-sm text-ink-600">
          {order.delivery?.address}, {order.delivery?.city}, {order.delivery?.state}{' '}
          {order.delivery?.postalCode}
        </p>
        <p className="mt-2 text-xs text-ink-500">
          {order.addressReleased
            ? `Shared with the seller ${order.addressReleasedAt ? dateTime(order.addressReleasedAt) : ''} after you confirmed the final terms.`
            : 'Hidden from the seller until you confirm the final terms.'}
        </p>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-ink-900">Progress</h3>
        <ol className="mt-3 space-y-3">
          {(order.statusHistory || []).map((entry, idx) => (
            <li key={idx} className="flex gap-3 text-sm">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <p className="font-medium text-ink-800">{titleOf(entry.status)}</p>
                <p className="text-xs text-ink-500">
                  {entry.at ? dateTime(entry.at) : ''}
                  {entry.note ? ` · ${entry.note}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {order.inspection?.notes && (
          <p className="mt-3 rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
            Inspection note: {order.inspection.notes}
          </p>
        )}
      </div>
    </div>
  );
}

function ChargeBreakdown({ order }) {
  const rows = [
    ['Material subtotal', paise(order.materialSubtotalPaise)],
    [`GST (${order.taxPercent || 0}%)`, paise(order.taxPaise)],
  ];
  if (Number(order.otherFeesPaise) > 0) rows.push(['Other fees', paise(order.otherFeesPaise)]);
  rows.push([
    order.deliveryChargeStatus === 'NOT_SET'
      ? 'Delivery charge (to be confirmed)'
      : 'Delivery / transportation',
    order.deliveryChargePaise ? paise(order.deliveryChargePaise) : '—',
  ]);

  return (
    <div className="mt-3 space-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between text-ink-600">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-ink-100 pt-2 font-bold text-ink-900">
        <span>Total ({order.currency || 'INR'})</span>
        <span>{paise(order.totalPaise)}</span>
      </div>
      {order.deliveryChargeNotes && (
        <p className="pt-1 text-xs text-ink-500">Note: {order.deliveryChargeNotes}</p>
      )}
    </div>
  );
}

const LABELS = {
  PENDING_ADMIN_APPROVAL: 'Purchase request submitted',
  ACCEPTED: 'Accepted by MetalMundi',
  INSPECTION_SCHEDULED: 'Inspection scheduled',
  INSPECTION_IN_PROGRESS: 'Inspection in progress',
  DELIVERY_CHARGE_PENDING: 'Delivery charge being prepared',
  AWAITING_BUYER_CONFIRMATION: 'Awaiting your confirmation',
  CONFIRMED: 'Confirmed — ready for the seller',
  PROCESSING: 'Processing',
  READY_FOR_DISPATCH: 'Ready for dispatch',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

function titleOf(status) {
  return LABELS[status] || status;
}
