import { useEffect, useState } from 'react';
import { Settings2, ShieldCheck, Timer, TrendingUp, Save } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import Spinner from '../../components/Spinner';

const EMPTY = {
  minAuctionQuantityKg: '',
  sellerCanChooseDuration: true,
  defaultDurationMinutes: '',
  minDurationMinutes: '',
  maxDurationMinutes: '',
  allowedDurationsText: '',
  minIncrementType: 'FIXED',
  minIncrementValueText: '',
  antiSnipingEnabled: false,
  antiSnipingWindowSeconds: '',
  antiSnipingExtensionSeconds: '',
};

function toForm(s) {
  return {
    minAuctionQuantityKg: String(s.minAuctionQuantityKg ?? ''),
    sellerCanChooseDuration: Boolean(s.sellerCanChooseDuration),
    defaultDurationMinutes: String(s.defaultDurationMinutes ?? ''),
    minDurationMinutes: String(s.minDurationMinutes ?? ''),
    maxDurationMinutes: String(s.maxDurationMinutes ?? ''),
    allowedDurationsText: (s.allowedDurationsMinutes || []).join(', '),
    minIncrementType: s.minIncrementType || 'FIXED',
    minIncrementValueText:
      s.minIncrementType === 'PERCENT'
        ? String(s.minIncrementValue ?? '')
        : String((Number(s.minIncrementValue) || 0) / 100),
    antiSnipingEnabled: Boolean(s.antiSnipingEnabled),
    antiSnipingWindowSeconds: String(s.antiSnipingWindowSeconds ?? ''),
    antiSnipingExtensionSeconds: String(s.antiSnipingExtensionSeconds ?? ''),
  };
}

