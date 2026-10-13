import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Recycle, SlidersHorizontal } from 'lucide-react';
import { endpoints } from '../lib/api';
import { paise, kg, firstImage } from '../lib/format';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

export default function Marketplace() {
  const [params, setParams] = useSearchParams({});
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState({ data: [] });
  const [loading, setLoading] = useState(true);

  const page = Number(params.get('page') || 1);
  const search = params.get('search') || '';
  const category = params.get('category') || '';
  const sort = params.get('sort') || 'newest';

  const buildParams = useCallback(
    (obj) => {
      const next = new URLSearchParams(obj);
      for (const k of ['search', 'category', 'sort', 'page']) {
        if (!next.get(k)) next.delete(k);
      }
      setParams(next);
    },
    [setParams],
  );

  useEffect(() => {
    endpoints.categories.list().then((r) => setCategories(r.data.data.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    endpoints.marketplace
      .list({
        page,
        limit: 12,
        search: search || undefined,
        category: category || undefined,
        sort,
      })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch(() => setData({ data: [] }))
      .finally(() => setLoading(false));
  }, [page, search, category, sort]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title">Marketplace</h1>
          <p className="text-sm text-ink-500">Verified, inspected material lots from across India.</p>
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
            <input name="search" defaultValue={search} placeholder="Search steel, copper, plastic…" className="input pl-9" />
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
        <div className="ml-auto">
          <label className="mr-2 text-sm text-ink-500">Sort</label>
          <select
            className="input inline-block w-auto py-1.5"
            value={sort}
            onChange={(e) => buildParams({ ...Object.fromEntries(params), sort: e.target.value, page: 1 })}
          >
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
          <p className="text-lg font-semibold text-ink-700">No listings match</p>
          <p className="text-sm text-ink-500">Try clearing filters or check back later.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.data.map((l) => (
            <Link key={l.id} to={`/marketplace/${l.id}`} className="card group overflow-hidden transition hover:shadow-lg">
              <div className="aspect-[4/3] overflow-hidden bg-ink-100">
                {l.images?.length ? (
                  <img src={firstImage(l.images)} alt={l.title} className="h-full w-full object-cover transition group-hover:scale-105" />
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
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-brand-700">{paise(l.pricePerKgPaise)}/kg</span>
                  <span className="chip bg-ink-100 text-ink-700">{kg(l.availableQuantityKg)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={page} pages={data.meta?.totalPages || 1} onChange={(p) => buildParams({ ...Object.fromEntries(params), page: p })} />
    </div>
  );
}
