import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CloudUpload, Gavel, Package, Sparkles, Scale } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { paise } from '../../lib/format';

const CONDITIONS = ['LOOSE', 'BALED', 'SHREDDED', 'MIXED', 'USED'];
const GRADES = ['A', 'B', 'C', 'D'];
const IMAGE_SIDES = [
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'left', label: 'Left side' },
  { key: 'right', label: 'Right side' },
];

const EMPTY = {
  materialCategory: '',
  materialType: '',
  quantityKg: '',
  condition: 'LOOSE',
  qualityGrade: 'B',
  description: '',
  city: '',
  state: '',
  postalCode: '',
  address: '',
  contactName: '',
  contactPhone: '',
  demandBasis: 'TOTAL',
  demandedPrice: '',
  comments: '',
};

const EMPTY_AUCTION = {
  startingPricePerKg: '',
  expectedPricePerKg: '',
  minAcceptablePerKg: '',
  reservePricePerKg: '',
  durationMinutes: '',
  inspectionNotes: '',
};

const EMPTY_IMAGES = { front: null, back: null, left: null, right: null, weightEvidence: null };

export default function SubmitWaste() {
  const { user } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saleMode, setSaleMode] = useState('NORMAL');
  const [auction, setAuction] = useState(EMPTY_AUCTION);
  const [auctionSettings, setAuctionSettings] = useState(null);
  const [images, setImages] = useState(EMPTY_IMAGES);
  const [estimation, setEstimation] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isAuction = saleMode === 'AUCTION';

  const loadCategories = useCallback(() => {
    setCategoriesError(false);
    endpoints.categories
      .list()
      .then((r) => setCategories(r.data.data.categories || []))
      .catch(() => setCategoriesError(true));
  }, []);

  useEffect(() => {
    loadCategories();
    endpoints.auctions
      .settings()
      .then((r) => setAuctionSettings(r.data.data.settings))
      .catch(() => {});
  }, [loadCategories]);

  const categoriesWithPricing = useMemo(() => categories, [categories]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setAuctionField = (k) => (e) => setAuction((a) => ({ ...a, [k]: e.target.value }));

  const minQuantity = isAuction ? auctionSettings?.minAuctionQuantityKg || 500 : 100;
  const durationOptions = auctionSettings?.allowedDurationsMinutes?.length
    ? auctionSettings.allowedDurationsMinutes
    : [10, 15, 30, 60];
  const canChooseDuration = auctionSettings?.sellerCanChooseDuration !== false;

  const onFile = (key) => (e) => {
    const file = e.target.files?.[0];
    if (file) setImages((imgs) => ({ ...imgs, [key]: file }));
  };

  const canEstimate =
    form.materialCategory && form.materialType && form.quantityKg && form.qualityGrade;

  const runEstimate = useCallback(async () => {
    if (!canEstimate) return;
    setEstimateLoading(true);
    setError('');
    try {
      const res = await endpoints.submissions.estimate({
        materialCategory: form.materialCategory,
        materialType: form.materialType,
        quantityKg: Number(form.quantityKg),
        qualityGrade: form.qualityGrade,
        pickup: { city: form.city, state: form.state, postalCode: form.postalCode },
      });
      setEstimation(res.data.data.valuation);
    } catch (err) {
      setEstimation(null);
      setError(handleError(err));
    } finally {
      setEstimateLoading(false);
    }
  }, [canEstimate, form]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('saleMode', saleMode);
      fd.append('materialCategory', form.materialCategory);
      fd.append('materialType', form.materialType);
      fd.append('quantityKg', String(form.quantityKg));
      fd.append('condition', form.condition);
      fd.append('qualityGrade', form.qualityGrade);
      fd.append('description', form.description);
      fd.append(
        'pickup',
        JSON.stringify({
          address: form.address,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          contactName: form.contactName,
          contactPhone: form.contactPhone,
        })
      );
      fd.append('demandBasis', form.demandBasis);
      fd.append('demandedPrice', String(form.demandedPrice || 0));
      fd.append('comments', form.comments);
      for (const side of IMAGE_SIDES) {
        const file = images[side.key];
        if (!file)
          throw Object.assign(new Error(`Please add the ${side.label} photo.`), {
            skipToast: true,
          });
        fd.append(side.key, file);
      }
      if (isAuction) {
        if (!auction.startingPricePerKg) {
          throw Object.assign(new Error('Please set a starting price per kg for the auction.'), {
            skipToast: true,
          });
        }
        if (!images.weightEvidence) {
          throw Object.assign(
            new Error('Please add the weight-evidence photo (weighbridge slip or scale reading).'),
            { skipToast: true }
          );
        }
        fd.append('startingPricePerKg', String(auction.startingPricePerKg));
        if (auction.expectedPricePerKg)
          fd.append('expectedPricePerKg', String(auction.expectedPricePerKg));
        if (auction.minAcceptablePerKg)
          fd.append('minAcceptablePerKg', String(auction.minAcceptablePerKg));
        if (auction.reservePricePerKg)
          fd.append('reservePricePerKg', String(auction.reservePricePerKg));
        if (canChooseDuration && auction.durationMinutes)
          fd.append('durationMinutes', String(auction.durationMinutes));
        if (auction.inspectionNotes) fd.append('inspectionNotes', auction.inspectionNotes);
        fd.append('weightEvidence', images.weightEvidence);
      }
      const res = await endpoints.submissions.create(fd);
      const body = res.data.data;
      toast.success(
        body.auction
          ? `Auction ${body.auction.auctionNumber} created — pending approval`
          : `Submission ${body.submission.submissionNumber} created`
      );
      setForm(EMPTY);
      setAuction(EMPTY_AUCTION);
      setSaleMode('NORMAL');
      setImages(EMPTY_IMAGES);
      setEstimation(null);
    } catch (err) {
      if (err?.skipToast) setError(err.message);
      else setError(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
      <form onSubmit={onSubmit} className="card space-y-6 p-6">
        <div>
          <h2 className="font-semibold text-ink-900">How do you want to sell?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSaleMode('NORMAL')}
              className={`rounded-xl border-2 p-4 text-left transition ${
                !isAuction ? 'border-brand-600 bg-brand-50' : 'border-ink-200 hover:border-ink-300'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-ink-900">
                <Package className="h-4 w-4 text-brand-600" /> Normal sale
              </span>
              <span className="mt-1 block text-xs text-ink-500">
                Our team reviews, picks up and pays at the listed market price. Minimum 100 kg.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSaleMode('AUCTION')}
              className={`rounded-xl border-2 p-4 text-left transition ${
                isAuction ? 'border-brand-600 bg-brand-50' : 'border-ink-200 hover:border-ink-300'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-ink-900">
                <Gavel className="h-4 w-4 text-brand-600" /> Bidding auction
              </span>
              <span className="mt-1 block text-xs text-ink-500">
                Let buyers bid in real time. Minimum {auctionSettings?.minAuctionQuantityKg || 500}{' '}
                kg — you set the starting price.
              </span>
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-semibold text-ink-900">Material details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Material category</label>
              <select
                className="input"
                value={form.materialCategory}
                onChange={set('materialCategory')}
                required
              >
                <option value="">Select category</option>
                {categoriesWithPricing.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {categoriesError ? (
                <p className="mt-1 text-sm text-red-600">
                  Categories failed to load.{' '}
                  <button type="button" className="underline" onClick={loadCategories}>
                    Retry
                  </button>
                </p>
              ) : (
                !categories.length && (
                  <p className="mt-1 text-sm text-ink-500">No categories available yet.</p>
                )
              )}
            </div>
            <div>
              <label className="label">Material type</label>
              <input
                className="input"
                value={form.materialType}
                onChange={set('materialType')}
                placeholder="e.g. MS Scrap"
                required
              />
            </div>
            <div>
              <label className="label">Quantity (kg)</label>
              <input
                type="number"
                className="input"
                min={minQuantity}
                value={form.quantityKg}
                onChange={set('quantityKg')}
                required
              />
              <p className="mt-1 text-xs text-ink-400">
                {isAuction
                  ? `Auctions require at least ${auctionSettings?.minAuctionQuantityKg || 500} kg.`
                  : 'Minimum submission is 100 kg.'}
              </p>
            </div>
            <div>
              <label className="label">Condition</label>
              <select className="input" value={form.condition} onChange={set('condition')}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Quality grade</label>
              <select className="input" value={form.qualityGrade} onChange={set('qualityGrade')}>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Demanded price basis</label>
              <select className="input" value={form.demandBasis} onChange={set('demandBasis')}>
                <option value="TOTAL">Total</option>
                <option value="PER_KG">Per kg</option>
              </select>
            </div>
            <div>
              <label className="label">
                Demanded price ({form.demandBasis === 'PER_KG' ? '₹/kg' : '₹'})
              </label>
              <input
                type="number"
                className="input"
                min="0"
                value={form.demandedPrice}
                onChange={set('demandedPrice')}
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={set('description')}
              placeholder="Describe the material, contamination, sorting…"
              required
            />
          </div>
        </div>

        {isAuction && (
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <Gavel className="h-4 w-4 text-brand-600" /> Auction settings
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              These values stay separate — the reserve price is never shown to bidders.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Starting price (₹/kg) *</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.01"
                  value={auction.startingPricePerKg}
                  onChange={setAuctionField('startingPricePerKg')}
                  placeholder="First bid must be at least this"
                />
              </div>
              <div>
                <label className="label">Expected price (₹/kg)</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.01"
                  value={auction.expectedPricePerKg}
                  onChange={setAuctionField('expectedPricePerKg')}
                  placeholder="What you hope to get (private)"
                />
              </div>
              <div>
                <label className="label">Minimum acceptable bid (₹/kg)</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.01"
                  value={auction.minAcceptablePerKg}
                  onChange={setAuctionField('minAcceptablePerKg')}
                  placeholder="Your floor (private)"
                />
              </div>
              <div>
                <label className="label">Reserve price (₹/kg)</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="0.01"
                  value={auction.reservePricePerKg}
                  onChange={setAuctionField('reservePricePerKg')}
                  placeholder="Below this the auction ends without a winner"
                />
              </div>
              {canChooseDuration ? (
                <div>
                  <label className="label">Auction duration</label>
                  <select
                    className="input"
                    value={auction.durationMinutes}
                    onChange={setAuctionField('durationMinutes')}
                  >
                    <option value="">
                      Default ({auctionSettings?.defaultDurationMinutes || 30} minutes)
                    </option>
                    {durationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d} minutes
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="label">Auction duration</label>
                  <p className="input bg-ink-50 text-ink-500">
                    {auctionSettings?.defaultDurationMinutes || 30} minutes (set by MetalMundi)
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4">
              <label className="label">Inspection notes (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={auction.inspectionNotes}
                onChange={setAuctionField('inspectionNotes')}
                placeholder="Anything inspectors should verify before approval…"
              />
            </div>
          </div>
        )}

        <div>
          <h2 className="font-semibold text-ink-900">Pickup location & contact</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={set('address')} required />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city} onChange={set('city')} required />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={form.state} onChange={set('state')} required />
            </div>
            <div>
              <label className="label">Postal code</label>
              <input
                className="input"
                value={form.postalCode}
                onChange={set('postalCode')}
                required
              />
            </div>
            <div>
              <label className="label">Contact name</label>
              <input
                className="input"
                value={form.contactName}
                onChange={set('contactName')}
                placeholder={user?.name}
                required
              />
            </div>
            <div>
              <label className="label">Contact phone</label>
              <input
                className="input"
                value={form.contactPhone}
                onChange={set('contactPhone')}
                placeholder={user?.phone}
                required
              />
            </div>
            <div>
              <label className="label">Comments (optional)</label>
              <input className="input" value={form.comments} onChange={set('comments')} />
            </div>
          </div>
        </div>

        <div>
          <h2 className="flex items-center gap-2 font-semibold text-ink-900">
            <Camera className="h-4 w-4 text-brand-600" /> Photographs
            <span className="text-xs font-normal text-ink-400">
              (4 required — front, back, left, right{isAuction ? ' + weight evidence' : ''})
            </span>
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {IMAGE_SIDES.map((s) => (
              <label key={s.key} className="group cursor-pointer">
                {images[s.key] ? (
                  <img
                    src={URL.createObjectURL(images[s.key])}
                    alt={s.label}
                    className="h-28 w-full rounded-lg object-cover ring-2 ring-brand-500"
                  />
                ) : (
                  <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink-300 text-ink-400 transition group-hover:border-brand-400 group-hover:text-brand-600">
                    <CloudUpload className="h-6 w-6" />
                    <span className="text-xs">{s.label}</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={onFile(s.key)}
                />
              </label>
            ))}
          </div>
          {isAuction && (
            <label className="group mt-3 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-brand-300 bg-brand-50/50 p-3 transition hover:border-brand-400">
              <Scale className="h-5 w-5 shrink-0 text-brand-600" />
              <span className="flex-1 text-sm">
                <span className="font-medium text-ink-800">Weight evidence *</span>
                <span className="block text-xs text-ink-500">
                  Weighbridge slip, scale reading or gate pass proving the {minQuantity} kg lot.
                </span>
              </span>
              {images.weightEvidence ? (
                <img
                  src={URL.createObjectURL(images.weightEvidence)}
                  alt="Weight evidence"
                  className="h-14 w-14 rounded object-cover ring-2 ring-brand-500"
                />
              ) : (
                <span className="chip bg-white text-brand-700">Upload</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onFile('weightEvidence')}
              />
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : isAuction ? 'Submit auction for review' : 'Submit for review'}
          </button>
          <p className="text-xs text-ink-500">
            {isAuction
              ? 'Approved auctions go live for real-time bidding.'
              : 'Our team verifies & picks up before the material is listed.'}
          </p>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-semibold text-ink-900">
            <Sparkles className="h-4 w-4 text-brand-600" /> Instant valuation
          </h3>
          <p className="mt-1 text-xs text-ink-500">Preview what your material may be worth.</p>
          <button
            type="button"
            className="btn-secondary mt-4 w-full"
            disabled={!canEstimate || estimateLoading}
            onClick={runEstimate}
          >
            {estimateLoading ? 'Computing…' : 'Get estimate'}
          </button>
          {estimation && (
            <div className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
              <Row label="Material value" value={paise(estimation.materialValuePaise)} />
              <Row label="Pickup charge" value={`- ${paise(estimation.pickupChargePaise ?? 0)}`} />
              <Row label="Platform fee" value={`- ${paise(estimation.feesPaise ?? 0)}`} />
              <div className="flex justify-between border-t border-ink-100 pt-2 font-bold text-brand-700">
                <span>Est. payout</span>
                <span>{paise(estimation.estimatedPayoutPaise)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="card p-5 text-sm">
          <h3 className="mb-2 font-semibold text-ink-900">
            {isAuction ? 'How auctions work' : 'How it works'}
          </h3>
          {isAuction ? (
            <ol className="list-inside list-decimal space-y-1.5 text-ink-600">
              <li>Submit the lot with weight evidence.</li>
              <li>Our team approves & schedules the auction.</li>
              <li>Buyers bid in real time until the timer ends.</li>
              <li>The highest bid at or above your reserve wins.</li>
              <li>We collect, weigh and pay out your share.</li>
            </ol>
          ) : (
            <ol className="list-inside list-decimal space-y-1.5 text-ink-600">
              <li>Submit your material & photos.</li>
              <li>Our team reviews the lot.</li>
              <li>Material is collected & weighed.</li>
              <li>It is listed at a fair market price.</li>
              <li>You get paid on delivery.</li>
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-ink-600">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
