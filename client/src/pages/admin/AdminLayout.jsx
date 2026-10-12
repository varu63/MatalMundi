import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Tag,
  ShoppingBag,
  Users,
  Percent,
  Layers,
  Boxes,
  ScrollText,
} from 'lucide-react';

const tabs = [
  { to: '/admin', end: true, icon: LayoutDashboard, label: 'Overview' },
  { to: '/admin/submissions', icon: ClipboardList, label: 'Submissions' },
  { to: '/admin/listings', icon: Tag, label: 'Listings' },
  { to: '/admin/orders', icon: ShoppingBag, label: 'Orders' },
  { to: '/admin/inventory', icon: Boxes, label: 'Inventory' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/pricing', icon: Percent, label: 'Pricing' },
  { to: '/admin/categories', icon: Layers, label: 'Categories' },
  { to: '/admin/audit', icon: ScrollText, label: 'Audit log' },
];

export default function AdminLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-md bg-ink-900 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">Admin</span>
        <h1 className="page-title">Control center</h1>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-ink-100'
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