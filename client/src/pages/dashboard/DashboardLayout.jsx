import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, PackagePlus, ClipboardList, ShoppingBag } from 'lucide-react';

const tabs = [
  { to: '/dashboard', end: true, icon: LayoutDashboard, label: 'Overview' },
  { to: '/dashboard/submit', icon: PackagePlus, label: 'Submit waste' },
  { to: '/dashboard/submissions', icon: ClipboardList, label: 'My submissions' },
  { to: '/dashboard/orders', icon: ShoppingBag, label: 'My orders' },
];

export default function DashboardLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Dashboard</h1>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 hover:bg-ink-100'
              }`
            }
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}