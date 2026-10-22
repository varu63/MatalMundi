import { useCallback, useEffect, useState } from 'react';
import { Layers, Plus, Power, X } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import Spinner from '../../components/Spinner';

const EMPTY_FORM = { name: '', description: '', icon: 'recycle', sortOrder: '0', active: true };

export default function AdminCategories() {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .categories()
      .then((r) => setCategories(r.data.data.categories || []))
      .catch((err) => {
        toast.error(handleError(err));
        setCategories([]);
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(loadList, [loadList]);

  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
  };

  const openEdit = (category) => {
    setCreating(false);
    setEditing(category.id);
    setForm({
      name: category.name,
      description: category.description || '',
      icon: category.icon || 'recycle',
      sortOrder: String(category.sortOrder ?? 0),
      active: category.active !== false,
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
      name: form.name,
      description: form.description,
      icon: form.icon,
      sortOrder: Number(form.sortOrder),
      active: Boolean(form.active),
    };
    try {
      if (creating) {
        const res = await endpoints.admin.createCategory(payload);
        toast.success(res.data.message || 'Category created');
      } else {
        const res = await endpoints.admin.updateCategory(editing, payload);
        toast.success(res.data.message || 'Category updated');
      }
      closeForm();
      loadList();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (category) => {
    try {
      const res = await endpoints.admin.updateCategory(category.id, {
        active: !category.active,
      });
      toast.success(res.data.message || 'Category updated');
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
              <Layers className="h-4 w-4 text-brand-600" /> Material categories
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Categories drive marketplace filters and pricing rules. Hiding one keeps existing
              listings intact.
            </p>
          </div>
          {!showForm && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New category
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="card p-5" onSubmit={submit}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-ink-900">
              {creating ? 'New category' : 'Edit category'}
            </h3>
            <button type="button" className="btn-secondary px-2 py-1" onClick={closeForm}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="category-name">
                Name
              </label>
              <input
                id="category-name"
                className="input"
                value={form.name}
                onChange={set('name')}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="category-icon">
                Icon key
              </label>
              <input
                id="category-icon"
                className="input"
                value={form.icon}
                onChange={set('icon')}
                placeholder="recycle"
              />
            </div>
            <div>
              <label className="label" htmlFor="category-sort">
                Sort order
              </label>
              <input
                id="category-sort"
                type="number"
                className="input"
                value={form.sortOrder}
                onChange={set('sortOrder')}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink-300"
                  checked={form.active}
                  onChange={set('active')}
                />
                Visible in the marketplace
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="category-description">
                Description
              </label>
              <textarea
                id="category-description"
                className="input h-20"
                value={form.description}
                onChange={set('description')}
              />
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button className="btn-primary" disabled={busy} type="submit">
              {creating ? 'Create category' : 'Save changes'}
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
        ) : categories.length === 0 ? (
          <p className="p-10 text-center text-sm text-ink-500">No categories yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3 font-semibold text-ink-900">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-500">{c.slug}</td>
                    <td className="px-4 py-3 text-ink-600">{c.description || '—'}</td>
                    <td className="px-4 py-3 text-ink-600">{c.sortOrder ?? 0}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`chip ${
                          c.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {c.active ? 'Visible' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-2">
                        <button
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                          onClick={() => toggleActive(c)}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {c.active ? 'Hide' : 'Show'}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
