import { Outlet, Navigate, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import Footer from './Footer';
import Spinner from './Spinner';
import { useAuth } from '../context/AuthContext';

export function AppLayout() {
  const { loading } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <Sidebar />
      <main className="flex-1">
        {loading ? (
          <div className="flex h-[60vh] items-center justify-center">
            <Spinner label="Loading…" />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <Footer />
    </div>
  );
}

export function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner center />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner center />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return children;
}
