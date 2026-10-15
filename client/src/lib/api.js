import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ── CSRF (double-submit cookie) ─────────────────────────────────────────────
// The API issues a non-HttpOnly `mm.csrf` cookie (GET /auth/csrf on first use);
// every unsafe request must echo it back in the `x-csrf-token` header.
const UNSAFE_METHODS = ['post', 'put', 'patch', 'delete'];

function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)mm\.csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

let csrfPromise = null;

async function ensureCsrfToken() {
  const existing = readCsrfCookie();
  if (existing) return existing;
  if (!csrfPromise) {
    csrfPromise = api
      .get('/auth/csrf')
      .then(() => readCsrfCookie())
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

api.interceptors.request.use(async (config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!UNSAFE_METHODS.includes(method)) return config;
  const token = await ensureCsrfToken();
  if (token) config.headers['x-csrf-token'] = token;
  return config;
});

export const endpoints = {
  auth: {
    register: (d) => api.post('/auth/register', d),
    login: (d) => api.post('/auth/login', d),
    logout: () => api.post('/auth/logout'),
    me: () => api.get('/auth/me'),
  },
  marketplace: {
    list: (params) => api.get('/marketplace', { params }),
    get: (id) => api.get(`/marketplace/${id}`),
  },
  categories: {
    list: () => api.get('/categories'),
  },
  submissions: {
    create: (formData) =>
      api.post('/waste-submissions', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    estimate: (body) => api.post('/waste-submissions/estimate', body),
    my: (params) => api.get('/waste-submissions/my', { params }),
    get: (id) => api.get(`/waste-submissions/${id}`),
  },
  orders: {
    create: (body) => api.post('/orders', body),
    my: (params) => api.get('/orders/my', { params }),
  },
  auctions: {
    list: (params) => api.get('/auctions', { params }),
    get: (id) => api.get(`/auctions/${id}`),
    settings: () => api.get('/auctions/settings'),
    bids: (id, params) => api.get(`/auctions/${id}/bids`, { params }),
    placeBid: (id, body) => api.post(`/auctions/${id}/bids`, body),
    my: (params) => api.get('/auctions/my', { params }),
    myBids: (params) => api.get('/auctions/my/bids', { params }),
  },
  notifications: {
    my: () => api.get('/notifications/my'),
    readAll: () => api.patch('/notifications/read-all'),
    read: (id) => api.patch(`/notifications/${id}/read`),
  },
  admin: {
    dashboard: () => api.get('/admin/dashboard'),
    submissions: (params) => api.get('/admin/waste-submissions', { params }),
    submission: (id) => api.get(`/admin/waste-submissions/${id}`),
    submissionAction: (id, action, body) =>
      api.post(`/admin/waste-submissions/${id}/${action}`, body, formHeaders(body)),
    review: (id, body) => api.patch(`/admin/waste-submissions/${id}/review`, body),
    listings: (params) => api.get('/admin/listings', { params }),
    listing: (id) => api.get(`/admin/listings/${id}`),
    updateListing: (id, body) => api.patch(`/admin/listings/${id}`, body),
    listingStatus: (id, status) => api.patch(`/admin/listings/${id}/status`, { status }),
    recheckListing: (id) => api.post(`/admin/listings/${id}/recheck`),
    orders: (params) => api.get('/admin/orders', { params }),
    order: (id) => api.get(`/admin/orders/${id}`),
    orderStatus: (id, body) => api.patch(`/admin/orders/${id}/status`, body),
    users: (params) => api.get('/admin/users', { params }),
    pricing: (params) => api.get('/admin/pricing', { params }),
    updatePricing: (id, body) => api.patch(`/admin/pricing/${id}`, body),
    pricingToggle: (id, active) => api.patch(`/admin/pricing/${id}/status`, { active }),
    categories: () => api.get('/admin/categories'),
    createCategory: (body) => api.post('/admin/categories', body),
    updateCategory: (id, body) => api.patch(`/admin/categories/${id}`, body),
    inventory: (params) => api.get('/admin/inventory', { params }),
    lot: (id) => api.get(`/admin/inventory/${id}`),
    audit: (params) => api.get('/admin/audit-logs', { params }),
    auctions: (params) => api.get('/admin/auctions', { params }),
    auction: (id) => api.get(`/admin/auctions/${id}`),
    auctionBids: (id, params) => api.get(`/admin/auctions/${id}/bids`, { params }),
    updateAuction: (id, body) => api.patch(`/admin/auctions/${id}`, body),
    auctionAction: (id, action, body) => api.post(`/admin/auctions/${id}/${action}`, body),
    auctionSettings: () => api.get('/admin/auction-settings'),
    updateAuctionSettings: (body) => api.patch('/admin/auction-settings', body),
  },
};

function formHeaders(payload) {
  const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;
  return isFormData ? { 'Content-Type': 'multipart/form-data' } : {};
}

export function handleError(err) {
  const data = err?.response?.data;
  if (data?.details?.length) {
    return data.details.map((d) => d.message).join('. ');
  }
  return data?.message || err?.message || 'Something went wrong';
}
