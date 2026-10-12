'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createAdmin, submitWaste } = require('./utils');

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function sellerAndAdminCookies() {
  const [seller, admin] = await Promise.all([createUser(), createAdmin()]);
  const [sellerCookie, adminCookie] = await Promise.all([cookieFor(seller), cookieFor(admin)]);
  return { sellerCookie, adminCookie };
}

async function approveCollectAndPublish(cookie, submissionId) {
  const review = await request(app)
    .patch(`/api/v1/admin/waste-submissions/${submissionId}/review`)
    .set('Cookie', cookie)
    .send({ status: 'UNDER_REVIEW' });
  expect(review.status).toBe(200);

  const approve = await request(app)
    .post(`/api/v1/admin/waste-submissions/${submissionId}/approve`)
    .set('Cookie', cookie)
    .send({});
  expect(approve.status).toBe(200);

  const collect = await request(app)
    .post(`/api/v1/admin/waste-submissions/${submissionId}/collect`)
    .set('Cookie', cookie)
    .send({ acceptedQuantityKg: 100 });
  expect(collect.status).toBe(200);

  return request(app)
    .post(`/api/v1/admin/waste-submissions/${submissionId}/publish`)
    .set('Cookie', cookie)
    .field('title', 'Public MS Scrap listing')
    .field('description', 'Sorted loose mild steel scrap for sale.')
    .field('pricePerKg', '25')
    .field('minPurchaseKg', '0')
    .field('deliveryTerms', 'Pickup from yard');
}

describe('Marketplace visibility & data integrity', () => {
  test('approved but unpublished material stays hidden', async () => {
    const { sellerCookie, adminCookie } = await sellerAndAdminCookies();

    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 150 });
    expect(sub.status).toBe(201);
    const id = sub.body.data.submission.id;

    const approve = await request(app)
      .post(`/api/v1/admin/waste-submissions/${id}/approve`)
      .set('Cookie', adminCookie)
      .send({});
    expect(approve.status).toBe(200);

    const market = await request(app).get('/api/v1/marketplace');
    expect(market.status).toBe(200);
    expect(market.body.data).toHaveLength(0);
  });

  test('rejected materials cannot be published', async () => {
    const { sellerCookie, adminCookie } = await sellerAndAdminCookies();
    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 140 });
    const id = sub.body.data.submission.id;

    const reject = await request(app)
      .post(`/api/v1/admin/waste-submissions/${id}/reject`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Material did not meet quality standards.' });
    expect(reject.status).toBe(200);

    const publish = await request(app)
      .post(`/api/v1/admin/waste-submissions/${id}/publish`)
      .set('Cookie', adminCookie)
      .field('title', 'Should never appear')
      .field('description', 'rejected material')
      .field('pricePerKg', '10');
    expect(publish.status).toBe(409);
  });

  test('published listings appear with prices and stock from the database', async () => {
    const { sellerCookie, adminCookie } = await sellerAndAdminCookies();
    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 100 });
    const id = sub.body.data.submission.id;

    const published = await approveCollectAndPublish(adminCookie, id);
    expect(published.status).toBe(200);
    const listingId = published.body.data.listing.id;

    const market = await request(app).get('/api/v1/marketplace');
    expect(market.status).toBe(200);
    const found = market.body.data.find((l) => l.id === listingId);
    expect(found).toBeTruthy();
    expect(found.pricePerKgPaise).toBe(2500); // ₹25 from DB, not client
    expect(found.availableQuantityKg).toBe(100);

    const detail = await request(app).get(`/api/v1/marketplace/${listingId}`);
    expect(detail.status).toBe(200);
    const listing = detail.body.data.listing;
    // Private seller details are never exposed publicly.
    const serialized = JSON.stringify(listing);
    expect(serialized).not.toContain('contactPhone');
    expect(serialized).not.toContain('pickup');
    expect(listing.seller).toBeUndefined();
  });

  test('price changes are immediately reflected on the public marketplace', async () => {
    const { sellerCookie, adminCookie } = await sellerAndAdminCookies();
    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 110 });
    const id = sub.body.data.submission.id;
    const published = await approveCollectAndPublish(adminCookie, id);
    const listingId = published.body.data.listing.id;

    const update = await request(app)
      .patch(`/api/v1/admin/listings/${listingId}`)
      .set('Cookie', adminCookie)
      .send({ pricePerKg: 30 });
    expect(update.status).toBe(200);

    const market = await request(app).get('/api/v1/marketplace');
    const found = market.body.data.find((l) => l.id === listingId);
    expect(found.pricePerKgPaise).toBe(3000);
  });

  test('pausing a listing removes it from the marketplace; republishing restores it', async () => {
    const { sellerCookie, adminCookie } = await sellerAndAdminCookies();
    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 120 });
    const id = sub.body.data.submission.id;
    const published = await approveCollectAndPublish(adminCookie, id);
    const listingId = published.body.data.listing.id;

    const pause = await request(app)
      .patch(`/api/v1/admin/listings/${listingId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'PAUSED' });
    expect(pause.status).toBe(200);

    const market = await request(app).get('/api/v1/marketplace');
    expect(market.body.data.find((l) => l.id === listingId)).toBeUndefined();

    const republish = await request(app)
      .patch(`/api/v1/admin/listings/${listingId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'PUBLISHED' });
    expect(republish.status).toBe(200);

    const marketAgain = await request(app).get('/api/v1/marketplace');
    expect(marketAgain.body.data.find((l) => l.id === listingId)).toBeTruthy();
  });

  test('seller cannot publish their own material directly', async () => {
    const { sellerCookie } = await sellerAndAdminCookies();
    const sub = await submitWaste({ cookie: sellerCookie, quantityKg: 130 });
    const id = sub.body.data.submission.id;

    const publish = await request(app)
      .post(`/api/v1/admin/waste-submissions/${id}/publish`)
      .set('Cookie', sellerCookie)
      .field('title', 'Self publish')
      .field('description', 'nope')
      .field('pricePerKg', '10');
    expect(publish.status).toBe(403);
  });
});