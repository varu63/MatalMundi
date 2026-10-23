'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createCategory, lots, listings } = require('./utils');

let seq = 0;

/**
 * Publishes a listing at an exact pickup point. `withCoords: false` models the
 * real-world case of a typed address that never produced coordinates.
 */
async function publishAt({ city, state, latitude, longitude, withCoords = true, pricePerKgPaise = 2000 }) {
  seq += 1;
  const category = await createCategory(`Nearby Cat ${seq}`);
  const seller = await createUser({ email: `nearby-seller-${seq}-${Date.now()}@test.dev` });
  const lot = await lots.create({
    lotNumber: `LOT-N-${Date.now()}-${seq}`,
    sellerId: seller.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    qualityGrade: 'B',
    condition: 'LOOSE',
    acceptedQuantityKg: 200,
    availableQuantityKg: 200,
    lotStatus: 'PUBLISHED',
    location: { city, state },
  });
  const listing = await listings.create({
    title: `Nearby MS Scrap ${seq}`,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description: 'Sorted loose mild steel scrap used by the nearby search suite.',
    images: [],
    inventoryLotId: lot.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise,
    minPurchaseKg: 0,
    acceptedQuantityKg: 200,
    availableQuantityKg: 200,
    location: { city, state, address: 'Private yard address must never leak' },
    city,
    state,
    latitude: withCoords ? latitude : null,
    longitude: withCoords ? longitude : null,
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedAt: new Date(),
  });
  return listing;
}

// Chennai ≈ 13.0827, 80.275 — the two test points sit a handful of km apart.
const ORIGIN = { lat: 13.0827, lng: 80.275 };
const NEAR = { latitude: 13.12, longitude: 80.29 }; // ≈ 4.5 km
const FAR = { latitude: 12.9716, longitude: 77.5946 }; // ≈ 330 km (Bengaluru)

describe('Marketplace nearby search', () => {
  test('results are filtered by radius and sorted by distance', async () => {
    const near = await publishAt({ ...NEAR, city: 'Chennai', state: 'Tamil Nadu' });
    const far = await publishAt({ ...FAR, city: 'Bengaluru', state: 'Karnataka' });

    const res = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 25, sort: 'nearby' });

    expect(res.status).toBe(200);
    const ids = res.body.data.map((l) => l.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
    expect(res.body.data[0].distanceKm).toBeLessThan(25);
    expect(res.body.meta.radiusKm).toBe(25);
    expect(res.body.meta.origin).toEqual({ latitude: ORIGIN.lat, longitude: ORIGIN.lng });

    const wide = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 500, sort: 'nearby' });
    const wideIds = wide.body.data.map((l) => l.id);
    expect(wideIds.indexOf(near.id)).toBeLessThan(wideIds.indexOf(far.id));
  });

  test('listings without coordinates are excluded instead of breaking the search', async () => {
    const blind = await publishAt({
      ...NEAR,
      city: 'Chennai',
      state: 'Tamil Nadu',
      withCoords: false,
    });

    const res = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: ORIGIN.lat, lng: ORIGIN.lng, radiusKm: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).not.toContain(blind.id);

    // The same listing is still reachable in the plain catalogue.
    const plain = await request(app).get('/api/v1/marketplace');
    expect(plain.body.data.map((l) => l.id)).toContain(blind.id);
    expect(plain.body.data.find((l) => l.id === blind.id).distanceKm).toBeUndefined();
  });

  test('an empty circle reports noResultsWithinRadius so the UI can widen it', async () => {
    await publishAt({ ...FAR, city: 'Bengaluru', state: 'Karnataka' });
    const res = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: 22.5726, lng: 88.3639, radiusKm: 5 }); // Kolkata
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.noResultsWithinRadius).toBe(true);
  });

  test('invalid coordinates fall back to the unlocated catalogue', async () => {
    await publishAt({ ...NEAR, city: 'Chennai', state: 'Tamil Nadu' });
    const res = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: 'not-a-number', lng: 999, radiusKm: 25 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.origin).toBeUndefined();
  });

  test('public listings expose no street address or exact coordinates', async () => {
    const listing = await publishAt({ ...NEAR, city: 'Chennai', state: 'Tamil Nadu' });

    const list = await request(app).get('/api/v1/marketplace').query({ city: 'Chennai' });
    const card = list.body.data.find((l) => l.id === listing.id);
    expect(card).toBeTruthy();
    expect(card.city).toBe('Chennai');
    const serialized = JSON.stringify(list.body.data);
    expect(serialized).not.toContain('Private yard address must never leak');
    expect(serialized).not.toContain(String(NEAR.latitude));

    const detail = await request(app).get(`/api/v1/marketplace/${listing.id}`);
    expect(JSON.stringify(detail.body)).not.toContain('Private yard address must never leak');
  });

  test('a typed place can be matched by its city segment', async () => {
    const listing = await publishAt({ ...NEAR, city: 'Chennai', state: 'Tamil Nadu' });
    await publishAt({ ...FAR, city: 'Bengaluru', state: 'Karnataka' });

    const res = await request(app)
      .get('/api/v1/marketplace')
      .query({ city: 'Chennai, Tamil Nadu' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(listing.id);
  });

  test('the geocode proxy is inert when no provider is configured', async () => {
    const res = await request(app).get('/api/v1/marketplace/geocode').query({ q: 'Chennai' });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.results).toEqual([]);
  });
});
