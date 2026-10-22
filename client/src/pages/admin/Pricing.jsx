import { useCallback, useEffect, useState } from 'react';
import { Percent, Plus, Power, Settings2, X } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, paise } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const EMPTY_FORM = {
  materialCategory: '',
  materialType: '',
  ratePerKg: '',
  basePickupCharge: '500',
  perKmCharge: '12',
  platformFeePercent: '5',
  taxPercent: '18',
  qualityA: '1.1',
  qualityB: '1',
  qualityC: '0.9',
  qualityD: '0.8',
  notes: '',
};

const toRupees = (paise) => (Number(paise || 0) / 100).toFixed(2);

export default function AdminPricing() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .pricing({ page, limit: 10 })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, toast]);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    endpoints.admin
      .categories()
      .then((r) => setCategories(r.data.data.categories || []))
      .catch(() => setCategories([]));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({ ...EMPTY_FORM, materialCategory: categories[0]?.id || '' });
  };

  const openEdit = (rule) => {
    setCreating(false);
    setEditing(rule.id);
    setForm({
      materialCategory: rule.materialCategory?.id || rule.materialCategory || '',
      materialType: rule.materialType || '',
      ratePerKg: toRupees(rule.ratePerKgPaise),
      basePickupCharge: toRupees(rule.basePickupChargePaise),
      perKmCharge: toRupees(rule.perKmChargePaise),
      platformFeePercent: String(rule.platformFeePercent ?? 5),
      taxPercent: String(rule.taxPercent ?? 18),
      qualityA: String(rule.qualityMultipliers?.A ?? 1.1),
      qualityB: String(rule.qualityMultipliers?.B ?? 1),
      qualityC: String(rule.qualityMultipliers?.C ?? 0.9),
      qualityD: String(rule.qualityMultipliers?.D ?? 0.8),
      notes: rule.notes || '',
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = {
      materialType: form.materialType,
      ratePerKg: Number(form.ratePerKg),
      basePickupCharge: Number(form.basePickupCharge),
      perKmCharge: Number(form.perKmCharge),
      platformFeePercent: Number(form.platformFeePercent),
      taxPercent: Number(form.taxPercent),
      qualityMultipliers: {
        A: Number(form.qualityA),
        B: Number(form.qualityB),
        C: Number(form.qualityC),
        D: Number(form.qualityD),
      },
      notes: form.notes,
    };
    try {
      if (creating) {
        const res = await endpoints.admin.createPricing({
          ...payload,
          materialCategory: form.materialCategory,
        });
        toast.success(res.data.message || 'Pricing rule created');
      } else {
        const res = await endpoints.admin.updatePricing(editing, payload);
        toast.success(res.data.message || 'Pricing rule updated');
      }
      closeForm();
      loadList();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule) => {
    try {
      const res = await endpoints.admin.pricingToggle(rule.id, !rule.active);
      toast.success(res.data.message || 'Pricing rule updated');
      loadList();
    } catch (err) {
      toast.error(handleError(err));
    }
  };

  const showForm = creating || Boolean(editing);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <Percent className="h-4 w-4 text-brand-600" /> Pricing rules
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Rates are stored in paise and entered in rupees here. Editing a rule supersedes any
              other active rule for the same category and material.
            </p>
          </div>
          {!showForm && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New rule
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="card p-5" onSubmit={submit}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-ink-900">
              <Settings2 className="h-4 w-4 text-brand-600" />
              {creating ? 'New pricing rule' : 'Edit pricing rule'}
            </h3>
            <button type="button" className="btn-secondary px-2 py-1" onClick={closeForm}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creating && (
              <div>
                <label className="label" htmlFor="pricing-category">
                  Material category
                </label>
                <select
                  id="pricing-category"
                  className="input"
                  value={form.materialCategory}
                  onChange={set('materialCategory')}
                  required
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="pricing-material">
                Material type (optional)
              </label>
              <input
                id="pricing-material"
                className="input"
                value={form.materialType}
                onChange={set('materialType')}
                placeholder="e.g. Copper wire"
              />
            </div>
            <div>
              <label className="label" htmlFor="pricing-rate">
                Rate per kg (₹)
              </label>
              <input
                id="pricing-rate"
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.ratePerKg}
                onChange={set('ratePerKg')}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="pricing-pickup">
                Base pickup charge (₹)
              </label>
              <input
                id="pricing-pickup"
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.basePickupCharge}
                onChange={set('basePickupCharge')}
              />
            </div>
            <div>
              <label className="label" htmlFor="pricing-km">
                Charge per km (₹)
              </label>
              <input
                id="pricing-km"
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.perKmCharge}
                onChange={set('perKmCharge')}
              />
            </div>
            <div>
              <label className="label" htmlFor="pricing-fee">
                Platform fee (%)
              </label>
              <input
                id="pricing-fee"
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="input"
                value={form.platformFeePercent}
                onChange={set('platformFeePercent')}
              />
            </div>
            <div>
              <label className="label" htmlFor="pricing-tax">
                Tax (%)
              </label>
              <input
                id="pricing-tax"
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="input"
                value={form.taxPercent}
                onChange={set('taxPercent')}
              />
            </div>
            {['A', 'B', 'C', 'D'].map((grade) => (
              <div key={grade}>
                <label className="label" htmlFor={`pricing-q${grade}`}>
                  Quality {grade} multiplier
                </label>
                <input
                  id={`pricing-q${grade}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  className="input"
                  value={form[`quality${grade}`]}
                  onChange={set(`quality${grade}`)}
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label className="label" htmlFor="pricing-notes">
              Notes
            </label>
            <input
              id="pricing-notes"
              className="input"
              value={form.notes}
              onChange={set('notes')}
              placeholder="Why this rate was changed"
            />
          </div>

          <div className="mt-5 flex gap-2">
            <button className="btn-primary" disabled={busy} type="submit">
              {creating ? 'Create rule' : 'Save changes'}
            </button>
            <button className="btn-secondary" type="button" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner center />
        ) : data.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-ink-500">No pricing rules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Rate / kg</th>
                  <th className="px-4 py-3">Pickup</th>
                  <th className="px-4 py-3">Per km</th>
                  <th className="px-4 py-3">Fee / tax</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((rule) => (
                  <tr key={rule.id} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3">
                      {rule.materialCategory?.name || rule.materialCategory || '—'}
                    </td>
                    <td className="px-4 py-3">{rule.materialType || 'All types'}</td>
                    <td className="px-4 py-3 font-semibold">{paise(rule.ratePerKgPaise)}</td>
                    <td className="px-4 py-3">{paise(rule.basePickupChargePaise)}</td>
                    <td className="px-4 py-3">{paise(rule.perKmChargePaise)}</td>
                    <td className="px-4 py-3">
                      {rule.platformFeePercent}% / {rule.taxPercent}%
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">v{rule.version}</td>
                    <td className="px-4 py-3 text-xs text-ink-500">{dateTime(rule.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-2">
                        <span
                          className={`chip ${
                            rule.active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {rule.active ? 'Active' : 'Inactive'}
                        </span>
                        <button
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => openEdit(rule)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                          onClick={() => toggle(rule)}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {rule.active ? 'Disable' : 'Enable'}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={data.meta.totalPages || 1} onChange={setPage} />
      </div>
    </div>
  );
}
