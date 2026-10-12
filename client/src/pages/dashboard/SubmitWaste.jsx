import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CloudUpload, Sparkles } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { paise, kg } from '../../lib/format';

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

export default function SubmitWaste() {
  const { user } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [images, setImages] = useState({ front: null, back: null, left: null, right: null });
  const [estimation, setEstimation] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(0);

  useEffect(() => {
    endpoints.categories.list().then((r) => setCategories(r.data.data.categories || [])).catch(() => {});
  }, []);

  const categoriesWithPricing = useMemo(() => categories, [categories]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onFile = (key) => (e) => {
    const file = e.target.files?.[0];
    if (file) setImages((imgs) => ({ ...imgs, [key]: file }));
  };

  const canEstimate = form.materialCategory && form.materialType && form.quantityKg && form.qualityGrade;

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
      fd.append('materialCategory', form.materialCategory);
      fd.append('materialType', form.materialType);
      fd.append('quantityKg', String(form.quantityKg));
      fd.append('condition', form.condition);
      fd.append('qualityGrade', form.qualityGrade);
      fd.append('description', form.description);
      fd.append('pickup', JSON.stringify({
        address: form.address,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
      }));
      fd.append('demandBasis', form.demandBasis);
      fd.append('demandedPrice', String(form.demandedPrice || 0));
      fd.append('comments', form.comments);
      for (const side of IMAGE_SIDES) {
        const file = images[side.key];
        if (!file) throw Object.assign(new Error(`Please add the ${side.label} photo.`), { skipToast: true });
        fd.append(side.key, file);
      }
      const res = await endpoints.submissions.create(fd);
      toast.success(`Submission ${res.data.data.submission.submissionNumber} created`);
      setForm(EMPTY);
      setImages({ front: null, back: null, left: null, right: null });
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
          <h2 className="font-semibold text-ink-900">Material details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Material category</label>
              <select className="input" value={form.materialCategory} onChange={set('materialCategory')} required>
                <option value="">Select category</option>
                {categoriesWithPricing.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Material type</label>
              <input className="input" value={form.materialType} onChange={set('materialType')} placeholder="e.g. MS Scrap" required />
            </div>
            <div>
              <label className="label">Quantity (kg)</label>
              <input type="number" className="input" min="100" value={form.quantityKg} onChange={set('quantityKg')} required />
              <p className="mt-1 text-xs text-ink-400">Minimum submission is 100 kg.</p>
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
              <label className="label">Demanded price ({form.demandBasis === 'PER_KG' ? '₹/kg' : '₹'})</label>
              <input type="number" className="input" min="0" value={form.demandedPrice} onChange={set('demandedPrice')} />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Describe the material, contamination, sorting…" required />
          </div>
        </div>

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
              <input className="input" value={form.postalCode} onChange={set('postalCode')} required />
            </div>
            <div>
              <label className="label">Contact name</label>
              <input className="input" value={form.contactName} onChange={set('contactName')} placeholder={user?.name} required />
            </div>
            <div>
              <label className="label">Contact phone</label>
              <input className="input" value={form.contactPhone} onChange={set('contactPhone')} placeholder={user?.phone} required />
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
            <span className="text-xs font-normal text-ink-400">(4 required — front, back, left, right)</span>
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {IMAGE_SIDES.map((s) => (
              <label key={s.key} className="group cursor-pointer">
                {images[s.key] ? (
                  <img src={URL.createObjectURL(images[s.key])} alt={s.label} className="h-28 w-full rounded-lg object-cover ring-2 ring-brand-500" />
                ) : (
                  <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink-300 text-ink-400 transition group-hover:border-brand-400 group-hover:text-brand-600">
                    <CloudUpload className="h-6 w-6" />
                    <span className="text-xs">{s.label}</span>
                  </div>
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile(s.key)} />
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit for review'}
          </button>
          <p className="text-xs text-ink-500">Our team verifies & picks up before the material is listed.</p>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-semibold text-ink-900">
            <Sparkles className="h-4 w-4 text-brand-600" /> Instant valuation
          </h3>
          <p className="mt-1 text-xs text-ink-500">Preview what your material may be worth.</p>
          <button type="button" className="btn-secondary mt-4 w-full" disabled={!canEstimate || estimateLoading} onClick={runEstimate}>
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
              <button className="text-xs" onClick={() => setPreview(0)}>
                for {kg(estimation.quantityKg)} @ {form.qualityGrade}
              </button>
            </div>
          )}
        </div>

        <div className="card p-5 text-sm">
          <h3 className="mb-2 font-semibold text-ink-900">How it works</h3>
          <ol className="list-inside list-decimal space-y-1.5 text-ink-600">
            <li>Submit your material & photos.</li>
            <li>Our team reviews the lot.</li>
            <li>Material is collected & weighed.</li>
            <li>It is listed at a fair market price.</li>
            <li>You get paid on delivery.</li>
          </ol>
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