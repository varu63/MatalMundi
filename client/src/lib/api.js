import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
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
    create: (formData) => api.post('/waste-submissions', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
    estimate: (body) => api.post('/waste-submissions/estimate', body),
    my: (params) => api.get('/waste-submissions/my', { params }),
    get: (id) => api.get(`/waste-submissions/${id}`),
  },
  orders: {
    create: (body) => api.post('/orders', body),
    my: (params) => api.get('/orders/my', { params }),
  },
  notifications: {
    my: () => api.get('/notifications/my'),
    readAll: () => api.patch('/notifications/read-all'),
    read: (id) => api.patch(`/notifications/${id}/read`),
  },
  admin: {
    dashboard: () => api.get('/admin/dashboard'),
    submissions: (params) => api.get('/admin/waste-submissions', { params }),
    submissionAction: (id, action, body) =>
      api.post(`/admin/waste-submissions/${id}/${action}`, body, formHeaders(body)),
    review: (id, body) => api.patch(`/admin/waste-submissions/${id}/review`, body),
    listings: (params) => api.get('/admin/listings', { params }),
    listing: (id) => api.get(`/admin/listings/${id}`),
    updateListing: (id, body) => api.patch(`/admin/listings/${id}`, body),
    listingStatus: (id, status) => api.patch(`/admin/listings/${id}/status`, { status }),
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