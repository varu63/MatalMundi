import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Ban,
  CalendarClock,
  ClipboardList,
  PackageCheck,
  Search,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { paise, kg, dateTime, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const STATUS_OPTIONS = [
  { key: '', label: 'All statuses' },
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'UNDER_REVIEW', label: 'Under review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PICKUP_SCHEDULED', label: 'Pickup scheduled' },
  { key: 'COLLECTED', label: 'Collected' },
  { key: 'PURCHASED', label: 'Published' },
  { key: 'REJECTED', label: 'Rejected' },
];

const PHOTO_SIDES = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['weightEvidence', 'Weight evidence'],
];

export default function AdminSubmissions() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .submissions({ page, limit: 10, status: status || undefined, search: search || undefined })
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
      setSelectedId(id);
      setDetailLoading(true);
      try {
        const res = await endpoints.admin.submission(id);
        setSelected(res.data.data.submission);
      } catch (err) {
        toast.error(handleError(err));
        setSelected(null);
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
      if (selectedId) await openDetail(selectedId);
    },
    [loadList, openDetail, selectedId, toast]
  );

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <ClipboardList className="h-4 w-4 text-brand-600" /> Submissions
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Review seller photos and requested prices, then approve → collect → publish to the
              marketplace.
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
                placeholder="Search submissions…"
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
        <div className="card overflow-hidden">
          {loading ? (
            <Spinner center />
          ) : data.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-500">No submissions match.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Submission</th>
                      <th className="px-4 py-3">Seller</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Demanded</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Submitted</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.data.map((s) => (
                      <tr
                        key={s.id}
                        className={`hover:bg-ink-50/50 ${selectedId === s.id ? 'bg-brand-50/60' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{s.submissionNumber}</td>
                        <td className="px-4 py-3">{s.seller?.name || '—'}</td>
                        <td className="px-4 py-3">
                          {s.materialType} · {kg(s.quantityKg)}
                        </td>
                        <td className="px-4 py-3">
                          {s.demandBasis === 'PER_KG'
                            ? `${paise(s.demandedPerKgPaise)}/kg`
                            : paise(s.demandedTotalPaise)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-500">{dateTime(s.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="btn-secondary px-3 py-1.5 text-xs"
                            onClick={() => openDetail(s.id)}
                          >
                            Review
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

        <div className="xl:sticky xl:top-20 xl:self-start">
          {detailLoading ? (
            <div className="card">
              <Spinner center />
            </div>
          ) : selected ? (
            <SubmissionPanel
              key={selected.id + selected.updatedAt}
              submission={selected}
              onDone={afterAction}
              onClose={() => {
                setSelected(null);
                setSelectedId(null);
              }}
            />
          ) : (
            <div className="card flex flex-col items-center gap-2 p-10 text-center">
              <SlidersHorizontal className="h-8 w-8 text-ink-300" />
              <p className="text-sm text-ink-500">Select a submission to review it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmissionPanel({ submission: s, onDone, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState({ note: '', pickupDate: '' });
  const [approve, setApprove] = useState({ proposedPricePerKg: '', note: '' });
  const [reject, setReject] = useState({ reason: '' });
  const [collect, setCollect] = useState({ acceptedQuantityKg: String(s.quantityKg || '') });
  const [publish, setPublish] = useState({
    title: s.materialType ? `${s.materialType} — ${s.quantityKg} kg` : '',
    description: s.description || '',
    pricePerKg: '',
    minPurchaseKg: '0',
    deliveryTerms: 'Pickup from MetalMundi facility',
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

  const v = s.valuation || {};
  const pickup = s.pickup || {};
  const photos = [
    ...PHOTO_SIDES.map(([k]) => s.images?.[k]?.url),
    ...(s.images?.additional || []).map((i) => i?.url),
  ].filter(Boolean);
  const canDecide = ['PENDING_APPROVAL', 'UNDER_REVIEW'].includes(s.status);
  const canCollect = ['APPROVED', 'PICKUP_SCHEDULED'].includes(s.status);
  const canSchedule = s.status === 'APPROVED';

  return (
    <div className="card max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-100 bg-white p-5">
        <div>
          <p className="font-mono text-xs text-ink-500">{s.submissionNumber}</p>
          <h3 className="font-semibold text-ink-900">
            {s.materialType} · {kg(s.quantityKg)}
          </h3>
          <p className="text-xs text-ink-500">
            {s.seller?.name} · {s.seller?.phone || s.seller?.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={s.status} />
          <button className="text-ink-400 hover:text-ink-700" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {s.rejectionReason && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Rejected: {s.rejectionReason}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="Category" value={s.materialCategory?.name || '—'} />
          <Field label="Condition" value={titleCase(s.condition)} />
          <Field label="Quality grade" value={s.qualityGrade || '—'} />
          <Field
            label="Demanded"
            value={
              s.demandBasis === 'PER_KG'
                ? `${paise(s.demandedPerKgPaise)}/kg`
                : `${paise(s.demandedTotalPaise)} total`
            }
          />
          <Field
            label="Est. material value"
            value={v.materialValuePaise ? paise(v.materialValuePaise) : '—'}
          />
          <Field
            label="Est. payout"
            value={v.estimatedPayoutPaise ? paise(v.estimatedPayoutPaise) : '—'}
          />
          <Field
            label="Proposed price"
            value={s.proposedPurchasePricePaise ? paise(s.proposedPurchasePricePaise) : '—'}
          />
          <Field
            label="Accepted qty"
            value={s.acceptedQuantityKg ? kg(s.acceptedQuantityKg) : '—'}
          />
          <Field
            label="Pickup"
            value={pickup.city ? `${pickup.city}${pickup.state ? ', ' + pickup.state : ''}` : '—'}
          />
          {s.pickupDate && <Field label="Pickup date" value={dateTime(s.pickupDate)} />}
          <Field label="Submitted" value={dateTime(s.createdAt)} />
        </dl>

        {s.description && (
          <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">{s.description}</p>
        )}

        {/* Seller photos */}
        <div>
          <h4 className="text-sm font-semibold text-ink-900">Seller photos</h4>
          {photos.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">No photos uploaded.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-lg border border-ink-100"
                >
                  <img
                    src={url}
                    alt={`Submission photo ${i + 1}`}
                    className="h-24 w-full object-cover transition group-hover:scale-105"
                  />
                </a>
              ))}
            </div>
          )}
        </div>

        {Array.isArray(s.adminNotes) && s.adminNotes.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-ink-900">Admin notes</h4>
            <ul className="mt-2 space-y-1 text-xs text-ink-500">
              {[...s.adminNotes].reverse().map((n, i) => (
                <li key={i} className="rounded bg-ink-50 px-2 py-1">
                  {n.at ? `${dateTime(n.at)} — ` : ''}
                  {n.note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-4 border-t border-ink-100 pt-4">
          {s.status === 'PENDING_APPROVAL' && (
            <ActionBox icon={Search} title="Start review" tone="ink">
              <input
                className="input"
                placeholder="Note (optional, audited)"
                value={review.note}
                onChange={(e) => setReview((r) => ({ ...r, note: e.target.value }))}
              />
              <button
                className="btn-secondary mt-2"
                disabled={busy === 'review'}
                onClick={() =>
                  run(
                    'review',
                    () =>
                      endpoints.admin.review(s.id, {
                        status: 'UNDER_REVIEW',
                        note: review.note || undefined,
                      }),
                    'Submission moved to under review'
                  )
                }
              >
                {busy === 'review' ? 'Moving…' : 'Mark under review'}
              </button>
            </ActionBox>
          )}

          {canDecide && (
            <>
              <ActionBox icon={BadgeCheck} title="Approve submission" tone="brand">
                <label className="text-xs text-ink-500">
                  Proposed purchase price ₹/kg (optional — defaults to the auto-valuation payout
                  {v.estimatedPayoutPaise ? ` of ${paise(v.estimatedPayoutPaise)}` : ''})
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input mt-1"
                    value={approve.proposedPricePerKg}
                    onChange={(e) =>
                      setApprove((a) => ({ ...a, proposedPricePerKg: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Note (audited)
                  <input
                    className="input mt-1"
                    value={approve.note}
                    onChange={(e) => setApprove((a) => ({ ...a, note: e.target.value }))}
                  />
                </label>
                <button
                  className="btn-primary mt-2"
                  disabled={busy === 'approve'}
                  onClick={() =>
                    run(
                      'approve',
                      () =>
                        endpoints.admin.submissionAction(s.id, 'approve', {
                          proposedPricePerKg:
                            approve.proposedPricePerKg === ''
                              ? undefined
                              : Number(approve.proposedPricePerKg),
                          note: approve.note || undefined,
                        }),
                      'Submission approved'
                    )
                  }
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
              </ActionBox>

              <ActionBox icon={Ban} title="Reject submission" tone="red">
                <input
                  className="input"
                  placeholder="Reason (shown to the seller)"
                  value={reject.reason}
                  onChange={(e) => setReject({ reason: e.target.value })}
                />
                <button
                  className="btn-secondary mt-2 text-red-600"
                  disabled={busy === 'reject' || reject.reason.trim().length < 5}
                  onClick={() =>
                    run(
                      'reject',
                      () =>
                        endpoints.admin.submissionAction(s.id, 'reject', {
                          reason: reject.reason.trim(),
                        }),
                      'Submission rejected'
                    )
                  }
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </ActionBox>
            </>
          )}

          {canSchedule && (
            <ActionBox icon={CalendarClock} title="Schedule pickup" tone="ink">
              <label className="text-xs text-ink-500">
                Pickup date & time
                <input
                  type="datetime-local"
                  className="input mt-1"
                  value={review.pickupDate}
                  onChange={(e) => setReview((r) => ({ ...r, pickupDate: e.target.value }))}
                />
              </label>
              <input
                className="input"
                placeholder="Note (optional, audited)"
                value={review.note}
                onChange={(e) => setReview((r) => ({ ...r, note: e.target.value }))}
              />
              <button
                className="btn-secondary mt-2"
                disabled={busy === 'schedule' || !review.pickupDate}
                onClick={() =>
                  run(
                    'schedule',
                    () =>
                      endpoints.admin.review(s.id, {
                        status: 'PICKUP_SCHEDULED',
                        pickupDate: new Date(review.pickupDate).toISOString(),
                        note: review.note || undefined,
                      }),
                    'Pickup scheduled'
                  )
                }
              >
                {busy === 'schedule' ? 'Scheduling…' : 'Schedule pickup'}
              </button>
            </ActionBox>
          )}

          {canCollect && (
            <ActionBox icon={PackageCheck} title="Collect material" tone="brand">
              <label className="text-xs text-ink-500">
                Accepted quantity (kg) — submitted: {kg(s.quantityKg)}
                <input
                  type="number"
                  min="100"
                  className="input mt-1"
                  value={collect.acceptedQuantityKg}
                  onChange={(e) =>
                    setCollect((c) => ({ ...c, acceptedQuantityKg: e.target.value }))
                  }
                />
              </label>
              <p className="text-xs text-ink-400">
                Minimum 100 kg. Creates the inventory lot exactly once.
              </p>
              <button
                className="btn-primary mt-2"
                disabled={busy === 'collect' || !(Number(collect.acceptedQuantityKg) >= 100)}
                onClick={() =>
                  run(
                    'collect',
                    () =>
                      endpoints.admin.submissionAction(s.id, 'collect', {
                        acceptedQuantityKg: Number(collect.acceptedQuantityKg),
                      }),
                    'Material collected and stocked'
                  )
                }
              >
                {busy === 'collect' ? 'Collecting…' : 'Mark collected'}
              </button>
            </ActionBox>
          )}

          {s.status === 'COLLECTED' && (
            <ActionBox icon={Send} title="Publish to marketplace" tone="brand">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-ink-500">
                  Listing title
                  <input
                    className="input mt-1"
                    value={publish.title}
                    onChange={(e) => setPublish((p) => ({ ...p, title: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Price ₹/kg
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    className="input mt-1"
                    value={publish.pricePerKg}
                    onChange={(e) => setPublish((p) => ({ ...p, pricePerKg: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-ink-500 sm:col-span-2">
                  Description
                  <textarea
                    rows={3}
                    className="input mt-1"
                    value={publish.description}
                    onChange={(e) => setPublish((p) => ({ ...p, description: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Min purchase (kg)
                  <input
                    type="number"
                    min="0"
                    className="input mt-1"
                    value={publish.minPurchaseKg}
                    onChange={(e) => setPublish((p) => ({ ...p, minPurchaseKg: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-ink-500">
                  Delivery terms
                  <input
                    className="input mt-1"
                    value={publish.deliveryTerms}
                    onChange={(e) => setPublish((p) => ({ ...p, deliveryTerms: e.target.value }))}
                  />
                </label>
              </div>
              <p className="text-xs text-ink-400">
                Uses the seller's photos when no new images are attached.
              </p>
              <button
                className="btn-primary mt-2"
                disabled={
                  busy === 'publish' ||
                  publish.title.trim().length < 3 ||
                  publish.description.trim().length < 10 ||
                  !(Number(publish.pricePerKg) > 0)
                }
                onClick={() =>
                  run(
                    'publish',
                    () =>
                      endpoints.admin.submissionAction(s.id, 'publish', {
                        title: publish.title.trim(),
                        description: publish.description.trim(),
                        pricePerKg: Number(publish.pricePerKg),
                        minPurchaseKg: Number(publish.minPurchaseKg) || 0,
                        deliveryTerms: publish.deliveryTerms.trim(),
                      }),
                    'Listing published to marketplace'
                  )
                }
              >
                {busy === 'publish' ? 'Publishing…' : 'Publish listing'}
              </button>
            </ActionBox>
          )}

          {s.status === 'PURCHASED' && s.listing && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4 text-sm">
              <p className="font-semibold text-ink-900">Published to marketplace</p>
              <Link
                to={`/marketplace/${s.listing.id || s.listing}`}
                className="mt-1 inline-block text-brand-700 hover:underline"
              >
                View listing →
              </Link>
            </div>
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
