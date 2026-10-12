import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Recycle, ShoppingCart, User, LogOut, LayoutDashboard, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { endpoints } from '../lib/api';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { items } = useCart();
  const navigate = useNavigate();
  const itemCount = items.length;

  const linkClass = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100'
    }`;

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Recycle className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold text-ink-900">
            Metal<span className="text-brand-600">Mundi</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink to="/marketplace" className={linkClass}>
            Marketplace
          </NavLink>
          {user && (
            <NavLink to="/dashboard" className={linkClass}>
              Dashboard
            </NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/cart" className="relative rounded-lg p-2 text-ink-600 transition hover:bg-ink-100">
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">
                {itemCount}
              </span>
            )}
          </Link>

          {user ? (
            <>
              <div className="relative">
                <button className="flex items-center gap-1.5 rounded-lg p-2 text-ink-600 transition hover:bg-ink-100">
                  <User className="h-5 w-5" />
                  <span className="hidden text-sm font-medium sm:block">{user.name.split(' ')[0]}</span>
                </button>
              </div>
              <button
                onClick={onLogout}
                className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-red-600"
                title="Log out"
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