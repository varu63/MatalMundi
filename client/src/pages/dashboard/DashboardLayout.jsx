import { Outlet } from 'react-router-dom';

export default function DashboardLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Dashboard</h1>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
