import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  Banknote,
  Gavel,
  PackageCheck,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { paise, kg, dateTime } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const STATUS_OPTIONS = [
  { key: '', label: 'All statuses' },
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
  { key: 'AWAITING_PICKUP', label: 'Awaiting pickup' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'ENDED', label: 'Ended' },
  { key: 'NO_BIDS', label: 'No bids' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const OPEN_ADJUSTABLE = ['PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE'];
const CANCELLABLE = [
  'PENDING_APPROVAL',
  'SCHEDULED',
  'ACTIVE',
  'AWAITING_PAYMENT',
  'AWAITING_PICKUP',
];

export default function AdminAuctions() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(null); // { auction, bids }
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .auctions({ page, limit: 10, status: status || undefined, search: search || undefined })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [], meta: {} }))
      .finally(() => setLoading(false));
  }, [page, status, search]);

  useEffect(loadList, [loadList]);

  const openDetail = useCallback(
    async (id) => {
      setDetailLoading(true);
      try {
        const [aRes, bRes] = await Promise.all([
          endpoints.admin.auction(id),
          endpoints.admin.auctionBids(id, { limit: 50 }),
        ]);
        setSelected({ auction: aRes.data.data.auction, bids: bRes.data.data || [] });
      } catch (err) {
        toast.error(handleError(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  const afterAction = useCallback(
    async (message) => {
      toast.success(message);
      loadList();
      if (selected?.auction?.id) await openDetail(selected.auction.id);
    },
    [loadList, openDetail, selected, toast]
  );

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <Gavel className="h-4 w-4 text-brand-600" /> Auction management
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Approve, adjust, settle and close live bidding. Auction orders are handled here, not
              in Orders.
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
                placeholder="Search auctions…"
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

      <div className="grid gap-6 xl:grid-cols-[1fr,560px]">
        {/* List */}
        <div className="card overflow-hidden">
          {loading ? (
            <Spinner center />
          ) : data.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-500">No auctions match.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Auction</th>
                      <th className="px-4 py-3">Seller</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Highest</th>
                      <th className="px-4 py-3">Bids</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Ends</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.data.map((a) => (
                      <tr
                        key={a.id}
                        className={`hover:bg-ink-50/50 ${selected?.auction?.id === a.id ? 'bg-brand-50/60' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{a.auctionNumber}</td>
                        <td className="px-4 py-3">{a.seller?.name || '—'}</td>
                        <td className="px-4 py-3">
                          {a.materialType} · {kg(a.quantityKg)}
                        </td>
                        <td className="px-4 py-3">
                          {a.currentHighestBidPerKgPaise
                            ? `${paise(a.currentHighestBidPerKgPaise)}/kg`
                            : '—'}
                        </td>
                        <td className="px-4 py-3">{a.bidCount}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-500">
                          {a.endAt ? dateTime(a.endAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="btn-secondary px-3 py-1.5 text-xs"
                            onClick={() => openDetail(a.id)}
                          >
                            Manage
                          </button>
                        </td>
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

        {/* Detail */}
        <div className="xl:sticky xl:top-20 xl:self-start">
          {detailLoading ? (
            <div className="card">
              <Spinner center />
            </div>
          ) : selected ? (
            <AuctionPanel
              key={selected.auction.id + selected.auction.updatedAt}
              auction={selected.auction}
              bids={selected.bids}
              onDone={afterAction}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="card flex flex-col items-center gap-2 p-10 text-center">
              <SlidersHorizontal className="h-8 w-8 text-ink-300" />
              <p className="text-sm text-ink-500">Select an auction to manage it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AuctionPanel({ auction: a, bids, onDone, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [approve, setApprove] = useState({
    durationMinutes: String(a.durationMinutes || 30),
    startAt: '',
    startingPrice: a.startingPricePerKgPaise ? String(a.startingPricePerKgPaise / 100) : '',
    note: '',
  });
  const [reject, setReject] = useState({ reason: '' });
  const [adjust, setAdjust] = useState({
    startingPrice: a.startingPricePerKgPaise ? String(a.startingPricePerKgPaise / 100) : '',
    minIncrementType: a.minIncrementType,
    minIncrementValue: String(a.minIncrementValue ?? ''),
    antiSnipingEnabled: a.antiSnipingEnabled,
    antiSnipingWindowSeconds: String(a.antiSnipingWindowSeconds ?? 30),
    antiSnipingExtensionSeconds: String(a.antiSnipingExtensionSeconds ?? 60),
    durationMinutes: String(a.durationMinutes || 30),
    inspectionNotes: a.inspectionNotes || '',
  });
  const [cancel, setCancel] = useState({ reason: '' });
  const [payment, setPayment] = useState({ provider: 'MANUAL', reference: '', note: '' });
  const [complete, setComplete] = useState({
    verifiedQuantityKg: String(a.quantityKg || ''),
    note: '',
  });

  const run = async (key, fn, successMessage) => {
    setBusy(key);
    try {
      await fn();
      await onDone(successMessage);
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy('');
    }
  };

  const isPending = a.status === 'PENDING_APPROVAL';
  const canAdjust = OPEN_ADJUSTABLE.includes(a.status) && a.bidCount === 0;
  const canCancel = CANCELLABLE.includes(a.status);
  const s = a.settlement || {};

  return (
    <div className="card max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-100 bg-white p-5">
        <div>
          <p className="font-mono text-xs text-ink-500">{a.auctionNumber}</p>
          <h3 className="font-semibold text-ink-900">
            {a.materialType} · {kg(a.quantityKg)}
          </h3>
          <p className="text-xs text-ink-500">
            {a.seller?.name} · {a.seller?.phone || a.seller?.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={a.status} />
          <button className="text-ink-400 hover:text-ink-700" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {a.rejectionReason && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Rejected: {a.rejectionReason}
          </p>
        )}
        {a.cancellationReason && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Cancelled: {a.cancellationReason}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="Starting" value={`${paise(a.startingPricePerKgPaise)}/kg`} />
          <Field
            label="Expected"
            value={a.expectedPricePerKgPaise ? `${paise(a.expectedPricePerKgPaise)}/kg` : '—'}
          />
          <Field
            label="Min acceptable"
            value={a.minAcceptableBidPerKgPaise ? `${paise(a.minAcceptableBidPerKgPaise)}/kg` : '—'}
          />
          <Field
            label="Reserve"
            value={
              a.reservePricePerKgPaise != null ? `${paise(a.reservePricePerKgPaise)}/kg` : 'None'
            }
          />
          <Field
            label="Current highest"
            value={
              a.currentHighestBidPerKgPaise ? `${paise(a.currentHighestBidPerKgPaise)}/kg` : '—'
            }
          />
          <Field
            label="Increment"
            value={
              a.minIncrementType === 'PERCENT'
                ? `${a.minIncrementValue}%`
                : `${paise(a.minIncrementValue)}/kg`
            }
          />
          <Field
            label="Anti-sniping"
            value={a.antiSnipingEnabled ? `+${a.antiSnipingExtensionSeconds}s` : 'Off'}
          />
          <Field label="Duration" value={`${a.durationMinutes} min`} />
          <Field label="Extensions" value={a.extensionCount || 0} />
          <Field label="Start" value={a.startAt ? dateTime(a.startAt) : '—'} />
          <Field label="End" value={a.endAt ? dateTime(a.endAt) : '—'} />
          <Field label="Bidders" value={`${a.bidderCount} (${a.bidCount} bids)`} />
        </dl>

        {(s.grossPaise != null || a.winningBidPerKgPaise) && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-brand-800">
              <BadgeCheck className="h-4 w-4" /> Settlement
              {s.quantitySource === 'VERIFIED' && (
                <span className="chip bg-white text-brand-700">verified qty</span>
              )}
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Field
                label="Winning bid"
                value={a.winningBidPerKgPaise ? `${paise(a.winningBidPerKgPaise)}/kg` : '—'}
              />
              <Field label="Gross" value={paise(s.grossPaise)} />
              <Field label="Platform fee" value={`- ${paise(s.platformFeePaise)}`} />
              <Field label="Pickup cost" value={`- ${paise(s.pickupCostPaise)}`} />
              <Field label="Tax (buyer)" value={`+ ${paise(s.taxPaise)}`} />
              <Field label="Buyer payable" value={paise(s.buyerPayablePaise)} />
              <Field label="Seller payout" value={paise(s.sellerPayoutPaise)} />
              {s.payoutClampedToZero && <Field label="Note" value="payout clamped at zero" />}
            </div>
            {Array.isArray(a.adjustments) && a.adjustments.length > 0 && (
              <div className="mt-3 border-t border-brand-100 pt-3 text-xs text-ink-600">
                {a.adjustments.map((adj, i) => (
                  <p key={i}>
                    Quantity adjusted {adj.fromQuantityKg} kg → {adj.toQuantityKg} kg ({adj.note})
                  </p>
                ))}
              </div>
            )}
            {a.order && (
              <p className="mt-2 text-xs text-ink-600">
                Order <span className="font-mono">{a.order.orderNumber}</span> · {a.order.status} ·{' '}
                {a.order.paymentStatus}
              </p>
            )}
          </div>
        )}

        {/* Bids */}
        <div>
          <h4 className="text-sm font-semibold text-ink-900">
            Bid history (identities visible to admins)
          </h4>
          {bids.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">No bids yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100 text-sm">
              {bids.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{paise(b.bidPerKgPaise)}/kg</span>
                    <span className="font-mono text-xs text-ink-400">{b.bidderId}</span>
                    <StatusBadge status={b.status} />
                  </span>
                  <span className="text-xs text-ink-400">{dateTime(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-4 border-t border-ink-100 pt-4">
          {isPending && (
            <>
              <ActionBox icon={BadgeCheck} title="Approve auction" tone="brand">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-ink-500">
                    Duration (minutes)
                    <input
                      type="number"
                      className="input mt-1"
                      value={approve.durationMinutes}
                      onChange={(e) =>
                        setApprove((v) => ({ ...v, durationMinutes: e.target.value }))
                      }
                    />
                  </label>
                  <label className="text-xs text-ink-500">
                    Start at (optional — defaults to now)
                    <input
                      type="datetime-local"
                      className="input mt-1"
                      value={approve.startAt}
                      onChange={(e) => setApprove((v) => ({ ...v, startAt: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs text-ink-500">
                    Starting price ₹/kg (optional — seller's value:{' '}
                    {paise(a.startingPricePerKgPaise)})
                    <input
                      type="number"
                      className="input mt-1"
                      value={approve.startingPrice}
                      onChange={(e) => setApprove((v) => ({ ...v, startingPrice: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs text-ink-500">
                    Note (audited)
                    <input
                      className="input mt-1"
                      value={approve.note}
                      onChange={(e) => setApprove((v) => ({ ...v, note: e.target.value }))}
                    />
                  </label>
                </div>
                <button
                  className="btn-primary mt-2"
                  disabled={busy === 'approve'}
                  onClick={() =>
                    run(
                      'approve',
                      () =>
                        endpoints.admin.auctionAction(a.id, 'approve', {
                          durationMinutes: Number(approve.durationMinutes) || undefined,
                          startAt: approve.startAt
                            ? new Date(approve.startAt).toISOString()
                            : undefined,
                          startingPricePerKgPaise: approve.startingPrice
                            ? Math.round(Number(approve.startingPrice) * 100)
                            : undefined,
                          note: approve.note || undefined,
                        }),
                      'Auction approved'
                    )
                  }
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve & schedule'}
                </button>
              </ActionBox>

              <ActionBox icon={Ban} title="Reject auction" tone="red">
                <input
                  className="input"
                  placeholder="Reason (shown to the seller)"
                  value={reject.reason}
                  onChange={(e) => setReject({ reason: e.target.value })}
                />
                <button
                  className="btn-secondary mt-2 text-red-600"
                  disabled={busy === 'reject' || reject.reason.trim().length < 3}
                  onClick={() =>
                    run(
                      'reject',
                      () =>
                        endpoints.admin.auctionAction(a.id, 'reject', {
                          reason: reject.reason.trim(),
                        }),
                      'Auction rejected'
                    )
                  }
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </ActionBox>
            </>
          )}

          {canAdjust && (
            <ActionBox icon={SlidersHorizontal} title="Adjust rules (no bids yet)" tone="ink">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-ink-500">
                  Starting price ₹/kg
                  <input
                    type="number"
                    className="input mt-1"
                    value={adjust.startingPrice}
                    onChange={(e) => setAdjust((v) => ({ ...v, startingPrice: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Increment type
                  <select
                    className="input mt-1"
                    value={adjust.minIncrementType}
                    onChange={(e) => setAdjust((v) => ({ ...v, minIncrementType: e.target.value }))}
                  >
                    <option value="FIXED">Fixed (paise/kg)</option>
                    <option value="PERCENT">Percent (%)</option>
                  </select>
                </label>
                <label className="text-xs text-ink-500">
                  Increment value ({adjust.minIncrementType === 'FIXED' ? 'paise/kg' : '%'})
                  <input
                    type="number"
                    className="input mt-1"
                    value={adjust.minIncrementValue}
                    onChange={(e) =>
                      setAdjust((v) => ({ ...v, minIncrementValue: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Duration (minutes)
                  <input
                    type="number"
                    className="input mt-1"
                    value={adjust.durationMinutes}
                    onChange={(e) => setAdjust((v) => ({ ...v, durationMinutes: e.target.value }))}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    checked={adjust.antiSnipingEnabled}
                    onChange={(e) =>
                      setAdjust((v) => ({ ...v, antiSnipingEnabled: e.target.checked }))
                    }
                  />
                  Anti-sniping extension
                </label>
                {adjust.antiSnipingEnabled && (
                  <>
                    <label className="text-xs text-ink-500">
                      Window (s)
                      <input
                        type="number"
                        className="input mt-1"
                        value={adjust.antiSnipingWindowSeconds}
                        onChange={(e) =>
                          setAdjust((v) => ({ ...v, antiSnipingWindowSeconds: e.target.value }))
                        }
                      />
                    </label>
                    <label className="text-xs text-ink-500">
                      Extension (s)
                      <input
                        type="number"
                        className="input mt-1"
                        value={adjust.antiSnipingExtensionSeconds}
                        onChange={(e) =>
                          setAdjust((v) => ({ ...v, antiSnipingExtensionSeconds: e.target.value }))
                        }
                      />
                    </label>
                  </>
                )}
              </div>
              <label className="mt-2 block text-xs text-ink-500">
                Inspection notes
                <input
                  className="input mt-1"
                  value={adjust.inspectionNotes}
                  onChange={(e) => setAdjust((v) => ({ ...v, inspectionNotes: e.target.value }))}
                />
              </label>
              <button
                className="btn-secondary mt-2"
                disabled={busy === 'adjust'}
                onClick={() =>
                  run(
                    'adjust',
                    () =>
                      endpoints.admin.updateAuction(a.id, {
                        startingPricePerKgPaise: adjust.startingPrice
                          ? Math.round(Number(adjust.startingPrice) * 100)
                          : undefined,
                        minIncrementType: adjust.minIncrementType,
                        minIncrementValue: Number(adjust.minIncrementValue) || undefined,
                        durationMinutes: Number(adjust.durationMinutes) || undefined,
                        antiSnipingEnabled: adjust.antiSnipingEnabled,
                        antiSnipingWindowSeconds: adjust.antiSnipingEnabled
                          ? Number(adjust.antiSnipingWindowSeconds)
                          : undefined,
                        antiSnipingExtensionSeconds: adjust.antiSnipingEnabled
                          ? Number(adjust.antiSnipingExtensionSeconds)
                          : undefined,
                        inspectionNotes: adjust.inspectionNotes || undefined,
                      }),
                    'Auction updated'
                  )
                }
              >
                {busy === 'adjust' ? 'Saving…' : 'Save adjustments'}
              </button>
            </ActionBox>
          )}

          {a.status === 'AWAITING_PAYMENT' && (
            <ActionBox icon={Banknote} title="Record payment received" tone="brand">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-ink-500">
                  Provider
                  <select
                    className="input mt-1"
                    value={payment.provider}
                    onChange={(e) => setPayment((v) => ({ ...v, provider: e.target.value }))}
                  >
                    {['MANUAL', 'UPI', 'NEFT', 'RTGS', 'CASH'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-500">
                  Reference
                  <input
                    className="input mt-1"
                    value={payment.reference}
                    onChange={(e) => setPayment((v) => ({ ...v, reference: e.target.value }))}
                  />
                </label>
              </div>
              <button
                className="btn-primary mt-2"
                disabled={busy === 'pay'}
                onClick={() =>
                  run(
                    'pay',
                    () => endpoints.admin.auctionAction(a.id, 'payment-received', payment),
                    'Payment recorded'
                  )
                }
              >
                {busy === 'pay' ? 'Recording…' : 'Mark payment received'}
              </button>
            </ActionBox>
          )}

          {a.status === 'AWAITING_PICKUP' && (
            <ActionBox icon={PackageCheck} title="Complete at pickup" tone="brand">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-ink-500">
                  Verified quantity (kg) — listed: {kg(a.quantityKg)}
                  <input
                    type="number"
                    className="input mt-1"
                    value={complete.verifiedQuantityKg}
                    onChange={(e) =>
                      setComplete((v) => ({ ...v, verifiedQuantityKg: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Note
                  <input
                    className="input mt-1"
                    value={complete.note}
                    onChange={(e) => setComplete((v) => ({ ...v, note: e.target.value }))}
                  />
                </label>
              </div>
              <p className="mt-1 text-xs text-ink-400">
                If the verified weight differs from the listed weight, the settlement is recomputed
                and logged.
              </p>
              <button
                className="btn-primary mt-2"
                disabled={busy === 'complete'}
                onClick={() =>
                  run(
                    'complete',
                    () =>
                      endpoints.admin.auctionAction(a.id, 'complete', {
                        verifiedQuantityKg: Number(complete.verifiedQuantityKg) || undefined,
                        note: complete.note || undefined,
                      }),
                    'Auction completed'
                  )
                }
              >
                {busy === 'complete' ? 'Completing…' : 'Mark complete'}
              </button>
            </ActionBox>
          )}

          {canCancel && (
            <ActionBox icon={ShieldAlert} title="Cancel auction" tone="red">
              <input
                className="input"
                placeholder="Reason (required — bidders and seller are notified)"
                value={cancel.reason}
                onChange={(e) => setCancel({ reason: e.target.value })}
              />
              <p className="mt-1 text-xs text-ink-400">
                If a winner already exists, their order is cancelled too. The runner-up is never
                auto-awarded.
              </p>
              <button
                className="btn-secondary mt-2 text-red-600"
                disabled={busy === 'cancel' || cancel.reason.trim().length < 3}
                onClick={() =>
                  run(
                    'cancel',
                    () =>
                      endpoints.admin.auctionAction(a.id, 'cancel', {
                        reason: cancel.reason.trim(),
                      }),
                    'Auction cancelled'
                  )
                }
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel auction'}
              </button>
            </ActionBox>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function ActionBox({ icon: Icon, title, tone = 'ink', children }) {
  const border =
    tone === 'red'
      ? 'border-red-100 bg-red-50/40'
      : tone === 'brand'
        ? 'border-brand-100 bg-brand-50/40'
        : 'border-ink-100 bg-ink-50/40';
  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <Icon className="h-4 w-4 text-ink-500" /> {title}
      </h4>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}
