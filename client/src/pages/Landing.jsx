import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Recycle, TrendingDown, ShieldCheck, Truck, ArrowRight } from 'lucide-react';
import { endpoints } from '../lib/api';
import { paise, kg, firstImage } from '../lib/format';

export default function Landing() {
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    endpoints.marketplace
      .list({ limit: 6, sort: 'newest' })
      .then((res) => setFeatured(res.data.data.data || []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <section className="relative overflow-hidden bg-ink-900 py-20 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.25),transparent_60%)]" />
        <div className="relative mx-auto max-w-7xl px-4 text-center sm:px-6">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight sm:text-5xl">
            Turn scrap into <span className="text-brand-400">value</span>. Buy and sell waste materials
            responsibly.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-300">
            MetalMundi connects businesses that generate scrap with buyers who can reprocess it — with transparent
            pricing, verified sellers and audited transactions.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/marketplace" className="btn-primary px-6 py-3 text-base">
              Browse materials <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/register" className="btn bg-white/10 px-6 py-3 text-base text-white backdrop-blur hover:bg-white/20">
              Sell your scrap
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <FeatureCard
            icon={<TrendingDown className="h-6 w-6" />}
            title="Fair, transparent pricing"
            body="Material is appraised against live category rates with clean quality multipliers — no hidden deductions."
          />
          <FeatureCard
            icon={<ShieldCheck className="h-6 w-6" />}
            title="Verified sellers"
            body="Every lot is photographed, reviewed and collected by our team before it ever reaches the marketplace."
          />
          <FeatureCard
            icon={<Truck className="h-6 w-6" />}
            title="Reliable pickup & dispatch"
            body="Doorstep collection from verified locations and tracked order fulfilment for every purchase."
          />
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-ink-900">Fresh on the market</h2>
            <Link to="/marketplace" className="text-sm font-semibold text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((l) => (
              <Link key={l.id} to={`/marketplace/${l.id}`} className="card group overflow-hidden transition hover:shadow-lg">
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
                  <h3 className="font-semibold text-ink-900">{l.title}</h3>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-lg font-bold text-brand-700">{paise(l.pricePerKgPaise)}/kg</span>
                    <span className="text-ink-500">{kg(l.availableQuantityKg)} available</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="card p-6">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-100 text-brand-700">{icon}</div>
      <h3 className="mb-1 text-lg font-semibold text-ink-900">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-500">{body}</p>
    </div>
  );
}