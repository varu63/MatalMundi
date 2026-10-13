import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button
        className="btn-secondary px-2 py-1.5"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm text-ink-600">
        Page {page} of {pages}
      </span>
      <button
        className="btn-secondary px-2 py-1.5"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
