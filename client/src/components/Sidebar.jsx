import { useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  Recycle,
  Home,
  Store,
  Gavel,
  LayoutDashboard,
  PackagePlus,
  ClipboardList,
  TrendingUp,
  ShoppingBag,
  Truck,
  Tag,
  Boxes,
  Users,
  Percent,
  Layers,
  ScrollText,
  Settings2,
  X,
} from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';

const browseLinks = [
  { to: '/', end: true, icon: Home, label: 'Home' },
  { to: '/marketplace', icon: Store, label: 'Marketplace' },
  { to: '/auctions', icon: Gavel, label: 'Auctions' },
];

const dashboardLinks = [
  { to: '/dashboard', end: true, icon: LayoutDashboard, label: 'Overview' },
  { to: '/dashboard/submit', icon: PackagePlus, label: 'Submit waste' },
  { to: '/dashboard/submissions', icon: ClipboardList, label: 'My submissions' },
  { to: '/dashboard/auctions', icon: Gavel, label: 'My auctions' },
  { to: '/dashboard/bids', icon: TrendingUp, label: 'My bids' },
  { to: '/dashboard/orders', icon: ShoppingBag, label: 'My orders' },
  { to: '/dashboard/selling', icon: Truck, label: 'Sale requests' },
];

const adminLinks = [
  { to: '/admin', end: true, icon: LayoutDashboard, label: 'Overview' },
  { to: '/admin/submissions', icon: ClipboardList, label: 'Submissions' },
  { to: '/admin/auctions', icon: Gavel, label: 'Auctions' },
  { to: '/admin/listings', icon: Tag, label: 'Listings' },
  { to: '/admin/orders', icon: ShoppingBag, label: 'Orders' },
  { to: '/admin/inventory', icon: Boxes, label: 'Inventory' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/pricing', icon: Percent, label: 'Pricing' },
  { to: '/admin/categories', icon: Layers, label: 'Categories' },
  { to: '/admin/audit', icon: ScrollText, label: 'Audit log' },
  { to: '/admin/auction-settings', icon: Settings2, label: 'Auction settings' },
];

function SidebarSection({ title, links, onNavigate }) {
  return (
    <div className="pt-3 first:pt-0">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </p>
      <div className="space-y-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
              }`
            }
          >
            <l.icon className="h-4 w-4" />
            {l.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { isOpen, close } = useSidebar();
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 top-16 z-40 bg-ink-900/40 transition-opacity ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        aria-label="Site navigation"
        className={`fixed bottom-0 left-0 top-16 z-50 flex w-72 max-w-[85vw] flex-col border-r border-ink-100 bg-white shadow-xl transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-4">
          <Link to="/" onClick={close} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Recycle className="h-4 w-4" />
            </span>
            <span className="text-base font-bold text-ink-900">
              Metal<span className="text-brand-600">Mundi</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">
          <SidebarSection title="Browse" links={browseLinks} onNavigate={close} />
          {user && <SidebarSection title="Dashboard" links={dashboardLinks} onNavigate={close} />}
          {user?.role === 'ADMIN' && (
            <SidebarSection title="Admin" links={adminLinks} onNavigate={close} />
          )}
        </nav>
      </aside>
    </>
  );
}
