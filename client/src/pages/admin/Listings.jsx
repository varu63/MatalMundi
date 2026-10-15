import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, RefreshCw, Search, SlidersHorizontal, Tag } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { paise, kg, dateTime, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';
import { AiImageAlert, AiImageBadge } from '../../components/admin/AiImageWarning';

const STATUS_OPTIONS = [
  { key: '', label: 'All statuses' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'SOLD_OUT', label: 'Sold out' },
];

export default function AdminListings() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .listings({
        page,
        limit: 10,
        status: status || undefined,
        search: search || undefined,
        aiFlagged: flaggedOnly ? 'true' : undefined,
      })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, status, search, flaggedOnly, toast]);

  useEffect(loadList, [loadList]);

  const openDetail = useCallback(
    async (id) => {
      setSelectedId(id);
      setDetailLoading(true);
      try {
        const res = await endpoints.admin.listing(id);
        setSelected(res.data.data.listing);
      } catch (err) {
        toast.error(handleError(err));
        setSelected(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  const refresh = useCallback(async () => {
    loadList();
    if (selectedId) await openDetail(selectedId);
  }, [loadList, openDetail, selectedId]);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <ClipboardList className="h-4 w-4 text-brand-600" /> Listings
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Marketplace listings with AI-photo screening. Flags only warn — nothing is hidden or
              blocked automatically.
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
                placeholder="Search listings…"
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-red-600"
                checked={flaggedOnly}
                onChange={(e) => {
                  setFlaggedOnly(e.target.checked);
                  setPage(1);
                }}
              />
              Show AI-flagged only
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr,560px]">
        <div className="card overflow-hidden">
          {loading ? (
            <Spinner center />
          ) : data.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-ink-500">No listings match.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Listing</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Available</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Published</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.data.map((l) => (
                      <tr
                        key={l.id}
                        className={`hover:bg-ink-50/50 ${selectedId === l.id ? 'bg-brand-50/60' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-ink-900">{l.title}</span>
                          <span className="mt-1 block">
                            <AiImageBadge check={l.imageCheck} />
                          </span>
                        </td>
                        <td className="px-4 py-3">{l.materialType}</td>
                        <td className="px-4 py-3">{paise(l.pricePerKgPaise)}/kg</td>
                        <td className="px-4 py-3">{kg(l.availableQuantityKg)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={l.publicationStatus} />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-500">
                          {l.publishedAt ? dateTime(l.publishedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="btn-secondary px-3 py-1.5 text-xs"
                            onClick={() => openDetail(l.id)}
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
            <ListingPanel
              key={selected.id + selected.updatedAt}
              listing={selected}
              onChanged={refresh}
              onClose={() => {
                setSelected(null);
                setSelectedId(null);
              }}
            />
          ) : (
            <div className="card flex flex-col items-center gap-2 p-10 text-center">
              <SlidersHorizontal className="h-8 w-8 text-ink-300" />
              <p className="text-sm text-ink-500">Select a listing to review it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListingPanel({ listing: l, onChanged, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const check = l.imageCheck || {};

  const run = async (key, fn, successMessage) => {
    setBusy(key);
    try {
      await fn();
      toast.success(successMessage);
      await onChanged();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy('');
    }
  };

  const recheck = () =>
    run('recheck', () => endpoints.admin.recheckListing(l.id), 'Image re-check started');

  const photos = (l.images || []).map((i) => i?.url).filter(Boolean);
  const canRecheck = check.status === 'error' || check.flagged === true;

  return (
    <div className="card max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-100 bg-white p-5">
        <div>
          <h3 className="font-semibold text-ink-900">{l.title}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {l.materialType} · {l.materialCategory?.name || '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={l.publicationStatus} />
          <button className="text-ink-400 hover:text-ink-700" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <AiImageAlert check={check} />

        {photos.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-ink-900">Photos</h4>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {photos.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-lg border border-ink-100"
                >
                  <img
                    src={url}
                    alt={`Listing photo ${i + 1}`}
                    className="h-24 w-full object-cover transition group-hover:scale-105"
                  />
                </a>
              ))}
            </div>
            {check.status === 'done' && (
              <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
                {(check.perImage || []).map((p) => (
                  <li key={p.name} className="flex justify-between rounded bg-ink-50 px-2 py-1">
                    <span className="truncate">{p.name}</span>
                    <span
                      className={
                        p.aiScore != null && p.aiScore >= 0.8 ? 'font-semibold text-red-600' : ''
                      }
                    >
                      {p.aiScore != null
                        ? `AI ${Math.round(p.aiScore * 100)}%`
                        : p.error || 'no score'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="Quality grade" value={l.qualityGrade || '—'} />
          <Field label="Condition" value={titleCase(l.condition)} />
          <Field label="Price" value={`${paise(l.pricePerKgPaise)}/kg`} />
          <Field label="Min purchase" value={kg(l.minPurchaseKg)} />
          <Field label="Available" value={kg(l.availableQuantityKg)} />
          <Field label="Reserved" value={kg(l.reservedQuantityKg)} />
          <Field label="Sold" value={kg(l.soldQuantityKg)} />
          <Field
            label="Location"
            value={
              l.location?.city
                ? `${l.location.city}${l.location.state ? ', ' + l.location.state : ''}`
                : '—'
            }
          />
          <Field label="Delivery terms" value={l.deliveryTerms || '—'} />
          <Field label="Published" value={l.publishedAt ? dateTime(l.publishedAt) : '—'} />
          <Field
            label="AI photo check"
            value={
              check.status === 'done'
                ? check.maxAiScore != null
                  ? `max ${Math.round(check.maxAiScore * 100)}% · ${dateTime(check.checkedAt)}`
                  : `no scores · ${dateTime(check.checkedAt)}`
                : titleCase(check.status || 'pending')
            }
          />
        </dl>

        {l.description && (
          <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">{l.description}</p>
        )}

        {l.publicationStatus === 'PUBLISHED' && (
          <Link
            to={`/marketplace/${l.id}`}
            className="inline-block text-sm text-brand-700 hover:underline"
          >
            View public listing →
          </Link>
        )}

        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          {canRecheck && (
            <button
              className="btn-secondary text-xs"
              disabled={busy === 'recheck'}
              onClick={recheck}
            >
              <RefreshCw
                className={`mr-1 inline h-3.5 w-3.5 ${busy === 'recheck' ? 'animate-spin' : ''}`}
              />
              {busy === 'recheck' ? 'Re-checking…' : 'Re-check images'}
            </button>
          )}
          {l.publicationStatus !== 'PUBLISHED' && (
            <button
              className="btn-primary text-xs"
              disabled={busy === 'status'}
              onClick={() =>
                run(
                  'status',
                  () => endpoints.admin.listingStatus(l.id, 'PUBLISHED'),
                  'Listing published'
                )
              }
            >
              <Tag className="mr-1 inline h-3.5 w-3.5" /> Publish
            </button>
          )}
          {l.publicationStatus === 'PUBLISHED' && (
            <>
              <button
                className="btn-secondary text-xs"
                disabled={busy === 'status'}
                onClick={() =>
                  run(
                    'status',
                    () => endpoints.admin.listingStatus(l.id, 'PAUSED'),
                    'Listing paused'
                  )
                }
              >
                Pause
              </button>
              <button
                className="btn-secondary text-xs text-red-600"
                disabled={busy === 'status'}
                onClick={() =>
                  run(
                    'status',
                    () => endpoints.admin.listingStatus(l.id, 'DRAFT'),
                    'Listing unpublished'
                  )
                }
              >
                Unpublish
              </button>
            </>
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
