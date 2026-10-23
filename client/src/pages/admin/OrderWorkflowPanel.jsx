import { useState } from 'react';
import { ClipboardCheck, IndianRupee, ShieldCheck } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, kg, paise, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';

const CONDITIONS = ['LOOSE', 'BALED', 'SHREDDED', 'MIXED', 'USED'];

/**
 * Inspection → delivery charge → address release, in the order the business
 * rules require. The server rejects any step attempted out of turn, so every
 * button here maps to a real transition rather than a hidden control.
 */
export default function OrderWorkflowPanel({ order, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [actualQuantityKg, setActualQuantityKg] = useState('');
  const [condition, setCondition] = useState(order?.inspection?.materialCondition || 'LOOSE');
  const [chargeRupees, setChargeRupees] = useState('');
  const [chargeNotes, setChargeNotes] = useState('');

  if (!order) return null;

  const inspection = order.inspection || {};
  const bookedKg = (order.items || []).reduce((sum, i) => sum + Number(i.weightKg || 0), 0);

  const run = async (label, call) => {
    setBusy(label);
    try {
      const res = await call();
      toast.success(res.data.message || 'Updated');
      await onUpdated();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy('');
    }
  };

  const recordInspection = (status) =>
    run(`inspection:${status}`, () =>
      endpoints.admin.orderInspection(order.id, {
        status,
        ...(status === 'SCHEDULED' && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        ...(status === 'PASSED'
          ? {
              actualQuantityKg: Number(actualQuantityKg || bookedKg),
              materialCondition: condition,
              notes,
            }
          : {}),
        ...(status === 'FAILED' ? { failureReason, notes } : {}),
      })
    );

  const setCharge = () =>
    run('charge', () =>
      endpoints.admin.orderDeliveryCharge(order.id, {
        deliveryChargePaise: Math.round(Number(chargeRupees) * 100),
        notes: chargeNotes,
      })
    );

  const canInspect = !['REJECTED', 'CANCELLED', 'DELIVERED'].includes(order.status);
  const inspectionOpen =
    canInspect && ['PENDING', 'SCHEDULED', 'IN_PROGRESS'].includes(inspection.status || 'PENDING');
  const chargeAllowed =
    inspection.status === 'PASSED' &&
    !order.addressReleased &&
    ['ACCEPTED', 'INSPECTION_SCHEDULED', 'INSPECTION_IN_PROGRESS', 'DELIVERY_CHARGE_PENDING'].includes(
      order.status
    );

  return (
    <div className="space-y-4 border-t border-ink-100 pt-4">
      {/* ── Inspection ─────────────────────────────────────────────────── */}
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <ClipboardCheck className="h-4 w-4 text-brand-600" /> Inspection
          <span className="chip bg-ink-100 text-ink-700">{titleCase(inspection.status || 'PENDING')}</span>
        </p>
        {inspection.scheduledAt && (
          <p className="mt-1 text-xs text-ink-500">Scheduled for {dateTime(inspection.scheduledAt)}</p>
        )}
        {inspection.actualQuantityKg ? (
          <p className="mt-1 text-xs text-ink-500">
            Weighed out {kg(inspection.actualQuantityKg)}
            {inspection.quantityChangedFromKg &&
            inspection.quantityChangedFromKg !== inspection.actualQuantityKg
              ? ` (booked ${kg(inspection.quantityChangedFromKg)})`
              : ''}
            {inspection.materialCondition ? ` · ${titleCase(inspection.materialCondition)}` : ''}
          </p>
        ) : null}
        {inspection.failureReason && (
          <p className="mt-1 text-xs text-red-600">Failed: {inspection.failureReason}</p>
        )}
      </div>

      {inspectionOpen && (
        <div className="space-y-3 rounded-lg bg-ink-50 p-3">
          {inspection.status === 'PENDING' && (
            <>
              <label className="label" htmlFor="wf-scheduled-at">
                Inspection date and time
              </label>
              <input
                id="wf-scheduled-at"
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
              <button
                className="btn-secondary"
                disabled={busy || !scheduledAt}
                onClick={() => recordInspection('SCHEDULED')}
              >
                {busy === 'inspection:SCHEDULED' ? 'Saving…' : 'Schedule inspection'}
              </button>
            </>
          )}

          {inspection.status === 'SCHEDULED' && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => recordInspection('IN_PROGRESS')}
            >
              {busy === 'inspection:IN_PROGRESS' ? 'Saving…' : 'Start inspection'}
            </button>
          )}

          {inspection.status === 'IN_PROGRESS' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="wf-actual-qty">
                    Actual quantity (kg)
                  </label>
                  <input
                    id="wf-actual-qty"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="input"
                    placeholder={String(bookedKg)}
                    value={actualQuantityKg}
                    onChange={(e) => setActualQuantityKg(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="wf-condition">
                    Observed condition
                  </label>
                  <select
                    id="wf-condition"
                    className="input"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {titleCase(c)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="label" htmlFor="wf-notes">
                Inspection notes
              </label>
              <textarea
                id="wf-notes"
                className="input h-16"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What was checked, packaging, contamination…"
              />
              <label className="label" htmlFor="wf-fail-reason">
                Reason if the material fails
              </label>
              <textarea
                id="wf-fail-reason"
                className="input h-16"
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                placeholder="Required only when failing the order"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => recordInspection('PASSED')}
                >
                  {busy === 'inspection:PASSED' ? 'Saving…' : 'Mark passed'}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy || failureReason.trim().length < 5}
                  onClick={() => recordInspection('FAILED')}
                >
                  {busy === 'inspection:FAILED' ? 'Saving…' : 'Mark failed'}
                </button>
              </div>
              <p className="text-xs text-ink-500">
                A different weighed-out quantity re-prices the order and sends it back to the buyer
                for confirmation. Failing the inspection releases the stock reservation.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Delivery charge ───────────────────────────────────────────── */}
      <div className="rounded-lg bg-ink-50 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <IndianRupee className="h-4 w-4 text-brand-600" /> Delivery charge
          <span className="chip bg-white text-ink-700">{titleCase(order.deliveryChargeStatus)}</span>
        </p>
        {order.deliveryChargePaise ? (
          <p className="mt-1 text-xs text-ink-600">
            {paise(order.deliveryChargePaise)} · total {paise(order.totalPaise)} ·{' '}
            {order.deliveryChargeSetAt ? dateTime(order.deliveryChargeSetAt) : ''}
          </p>
        ) : null}

        {chargeAllowed ? (
          <div className="mt-3 space-y-2">
            <label className="label" htmlFor="wf-charge">
              Delivery / transportation charge (₹)
            </label>
            <input
              id="wf-charge"
              type="number"
              min="0"
              step="1"
              className="input"
              value={chargeRupees}
              onChange={(e) => setChargeRupees(e.target.value)}
              placeholder="e.g. 1200"
            />
            <label className="label" htmlFor="wf-charge-notes">
              Note for the buyer
            </label>
            <textarea
              id="wf-charge-notes"
              className="input h-16"
              value={chargeNotes}
              onChange={(e) => setChargeNotes(e.target.value)}
              placeholder="How the charge was worked out"
            />
            <button
              className="btn-primary"
              disabled={busy || !(Number(chargeRupees) >= 0) || chargeRupees === ''}
              onClick={setCharge}
            >
              {busy === 'charge' ? 'Saving…' : 'Send charge to buyer'}
            </button>
          </div>
        ) : (
          !order.addressReleased && (
            <p className="mt-2 text-xs text-ink-500">
              {inspection.status === 'PASSED'
                ? 'The buyer is reviewing the charge already sent.'
                : 'Available once the inspection has passed.'}
            </p>
          )
        )}
      </div>

      {/* ── Address release ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-ink-100 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <ShieldCheck className="h-4 w-4 text-brand-600" /> Buyer address release
        </p>
        {order.addressReleased ? (
          <p className="mt-1 text-xs text-ink-600">
            Released {order.addressReleasedAt ? dateTime(order.addressReleasedAt) : ''}
            {order.addressReleaseReason ? ` · ${order.addressReleaseReason}` : ''}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-500">
              The seller sees only the buyer's city and state until the inspection passes, the
              charge is sent, and the buyer confirms the final terms.
            </p>
            <button
              className="btn-secondary mt-2"
              disabled={busy || order.deliveryChargeStatus !== 'CONFIRMED'}
              onClick={() =>
                run('release', () =>
                  endpoints.admin.releaseOrderAddress(order.id, {
                    reason: 'Manually released by admin after buyer confirmation',
                  })
                )
              }
            >
              {busy === 'release' ? 'Working…' : 'Record release'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
