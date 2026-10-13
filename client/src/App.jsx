import { Routes, Route } from 'react-router-dom';
import { AppLayout, Protected, AdminOnly } from './components/Layout';

import Landing from './pages/Landing';
import Marketplace from './pages/Marketplace';
import ListingDetail from './pages/ListingDetail';
import Auctions from './pages/Auctions';
import AuctionDetail from './pages/AuctionDetail';
import Cart from './pages/Cart';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

import DashboardLayout from './pages/dashboard/DashboardLayout';
import DashboardHome from './pages/dashboard/DashboardHome';
import SubmitWaste from './pages/dashboard/SubmitWaste';
import MySubmissions from './pages/dashboard/MySubmissions';
import MyOrders from './pages/dashboard/MyOrders';
import MyAuctions from './pages/dashboard/MyAuctions';
import MyBids from './pages/dashboard/MyBids';

import AdminLayout from './pages/admin/AdminLayout';
import AdminOverview from './pages/admin/Overview';
import AdminSubmissions from './pages/admin/Submissions';
import AdminAuctions from './pages/admin/Auctions';
import AdminAuctionSettings from './pages/admin/AuctionSettings';
import AdminListings from './pages/admin/Listings';
import AdminOrders from './pages/admin/Orders';
import AdminUsers from './pages/admin/Users';
import AdminPricing from './pages/admin/Pricing';
import AdminCategories from './pages/admin/Categories';
import AdminInventory from './pages/admin/Inventory';
import AdminAudit from './pages/admin/Audit';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/marketplace/:id" element={<ListingDetail />} />
        <Route path="/auctions" element={<Auctions />} />
        <Route path="/auctions/:id" element={<AuctionDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/cart" element={<Cart />} />

        <Route
          path="/dashboard"
          element={
            <Protected>
              <DashboardLayout />
            </Protected>
          }
        >
          <Route index element={<DashboardHome />} />
          <Route path="submit" element={<SubmitWaste />} />
          <Route path="submissions" element={<MySubmissions />} />
          <Route path="auctions" element={<MyAuctions />} />
          <Route path="bids" element={<MyBids />} />
          <Route path="orders" element={<MyOrders />} />
        </Route>

        <Route
          path="/admin"
          element={
            <AdminOnly>
              <AdminLayout />
            </AdminOnly>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="submissions" element={<AdminSubmissions />} />
          <Route path="auctions" element={<AdminAuctions />} />
          <Route path="auction-settings" element={<AdminAuctionSettings />} />
          <Route path="listings" element={<AdminListings />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="pricing" element={<AdminPricing />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="inventory" element={<AdminInventory />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="text-6xl">🧭</p>
      <h1 className="page-title">Page not found</h1>
      <p className="text-ink-500">The page you are looking for does not exist.</p>
    </div>
  );
}