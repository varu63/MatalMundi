import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Gavel, Search, SlidersHorizontal } from 'lucide-react';
import { endpoints } from '../lib/api';
import { paise, kg, firstImage, countdown } from '../lib/format';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

const STATUS_TABS = [
  { key: '', label: 'All open' },
  { key: 'ACTIVE', label: 'Live now' },
  { key: 'SCHEDULED', label: 'Starting soon' },
];

export default function Auctions() {
  const [params, setParams] = useSearchParams({});
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [data, setData] = useState({ data: [] });
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const page = Number(params.get('page') || 1);
  const search = params.get('search') || '';
  const category = params.get('category') || '';
  const status = params.get('status') || '';

  const buildParams = useCallback(
    (obj) => {
      const next = new URLSearchParams(obj);
      for (const k of ['search', 'category', 'status', 'page']) {
        if (!next.get(k)) next.delete(k);
      }
      setParams(next);
    },
    [setParams]
  );

  const loadCategories = useCallback(() => {
    setCategoriesError(false);
    endpoints.categories
      .list()
      .then((r) => setCategories(r.data.data.categories || []))
      .catch(() => setCategoriesError(true));
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    setLoading(true);
    endpoints.auctions
      .list({
        page,
        limit: 12,
        search: search || undefined,
        category: category || undefined,
        status: status || undefined,
      })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [] }))
      .finally(() => setLoading(false));
  }, [page, search, category, status]);

  // Keep the countdowns ticking without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Gavel className="h-6 w-6 text-brand-600" /> Waste auctions
          </h1>
          <p className="text-sm text-ink-500">Live bidding on verified industrial scrap lots.</p>
        </div>
        <form
          className="flex w-full max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            buildParams({ ...Object.fromEntries(params), search: e.target.search.value, page: 1 });
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
            <input
              name="search"
              defaultValue={search}
              placeholder="Search auctions, material…"
              className="input pl-9"
            />
          </div>
          <button type="submit" className="btn-primary">
            Search
          </button>
        </form>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-ink-600">
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </span>
        {STATUS_TABS.map((t) => (
          <button
            key={t.key || 'all'}
            className={`chip ${status === t.key ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
            onClick={() => buildParams({ ...Object.fromEntries(params), status: t.key, page: 1 })}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-ink-200" />
        <button
          className={`chip ${!category ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
          onClick={() => buildParams({ ...Object.fromEntries(params), category: '', page: 1 })}
        >
          All materials
        </button>
        {categories.map((c) => (
          <button
            key={c._id}
            className={`chip ${category === c._id ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
            onClick={() => buildParams({ ...Object.fromEntries(params), category: c.id, page: 1 })}
          >
            {c.name}
          </button>
        ))}
        {categoriesError ? (
          <span className="text-sm text-red-600">
            Categories failed to load.{' '}
            <button className="underline" onClick={loadCategories}>
              Retry
            </button>
          </span>
        ) : (
          !categories.length && <span className="text-sm text-ink-500">No categories yet.</span>
        )}
      </div>

      {loading ? (
        <Spinner label="Loading auctions…" />
      ) : data.data.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <Gavel className="h-12 w-12 text-ink-300" />
          <p className="text-lg font-semibold text-ink-700">No auctions right now</p>
          <p className="text-sm text-ink-500">Check back soon — new lots are approved regularly.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.data.map((a) => (
            <AuctionCard key={a.id} auction={a} />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pages={data.meta?.totalPages || 1}
        onChange={(p) => buildParams({ ...Object.fromEntries(params), page: p })}
      />
    </div>
  );
}

function AuctionCard({ auction: a }) {
  const live = a.status === 'ACTIVE';
  const remaining = countdown(a.endAt);
  const current = a.currentHighestBidPerKgPaise ?? a.startingPricePerKgPaise;

  return (
    <Link
      to={`/auctions/${a.id}`}
      className="card group overflow-hidden transition hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-ink-100">
        {firstImage(a.images) ? (
          <img
            src={firstImage(a.images)}
            alt={a.materialType}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-400">
            <Gavel className="h-10 w-10" />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-xs font-semibold ${live ? 'bg-brand-600 text-white' : 'bg-ink-900/80 text-white'}`}
        >
          {live ? `Live · ${remaining || 'ending'}` : 'Starting soon'}
        </span>
      </div>
      <div className="p-4">
        <h3 className="truncate font-semibold text-ink-900">
          {a.materialType} · {a.qualityGrade}
        </h3>
        <p className="mt-1 text-xs text-ink-500">
          {a.materialCategory?.name} · {kg(a.quantityKg)} · {a.location?.city}
        </p>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-500">
              {a.currentHighestBidPerKgPaise ? 'Current bid' : 'Starting price'}
            </p>
            <p className="text-lg font-bold text-brand-700">{paise(current)}/kg</p>
          </div>
          <span className="chip bg-ink-100 text-ink-700">
            {a.bidCount} bid{a.bidCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </Link>
  );
}
