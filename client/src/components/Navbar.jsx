import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Recycle,
  ShoppingCart,
  User,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  ClipboardList,
  ShoppingBag,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useSidebar } from '../context/SidebarContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { items } = useCart();
  const { isOpen, toggle } = useSidebar();
  const navigate = useNavigate();
  const itemCount = items.length;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const onLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/');
  };

  const accountLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/dashboard/submissions', label: 'My submissions', icon: ClipboardList },
    { to: '/dashboard/orders', label: 'My orders', icon: ShoppingBag },
    ...(user?.role === 'ADMIN' ? [{ to: '/admin', label: 'Admin console', icon: ShieldCheck }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={isOpen}
            className="rounded-lg p-2 text-ink-600 transition hover:bg-ink-100"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Recycle className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold text-ink-900">
              Metal<span className="text-brand-600">Mundi</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/cart"
            className="relative rounded-lg p-2 text-ink-600 transition hover:bg-ink-100"
          >
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">
                {itemCount}
              </span>
            )}
          </Link>

          {user ? (
            <>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                  title="Account menu"
                  className="flex items-center gap-1.5 rounded-lg p-2 text-ink-600 transition hover:bg-ink-100"
                >
                  <User className="h-5 w-5" />
                  <span className="hidden text-sm font-medium sm:block">
                    {user.name.split(' ')[0]}
                  </span>
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg"
                  >
                    <div className="border-b border-ink-100 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
                      <p className="truncate text-xs text-ink-500">{user.email}</p>
                    </div>
                    {accountLinks.map((l) => (
                      <Link
                        key={l.to}
                        to={l.to}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink-700 transition hover:bg-ink-50"
                      >
                        <l.icon className="h-4 w-4 text-ink-500" />
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={onLogout}
                className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-red-600"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost hidden sm:inline-flex">
                Log in
              </Link>
              <Link to="/register" className="btn-primary">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
