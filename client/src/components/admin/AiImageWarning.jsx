import { AlertTriangle, Loader2 } from 'lucide-react';

const pct = (score) => Math.round((score || 0) * 100);

/**
 * Warn-only AI-image screening indicators. A listing is never blocked or
 * hidden by these — they only tell the admin a manual photo review is wise.
 * Clean listings render nothing.
 */
export function AiImageBadge({ check }) {
  if (!check) return null;
  if (check.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
      </span>
    );
  }
  if (check.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Check failed
      </span>
    );
  }
  if (check.flagged) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
        <AlertTriangle className="h-3 w-3" /> Possible AI image ({pct(check.maxAiScore)}%)
      </span>
    );
  }
  return null;
}

export function AiImageAlert({ check }) {
  if (!check?.flagged) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <p>
        <strong>Warning:</strong> the photos on this listing look AI-generated (score{' '}
        {pct(check.maxAiScore)}%). Review the photos manually before approving. Detectors can be
        wrong.
      </p>
    </div>
  );
}
