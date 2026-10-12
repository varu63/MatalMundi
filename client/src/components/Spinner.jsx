export default function Spinner({ label, center }) {
  return (
    <div className={center ? 'flex h-[50vh] items-center justify-center' : ''}>
      <div className="flex flex-col items-center gap-2 text-ink-500">
        <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        {label && <span className="text-sm">{label}</span>}
      </div>
    </div>
  );
}