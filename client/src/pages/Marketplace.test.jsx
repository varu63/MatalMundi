import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Marketplace from './Marketplace';

vi.mock('../lib/api', () => ({
  endpoints: {
    categories: { list: vi.fn() },
    marketplace: { list: vi.fn() },
  },
}));

import { endpoints } from '../lib/api';

const CATEGORIES = { data: { data: { categories: [{ id: 'c1', _id: 'c1', name: 'Batteries' }] } } };
const LISTINGS = { data: { data: [], meta: { page: 1, limit: 12, total: 0, totalPages: 0 } } };

function renderPage() {
  return render(
    <MemoryRouter>
      <Marketplace />
    </MemoryRouter>
  );
}

describe('Marketplace category filter', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    endpoints.marketplace.list.mockResolvedValue(LISTINGS);
  });

  it('renders category chips on success', async () => {
    endpoints.categories.list.mockResolvedValue(CATEGORIES);
    renderPage();
    const filters = await screen.findByText('Batteries');
    expect(filters).toBeInTheDocument();
  });

  it('shows a retry-able error when the fetch fails, then recovers', async () => {
    endpoints.categories.list
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(CATEGORIES);
    renderPage();

    await screen.findByText(/Categories failed to load/i);

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Batteries')).toBeInTheDocument());
    expect(endpoints.categories.list).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when no categories exist', async () => {
    endpoints.categories.list.mockResolvedValue({ data: { data: { categories: [] } } });
    renderPage();
    await screen.findByText(/No categories yet/i);
  });

  it('shows the empty listings state when the marketplace is empty', async () => {
    endpoints.categories.list.mockResolvedValue(CATEGORIES);
    renderPage();
    await screen.findByText(/No listings match/i);
  });
});
