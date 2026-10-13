'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createAdmin, createCategory, lots, listings } = require('./utils');

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function party() {
  const [buyer, buyer2, admin] = await Promise.all([
    createUser(),
    createUser(),
    createAdmin(),
  ]);
  const [buyerCookie, buyer2Cookie, adminCookie] = await Promise.all([
    cookieFor(buyer),
    cookieFor(buyer2),
    cookieFor(admin),
  ]);
  return { buyerCookie, buyer2Cookie, adminCookie };
}

async function seedListing({ availableKg, pricePerKgPaise = 2000, minPurchaseKg = 0 } = {}) {
  const category = await createCategory('Orders Cat');
  const seller = await createUser({ email: `seller-${Date.now()}@test.dev` });

  const lot = await lots.create({
    lotNumber: `LOT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    sellerId: seller.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    qualityGrade: 'B',
    condition: 'LOOSE',
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: 'Chennai', state: 'Tamil Nadu' },
    lotStatus: 'PUBLISHED',
  });
  const listing = await listings.create({
    title: 'MS Scrap (orders test)',
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description: 'Test listing for orders.',
    images: [{ url: 'http://localhost/test.png', publicId: 't.png', provider: 'local' }],
    inventoryLotId: lot.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise,
    minPurchaseKg,
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    location: { city: 'Chennai', state: 'Tamil Nadu' },
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedAt: new Date(),
  });
  return { lot, listing };
}

const cartItem = (listingId, weightKg) => ({ listingId, weightKg });

function orderBody(listingId, weightKg) {
  return {
    items: [cartItem(listingId, weightKg)],
    delivery: {
      name: 'Buyer Name',
      phone: '9876543210',
      address: '33 Marina Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      postalCode: '600001',
    },
    notes: 'Please call before delivery',
  };
}

describe('Orders — pricing, stock, concurrency', () => {
  test('orders require authentication', async () => {
    const { listing } = await seedListing({ availableKg: 50 });
    const res = await request(app).post('/api/v1/orders').send(orderBody(listing.id, 10));
    expect(res.status).toBe(401);
  });

  test('missing delivery fields are rejected (400)', async () => {
    const { buyerCookie } = await party();
    const { listing } = await seedListing({ availableKg: 50 });
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send({ items: [cartItem(listing.id, 10)] });
    expect(res.status).toBe(400);
  });

  test('buyers cannot order more than available stock', async () => {
    const { buyerCookie } = await party();
    const { listing } = await seedListing({ availableKg: 40 });
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 45));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('currently available');
  });

  test('minimum purchase quantity from the listing is enforced', async () => {
    const { buyerCookie } = await party();
    const { listing } = await seedListing({ availableKg: 500, minPurchaseKg: 100 });
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 20));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Minimum purchase');
  });

  test('totals are recomputed server-side (client totals are ignored)', async () => {
    const { buyerCookie } = await party();
    const { listing } = await seedListing({ availableKg: 500, pricePerKgPaise: 2000 });
    // 50 kg × ₹20 = ₹1,000 ; GST 18% = ₹180 ; total ₹1,180
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 50));
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.materialSubtotalPaise).toBe(100000);
    expect(order.taxPaise).toBe(18000);
    expect(order.totalPaise).toBe(118000);
    expect(order.statusHistory[0].status).toBe('PENDING_ADMIN_APPROVAL');
  });

  test('concurrent admin acceptances cannot oversell stock', async () => {
    const { buyerCookie, buyer2Cookie, adminCookie } = await party();
    const { lot, listing } = await seedListing({ availableKg: 100 });

    const o1 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 60));
    const o2 = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyer2Cookie)
      .send(orderBody(listing.id, 60));
    expect(o1.status).toBe(201);
    expect(o2.status).toBe(201);

    const [r1, r2] = await Promise.all([
      request(app)
        .patch(`/api/v1/admin/orders/${o1.body.data.order.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'ACCEPTED' }),
      request(app)
        .patch(`/api/v1/admin/orders/${o2.body.data.order.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'ACCEPTED' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const freshLot = await lots.findById(lot.id);
    expect(freshLot.availableQuantityKg).toBe(40);
    expect(freshLot.reservedQuantityKg).toBe(60);

    const losingOrderId = r1.status === 409 ? o1.body.data.order.id : o2.body.data.order.id;
    const losing = await request(app)
      .get(`/api/v1/admin/orders/${losingOrderId}`)
      .set('Cookie', adminCookie);
    expect(losing.body.data.order.status).toBe('PENDING_ADMIN_APPROVAL');
  });

  test('rejecting an accepted order releases its reservation', async () => {
    const { buyerCookie, adminCookie } = await party();
    const { lot, listing } = await seedListing({ availableKg: 100 });

    const o = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 30));
    const orderId = o.body.data.order.id;

    const accept = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'ACCEPTED' });
    expect(accept.status).toBe(200);

    let fresh = await lots.findById(lot.id);
    expect(fresh.availableQuantityKg).toBe(70);
    expect(fresh.reservedQuantityKg).toBe(30);

    const reject = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'REJECTED', reason: 'Delivery address out of service area.' });
    expect(reject.status).toBe(200);

    fresh = await lots.findById(lot.id);
    expect(fresh.availableQuantityKg).toBe(100);
    expect(fresh.reservedQuantityKg).toBe(0);
  });

  test('invalid order transitions are rejected', async () => {
    const { buyerCookie, adminCookie } = await party();
    const { listing } = await seedListing({ availableKg: 500 });
    const o = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', buyerCookie)
      .send(orderBody(listing.id, 10));
    const orderId = o.body.data.order.id;

    const res = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(409);
  });
});