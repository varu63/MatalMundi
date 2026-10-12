export default function Placeholder({ title }) {
  return (
    <div className="card flex flex-col items-center justify-center py-16 text-center">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        This view will be connected to the corresponding admin endpoints. For the purpose of this build it is stubbed out.
      </p>
    </div>
  );
}