function parseAllowedDurations(text) {
  return text
    .split(',')
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

export default function AdminAuctionSettings() {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    endpoints.admin
      .auctionSettings()
      .then((r) => {
        setSettings(r.data.data.settings);
        setForm(toForm(r.data.data.settings));
      })
      .catch((err) => toast.error(handleError(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSave = async (e) => {
    e.preventDefault();
    const min = Number(form.minDurationMinutes);
    const max = Number(form.maxDurationMinutes);
    const def = Number(form.defaultDurationMinutes);
    const allowed = parseAllowedDurations(form.allowedDurationsText);
    const incrementValue =
      form.minIncrementType === 'PERCENT'
        ? Number(form.minIncrementValueText)
        : Math.round(Number(form.minIncrementValueText) * 100);

    if (allowed.length === 0) {
      toast.error('Provide at least one allowed duration');
      return;
    }
    if (allowed.some((d) => d < min || d > max)) {
      toast.error(`Allowed durations must be between ${min} and ${max} minutes`);
      return;
    }
    if (def < min || def > max) {
      toast.error('Default duration must fall within the min/max bounds');
      return;
    }
    if (!Number.isFinite(incrementValue) || incrementValue <= 0) {
      toast.error('Minimum increment must be a positive number');
      return;
    }

    setSaving(true);
    try {
      const r = await endpoints.admin.updateAuctionSettings({
        minAuctionQuantityKg: Number(form.minAuctionQuantityKg),
        sellerCanChooseDuration: form.sellerCanChooseDuration,
        defaultDurationMinutes: def,
        minDurationMinutes: min,
        maxDurationMinutes: max,
        allowedDurationsMinutes: allowed,
        minIncrementType: form.minIncrementType,
        minIncrementValue: incrementValue,
        antiSnipingEnabled: form.antiSnipingEnabled,
        antiSnipingWindowSeconds: Number(form.antiSnipingWindowSeconds),
        antiSnipingExtensionSeconds: Number(form.antiSnipingExtensionSeconds),
      });
      setSettings(r.data.data.settings);
      setForm(toForm(r.data.data.settings));
      toast.success('Auction settings updated');
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner center />;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <form onSubmit={onSave} className="card space-y-8 p-6">
        <div className="flex items-center justify-between gap-4 border-b border-ink-100 pb-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <Settings2 className="h-4 w-4 text-brand-600" /> Auction settings
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Platform-wide defaults for seller auctions: eligibility, durations, bid increments and
              anti-sniping.
            </p>
          </div>
          <button type="submit" className="btn-primary shrink-0" disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            <TrendingUp className="h-4 w-4" /> Eligibility &amp; pricing
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="auctionsettings-minimum-auction-quantity-kg">Minimum auction quantity (kg)</label>
              <input id="auctionsettings-minimum-auction-quantity-kg"
                type="number"
                min={100}
                step="1"
                className="input"
                value={form.minAuctionQuantityKg}
                onChange={set('minAuctionQuantityKg')}
                required
              />
              <p className="mt-1 text-xs text-ink-400">
                Auctions below this quantity are rejected at submission time. Normal sales keep
                their own minimum.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="auctionsettings-minimum-bid-increment">Minimum bid increment</label>
              <div className="flex gap-2">
                <select id="auctionsettings-minimum-bid-increment"
                  className="input w-36"
                  value={form.minIncrementType}
                  onChange={set('minIncrementType')}
                >
                  <option value="FIXED">Fixed (₹)</option>
                  <option value="PERCENT">Percent (%)</option>
                </select>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input flex-1"
                  value={form.minIncrementValueText}
                  onChange={set('minIncrementValueText')}
                  required
                />
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {form.minIncrementType === 'PERCENT'
                  ? 'Each new bid must beat the current price by this percentage.'
                  : 'Each new bid must beat the current price by this amount per kg.'}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            <Timer className="h-4 w-4" /> Durations
          </h3>
          <label className="flex items-center gap-3 rounded-lg border border-ink-200 p-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={form.sellerCanChooseDuration}
              onChange={set('sellerCanChooseDuration')}
            />
            <span className="text-sm text-ink-700">
              Sellers can choose the auction duration (otherwise the default below is always used)
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="auctionsettings-default-duration-min">Default duration (min)</label>
              <input id="auctionsettings-default-duration-min"
                type="number"
                min={1}
                className="input"
                value={form.defaultDurationMinutes}
                onChange={set('defaultDurationMinutes')}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="auctionsettings-minimum-duration-min">Minimum duration (min)</label>
              <input id="auctionsettings-minimum-duration-min"
                type="number"
                min={1}
                className="input"
                value={form.minDurationMinutes}
                onChange={set('minDurationMinutes')}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="auctionsettings-maximum-duration-min">Maximum duration (min)</label>
              <input id="auctionsettings-maximum-duration-min"
                type="number"
                min={1}
                className="input"
                value={form.maxDurationMinutes}
                onChange={set('maxDurationMinutes')}
                required
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="auctionsettings-allowed-durations-minutes-comma-separated">Allowed durations (minutes, comma-separated)</label>
            <input id="auctionsettings-allowed-durations-minutes-comma-separated"
              className="input"
              placeholder="10, 15, 30, 60"
              value={form.allowedDurationsText}
              onChange={set('allowedDurationsText')}
              required
            />
            <p className="mt-1 text-xs text-ink-400">
              The options a seller can pick from. Must fall within the min/max bounds. Admins may
              always set custom durations when approving.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            <ShieldCheck className="h-4 w-4" /> Anti-sniping (optional)
          </h3>
          <label className="flex items-center gap-3 rounded-lg border border-ink-200 p-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={form.antiSnipingEnabled}
              onChange={set('antiSnipingEnabled')}
            />
            <span className="text-sm text-ink-700">
              Extend the deadline when bids arrive near the end (off by default)
            </span>
          </label>
          {form.antiSnipingEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="auctionsettings-trigger-window-seconds-before-end">Trigger window (seconds before end)</label>
                <input id="auctionsettings-trigger-window-seconds-before-end"
                  type="number"
                  min={5}
                  max={3600}
                  className="input"
                  value={form.antiSnipingWindowSeconds}
                  onChange={set('antiSnipingWindowSeconds')}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="auctionsettings-extension-seconds-added">Extension (seconds added)</label>
                <input id="auctionsettings-extension-seconds-added"
                  type="number"
                  min={5}
                  max={3600}
                  className="input"
                  value={form.antiSnipingExtensionSeconds}
                  onChange={set('antiSnipingExtensionSeconds')}
                  required
                />
              </div>
            </div>
          )}
        </section>
      </form>

      <aside className="space-y-4 self-start xl:sticky xl:top-24">
        <div className="card p-5">
          <h3 className="font-semibold text-ink-900">Current values</h3>
          {settings ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Min auction quantity" value={`${settings.minAuctionQuantityKg} kg`} />
              <Row
                label="Seller picks duration"
                value={settings.sellerCanChooseDuration ? 'Yes' : 'No'}
              />
              <Row label="Default duration" value={`${settings.defaultDurationMinutes} min`} />
              <Row
                label="Min / max duration"
                value={`${settings.minDurationMinutes} / ${settings.maxDurationMinutes} min`}
              />
              <Row
                label="Allowed durations"
                value={(settings.allowedDurationsMinutes || []).join(', ') || '—'}
              />
              <Row
                label="Min increment"
                value={
                  settings.minIncrementType === 'PERCENT'
                    ? `${settings.minIncrementValue}%`
                    : `₹${(Number(settings.minIncrementValue) / 100).toFixed(2)}/kg`
                }
              />
              <Row
                label="Anti-sniping"
                value={
                  settings.antiSnipingEnabled
                    ? `On · last ${settings.antiSnipingWindowSeconds}s → +${settings.antiSnipingExtensionSeconds}s`
                    : 'Off'
                }
              />
              {settings.updatedAt && (
                <Row label="Last updated" value={new Date(settings.updatedAt).toLocaleString()} />
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-500">Not loaded.</p>
          )}
          <p className="mt-4 text-xs text-ink-400">
            Changes are audited. They apply to new auctions and to admin approvals — live auctions
            with bids are never silently changed.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
