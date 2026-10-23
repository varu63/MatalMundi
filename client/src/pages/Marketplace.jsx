import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  Recycle,
  SlidersHorizontal,
  MapPin,
  LocateFixed,
  X,
  Loader2,
} from 'lucide-react';
import { endpoints } from '../lib/api';
import { paise, kg, firstImage } from '../lib/format';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';
import { useBuyerLocation, RADIUS_OPTIONS } from '../hooks/useBuyerLocation';

export default function Marketplace() {
  const [params, setParams] = useSearchParams({});
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [data, setData] = useState({ data: [] });
  const [loading, setLoading] = useState(true);
  const location = useBuyerLocation();
  const [placeTerm, setPlaceTerm] = useState('');

  const page = Number(params.get('page') || 1);
  const search = params.get('search') || '';
  const category = params.get('category') || '';
  const cityFilter = params.get('city') || '';
  const sort = params.get('sort') || (location.origin ? 'nearby' : 'newest');

  const buildParams = useCallback(
    (obj) => {
      const next = new URLSearchParams(obj);
      for (const k of ['search', 'category', 'sort', 'page', 'city']) {
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
    endpoints.marketplace
      .list({
        page,
        limit: 12,
        search: search || undefined,
        category: category || undefined,
        city: cityFilter || undefined,
        sort,
        lat: location.origin?.lat,
        lng: location.origin?.lng,
        radiusKm: location.origin ? location.radiusKm : undefined,
      })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [] }))
      .finally(() => setLoading(false));
  }, [page, search, category, cityFilter, sort, location.origin, location.radiusKm]);

  const usingDistance = Boolean(location.origin);
  const meta = data.meta || {};

  const onPlaceSubmit = async (e) => {
    e.preventDefault();
    const term = placeTerm.trim();
    if (term.length < 2) return;
    const results = await location.searchPlaces(term);
    if (results.length === 1) {
      location.applyPlace(results[0]);
    } else if (!results.length) {
      // No geocoder configured (or no match): fall back to a city text filter.
      buildParams({ ...Object.fromEntries(params), city: term, page: 1 });
    }
  };

  const clearLocation = () => {
    location.clear();
    setPlaceTerm('');
    buildParams({ ...Object.fromEntries(params), page: 1 });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title">Marketplace</h1>
          <p className="text-sm text-ink-500">
            Verified, inspected material lots from across India.
          </p>
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
              aria-label="Search materials"
              defaultValue={search}
              placeholder="Search steel, copper, plastic…"
              className="input pl-9"
            />
          </div>
          <button type="submit" className="btn-primary">
            Search
          </button>
        </form>
      </div>

      {/* ── Location ─────────────────────────────────────────────────────── */}
      <div className="card mb-6 p-4">
        {usingDistance ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800">
              <MapPin className="h-4 w-4" />
              {location.label}
            </span>
            <label className="text-sm text-ink-500" htmlFor="marketplace-radius">
              Within
            </label>
            <select
              id="marketplace-radius"
              className="input inline-block w-auto py-1.5"
              value={location.radiusKm}
              onChange={(e) => {
                location.setRadiusKm(Number(e.target.value));
                buildParams({ ...Object.fromEntries(params), page: 1 });
              }}
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={clearLocation}
              className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"
            >
              <X className="h-4 w-4" /> Clear location
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={location.useMyLocation}
              disabled={location.status === 'requesting'}
              className="btn-secondary inline-flex items-center gap-2 whitespace-nowrap"
            >
              {location.status === 'requesting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LocateFixed className="h-4 w-4" />
              )}
              Use my current location
            </button>
            <form className="flex flex-1 gap-2" onSubmit={onPlaceSubmit}>
              <input
                aria-label="Search by place"
                className="input flex-1"
                placeholder={
                  location.geocodingEnabled
                    ? '…or type a city or locality, e.g. Pirangam'
                    : '…or type a city to filter, e.g. Gurugram'
                }
                value={placeTerm}
                onChange={(e) => setPlaceTerm(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={placeTerm.trim().length < 2}>
                Find
              </button>
            </form>
          </div>
        )}

        {location.error && <p className="mt-2 text-sm text-red-600">{location.error}</p>}

        {!usingDistance && location.places.length > 0 && (
          <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
            {location.places.map((p) => (
              <li key={`${p.latitude},${p.longitude}`}>
                <button
                  type="button"
                  onClick={() => location.applyPlace(p)}
                  className="flex w-full items-start gap-2 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span className="truncate">{p.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-ink-600">
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </span>
        <button
          className={`chip ${!category ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
          onClick={() => buildParams({ ...Object.fromEntries(params), category: '', page: 1 })}
        >
          All
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
        {cityFilter && (
          <span className="chip flex items-center gap-1 bg-ink-100 text-ink-700">
            City: {cityFilter}
            <button
              type="button"
              aria-label="Clear city filter"
              onClick={() =>
                buildParams({ ...Object.fromEntries(params), city: '', page: 1 })
              }
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <div className="ml-auto">
          <label className="mr-2 text-sm text-ink-500" htmlFor="marketplace-sort">Sort</label>
          <select id="marketplace-sort"
            className="input inline-block w-auto py-1.5"
            value={sort}
            onChange={(e) =>
              buildParams({ ...Object.fromEntries(params), sort: e.target.value, page: 1 })
            }
          >
            {usingDistance && <option value="nearby">Nearest first</option>}
            <option value="newest">Newest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="quantity_desc">Quantity: most first</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading listings…" />
      ) : data.data.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <Recycle className="h-12 w-12 text-ink-300" />
          <p className="text-lg font-semibold text-ink-700">
            {usingDistance ? `No materials within ${location.radiusKm} km` : 'No listings match'}
          </p>
          <p className="max-w-md text-sm text-ink-500">
            {usingDistance
              ? meta.noResultsWithinRadius
                ? 'Nothing is listed inside this circle. Try a wider radius, or clear the location to browse everything.'
                : 'Try a wider radius or clear your other filters.'
              : 'Try clearing filters or check back later.'}
          </p>
          {usingDistance && location.radiusKm < RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1] && (
            <button
              className="btn-secondary"
              onClick={() => {
                const next = RADIUS_OPTIONS.find((r) => r > location.radiusKm);
                if (next) location.setRadiusKm(next);
              }}
            >
              Increase radius
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.data.map((l) => (
            <Link
              key={l.id}
              to={`/marketplace/${l.id}`}
              className="card group overflow-hidden transition hover:shadow-lg"
            >
              <div className="aspect-[4/3] overflow-hidden bg-ink-100">
                {l.images?.length ? (
                  <img
                    src={firstImage(l.images)}
                    alt={l.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-ink-400">
                    <Recycle className="h-10 w-10" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="truncate font-semibold text-ink-900">{l.title}</h3>
                <p className="mt-1 text-xs capitalize text-ink-500">
                  {l.materialType} · {l.condition?.toLowerCase()}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
                  <MapPin className="h-3 w-3" />
                  {[l.city, l.state].filter(Boolean).join(', ') || 'Location on request'}
                  {typeof l.distanceKm === 'number' && (
                    <span className="font-semibold text-brand-700">· {l.distanceKm} km away</span>
                  )}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-brand-700">
                    {paise(l.pricePerKgPaise)}
                    <span className="text-xs font-medium text-ink-500">/kg</span>
                  </span>
                  <span className="chip bg-ink-100 text-ink-700">{kg(l.availableQuantityKg)}</span>
                </div>
              </div>
            </Link>
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
