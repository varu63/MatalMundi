export const paise = (n) =>
  `₹${(Number(n ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const kg = (n) => `${Number(n ?? 0).toLocaleString('en-IN')} kg`;

export const dateTime = (v) =>
  new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const dateOnly = (v) =>
  new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const statusTone = (status) => {
  const s = String(status || '').toUpperCase();
  const map = {
    PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
    UNDER_REVIEW: 'bg-blue-100 text-blue-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800',
    COLLECTED: 'bg-teal-100 text-teal-800',
    LISTED: 'bg-green-100 text-green-800',
    PUBLISHED: 'bg-green-100 text-green-800',
    PAUSED: 'bg-slate-100 text-slate-700',
    DRAFT: 'bg-slate-100 text-slate-700',
    SOLD_OUT: 'bg-orange-100 text-orange-800',
    PENDING_ADMIN_APPROVAL: 'bg-amber-100 text-amber-800',
    ACCEPTED: 'bg-emerald-100 text-emerald-800',
    CONFIRMED: 'bg-blue-100 text-blue-800',
    PROCESSING: 'bg-indigo-100 text-indigo-800',
    READY_FOR_DISPATCH: 'bg-violet-100 text-violet-800',
    DISPATCHED: 'bg-purple-100 text-purple-800',
    DELIVERED: 'bg-green-100 text-green-800',
    REJECTED_BY_ADMIN: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-red-100 text-red-800',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    SUSPENDED: 'bg-red-100 text-red-800',
    SCHEDULED: 'bg-blue-100 text-blue-800',
    ENDED: 'bg-slate-100 text-slate-700',
    NO_BIDS: 'bg-slate-100 text-slate-700',
    AWAITING_PAYMENT: 'bg-amber-100 text-amber-800',
    AWAITING_PICKUP: 'bg-indigo-100 text-indigo-800',
    COMPLETED: 'bg-green-100 text-green-800',
    LEADING: 'bg-emerald-100 text-emerald-800',
    OUTBID: 'bg-orange-100 text-orange-800',
    WON: 'bg-green-100 text-green-800',
    LOST: 'bg-slate-100 text-slate-700',
  };
  return map[s] || 'bg-gray-100 text-gray-700';
};

/** mm:ss / hh:mm:ss left until an ISO timestamp ('' when past). */
export const countdown = (iso) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export const imageUrl = (img) => (img?.url ? img.url : '');

export const firstImage = (images) => imageUrl(Array.isArray(images) ? images[0] : images);