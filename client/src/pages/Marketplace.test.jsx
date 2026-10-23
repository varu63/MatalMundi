import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Marketplace from './Marketplace';

vi.mock('../lib/api', () => ({
  endpoints: {
    categories: { list: vi.fn() },
    marketplace: { list: vi.fn(), geocode: vi.fn() },
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

describe('Marketplace location search', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    endpoints.categories.list.mockResolvedValue(CATEGORIES);
    endpoints.marketplace.list.mockResolvedValue(LISTINGS);
    endpoints.marketplace.geocode.mockResolvedValue({ data: { data: { enabled: false, results: [] } } });
  });

  function stubGeolocation(handler) {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: vi.fn(handler) },
      configurable: true,
    });
  }

  it('searches by distance once browser geolocation is allowed', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 13.0827, longitude: 80.275 } }));
    renderPage();
    await screen.findByText('Batteries');

    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }));
    expect(await screen.findByText('My current location')).toBeInTheDocument();

    await waitFor(() =>
      expect(endpoints.marketplace.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ lat: 13.0827, lng: 80.275, radiusKm: 50, sort: 'nearby' })
      )
    );
  });

  it('explains a declined permission and keeps the typed search usable', async () => {
    stubGeolocation((_, fail) => fail(Object.assign(new Error('denied'), { code: 1, PERMISSION_DENIED: 1 })));
    renderPage();
    await screen.findByText('Batteries');

    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }));
    expect(await screen.findByText(/declined/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by place/i)).toBeInTheDocument();
  });

  it('falls back to a city filter when no geocoder is configured', async () => {
    renderPage();
    await screen.findByText('Batteries');

    await userEvent.type(screen.getByLabelText(/search by place/i), 'Chennai');
    await userEvent.click(screen.getByRole('button', { name: /^find$/i }));

    expect(await screen.findByText(/City: Chennai/)).toBeInTheDocument();
    await waitFor(() =>
      expect(endpoints.marketplace.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ city: 'Chennai' })
      )
    );
    expect(endpoints.marketplace.list.mock.calls.at(-1)[0].lat).toBeUndefined();
  });

  it('resolves a typed place and searches from its coordinates', async () => {
    endpoints.marketplace.geocode.mockResolvedValue({
      data: {
        data: {
          enabled: true,
          results: [
            { latitude: 13.0827, longitude: 80.275, displayName: 'Chennai, Tamil Nadu' },
            { latitude: 12.9716, longitude: 77.5946, displayName: 'Chennai St, Bengaluru' },
          ],
        },
      },
    });
    renderPage();
    await screen.findByText('Batteries');

    await userEvent.type(screen.getByLabelText(/search by place/i), 'Chennai');
    await userEvent.click(screen.getByRole('button', { name: /^find$/i }));

    await userEvent.click(await screen.findByText('Chennai, Tamil Nadu'));
    expect(await screen.findByText('Chennai, Tamil Nadu')).toBeInTheDocument();
    await waitFor(() =>
      expect(endpoints.marketplace.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ lat: 13.0827, radiusKm: 50 })
      )
    );
  });

  it('offers a wider radius when the circle is empty', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 13.0827, longitude: 80.275 } }));
    endpoints.marketplace.list.mockResolvedValue({
      data: { data: [], meta: { page: 1, limit: 12, total: 0, totalPages: 0, noResultsWithinRadius: true } },
    });
    renderPage();
    await screen.findByText('Batteries');

    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }));
    expect(await screen.findByText(/No materials within 50 km/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /increase radius/i }));
    await waitFor(() =>
      expect(endpoints.marketplace.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ radiusKm: 100 })
      )
    );
  });
});
