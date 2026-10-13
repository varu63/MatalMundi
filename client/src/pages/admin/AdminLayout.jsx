import { Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-md bg-ink-900 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">Admin</span>
        <h1 className="page-title">Control center</h1>
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
