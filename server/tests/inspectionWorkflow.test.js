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

async function seedListing({ availableKg = 100, pricePerKgPaise = 2000 }) {
  const category = await createCategory('Inspection Cat');
  const seller = await createUser({ email: `insp-seller-${Date.now()}-${Math.random()}@test.dev` });
  const lot = await lots.create({
    lotNumber: `LOT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
    title: 'MS Scrap (inspection test)',
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description: 'Test listing used by the inspection workflow suite.',
    images: [],
    inventoryLotId: lot.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise,
    minPurchaseKg: 0,
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    location: { city: 'Chennai', state: 'Tamil Nadu' },
    city: 'Chennai',
    state: 'Tamil Nadu',
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedAt: new Date(),
  });
  return { lot, listing, seller };
}

/** Seller + buyer + admin with an ACCEPTED order for 30 kg already in place. */
async function acceptedOrder({ weightKg = 30, availableKg = 100, pricePerKgPaise = 2000 } = {}) {
  const { lot, listing, seller } = await seedListing({ availableKg, pricePerKgPaise });
  const [buyer, other, admin] = await Promise.all([createUser(), createUser(), createAdmin()]);
  const [sCookie, bCookie, oCookie, aCookie] = await Promise.all([
    cookieFor(seller),
    cookieFor(buyer),
    cookieFor(other),
    cookieFor(admin),
  ]);

  const placed = await request(app)
    .post('/api/v1/orders')
    .set('Cookie', bCookie)
    .send({
      items: [{ listingId: listing.id, weightKg }],
      delivery: {
        name: 'Buyer One',
        phone: '9876500001',
        address: '7 Marina Beach Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600001',
      },
    });
  expect(placed.status).toBe(201);
  const orderId = placed.body.data.order.id;

  const accept = await request(app)
    .patch(`/api/v1/admin/orders/${orderId}/status`)
    .set('Cookie', aCookie)
    .send({ status: 'ACCEPTED' });
  expect(accept.status).toBe(200);

  return { lot, listing, orderId, sCookie, bCookie, oCookie, aCookie };
}

const inspect = (aCookie, orderId, body) =>
  request(app).patch(`/api/v1/admin/orders/${orderId}/inspection`).set('Cookie', aCookie).send(body);
const charge = (aCookie, orderId, deliveryChargePaise, notes = 'Truck from the yard.') =>
  request(app)
    .patch(`/api/v1/admin/orders/${orderId}/delivery-charge`)
    .set('Cookie', aCookie)
    .send({ deliveryChargePaise, notes });
const setStatus = (cookie, orderId, status) =>
  request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Cookie', cookie).send({ status });

describe('Inspection → delivery charge → buyer confirmation', () => {
  test('a passed inspection must record the actual quantity weighed out', async () => {
    const { aCookie, orderId } = await acceptedOrder();
    const res = await inspect(aCookie, orderId, { status: 'PASSED', notes: 'Looks fine.' });
    expect(res.status).toBe(400);
  });

  test('scheduling an inspection requires a date and time', async () => {
    const { aCookie, orderId } = await acceptedOrder();
    const res = await inspect(aCookie, orderId, { status: 'SCHEDULED' });
    expect(res.status).toBe(400);
  });

  test('a delivery charge cannot be set before the inspection passes', async () => {
    const { aCookie, orderId } = await acceptedOrder();
    const res = await charge(aCookie, orderId, 150000);
    expect(res.status).toBe(409);
  });

  test('statuses earned by the workflow cannot be typed into the status endpoint', async () => {
    const { aCookie, orderId } = await acceptedOrder();

    const skipConfirm = await setStatus(aCookie, orderId, 'AWAITING_BUYER_CONFIRMATION');
    expect(skipConfirm.status).toBe(409);

    const skipInspection = await setStatus(aCookie, orderId, 'CONFIRMED');
    expect(skipInspection.status).toBe(409);

    const pass = await inspect(aCookie, orderId, { status: 'PASSED', actualQuantityKg: 30 });
    expect(pass.status).toBe(200);

    // Inspection passed, charge not confirmed yet — still not confirmable.
    const stillEarly = await setStatus(aCookie, orderId, 'CONFIRMED');
    expect(stillEarly.status).toBe(409);
  });

  test('the seller cannot progress an order before the buyer confirms the terms', async () => {
    const { aCookie, sCookie, orderId } = await acceptedOrder();
    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Cookie', sCookie)
      .send({ status: 'PROCESSING' });
    expect(res.status).toBe(409);

    const adminAttempt = await setStatus(aCookie, orderId, 'PROCESSING');
    expect(adminAttempt.status).toBe(409);
  });

  test('only the buyer can confirm the delivery charge', async () => {
    const { aCookie, oCookie, bCookie, orderId } = await acceptedOrder();
    await inspect(aCookie, orderId, { status: 'PASSED', actualQuantityKg: 30 });
    await charge(aCookie, orderId, 150000);

    const stranger = await request(app)
      .patch(`/api/v1/orders/${orderId}/confirm`)
      .set('Cookie', oCookie)
      .send({ note: 'not my order' });
    expect(stranger.status).toBe(403);

    const real = await request(app)
      .patch(`/api/v1/orders/${orderId}/confirm`)
      .set('Cookie', bCookie)
      .send({ note: 'Accepted.' });
    expect(real.status).toBe(200);
    expect(real.body.data.order.status).toBe('CONFIRMED');
  });

  test('a changed quantity re-prices the order and flags revised terms', async () => {
    const { aCookie, orderId } = await acceptedOrder({ weightKg: 30, pricePerKgPaise: 2000 });
    const before = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Cookie', aCookie);
    const bookedSubtotal = before.body.data.order.materialSubtotalPaise;
    expect(bookedSubtotal).toBe(60000); // 30 kg × ₹20

    const pass = await inspect(aCookie, orderId, {
      status: 'PASSED',
      actualQuantityKg: 25,
      materialCondition: 'LOOSE',
    });
    expect(pass.status).toBe(200);

    const after = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Cookie', aCookie);
    const order = after.body.data.order;
    expect(order.items[0].weightKg).toBe(25);
    expect(order.materialSubtotalPaise).toBe(50000);
    expect(order.taxPaise).toBe(9000); // 18% of the revised subtotal
    expect(order.totalPaise).toBe(59000 + order.otherFeesPaise);
    expect(order.quoteIsProvisional).toBe(true);
    expect(order.termsRevision).toBe(1);
    expect(order.inspection.actualQuantityKg).toBe(25);
    expect(order.inspection.quantityChangedFromKg).toBe(30);
  });

  test('a failed inspection releases the reservation and blocks dispatch', async () => {
    const { aCookie, bCookie, orderId, lot } = await acceptedOrder();

    const fail = await inspect(aCookie, orderId, {
      status: 'FAILED',
      failureReason: 'Material heavily contaminated with plastic.',
    });
    expect(fail.status).toBe(200);
    expect(fail.body.data.order.status).toBe('REJECTED');
    expect(fail.body.data.order.inspectionStatus).toBe('FAILED');

    const fresh = await lots.findById(lot.id);
    expect(fresh.availableQuantityKg).toBe(100);
    expect(fresh.reservedQuantityKg).toBe(0);

    // A rejected order is closed — it cannot be pushed towards dispatch.
    const attempt = await setStatus(aCookie, orderId, 'ACCEPTED');
    expect(attempt.status).toBe(409);

    const buyerView = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', bCookie);
    expect(buyerView.body.data.order.rejectionReason).toContain('contaminated');
  });

  test('the full buyer address reaches the seller only after confirmation', async () => {
    const { aCookie, sCookie, bCookie, orderId } = await acceptedOrder();

    const hidden = await request(app).get('/api/v1/orders/selling').set('Cookie', sCookie);
    const row = hidden.body.data.find((o) => o.id === orderId);
    expect(row.addressReleased).toBe(false);
    expect(JSON.stringify(row)).not.toContain('7 Marina Beach Road');
    expect(JSON.stringify(row)).not.toContain('9876500001');
    expect(row.buyer).toBeUndefined();
    expect(row.delivery.city).toBe('Chennai');

    const detail = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', sCookie);
    expect(JSON.stringify(detail.body)).not.toContain('7 Marina Beach Road');

    await inspect(aCookie, orderId, { status: 'PASSED', actualQuantityKg: 30 });
    await charge(aCookie, orderId, 150000);
    await request(app).patch(`/api/v1/orders/${orderId}/confirm`).set('Cookie', bCookie).send({});

    const released = await request(app).get('/api/v1/orders/selling').set('Cookie', sCookie);
    const after = released.body.data.find((o) => o.id === orderId);
    expect(after.addressReleased).toBe(true);
    expect(after.delivery.address).toBe('7 Marina Beach Road');
    expect(after.delivery.phone).toBe('9876500001');
    expect(after.buyer).toBeTruthy();
  });

  test('unrelated users cannot open someone else\'s order', async () => {
    const { oCookie, orderId } = await acceptedOrder();
    const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', oCookie);
    expect(res.status).toBe(403);
  });

  test('the complete happy path runs through to delivery', async () => {
    const { aCookie, sCookie, bCookie, orderId, lot } = await acceptedOrder();

    await inspect(aCookie, orderId, { status: 'SCHEDULED', scheduledAt: new Date() });
    const scheduled = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Cookie', aCookie);
    expect(scheduled.body.data.order.status).toBe('INSPECTION_SCHEDULED');

    await inspect(aCookie, orderId, { status: 'IN_PROGRESS' });
    await inspect(aCookie, orderId, {
      status: 'PASSED',
      actualQuantityKg: 30,
      materialCondition: 'LOOSE',
      notes: 'Sorted, clean.',
    });
    const priced = await charge(aCookie, orderId, 150000);
    expect(priced.body.data.order.status).toBe('AWAITING_BUYER_CONFIRMATION');
    expect(priced.body.data.order.totalPaise).toBe(
      priced.body.data.order.materialSubtotalPaise +
        priced.body.data.order.taxPaise +
        priced.body.data.order.otherFeesPaise +
        150000
    );

    const confirmed = await request(app)
      .patch(`/api/v1/orders/${orderId}/confirm`)
      .set('Cookie', bCookie)
      .send({ note: 'Charge accepted.' });
    expect(confirmed.body.data.order.addressReleased).toBe(true);

    for (const st of ['PROCESSING', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED']) {
      const r = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Cookie', sCookie)
        .send({ status: st });
      expect(r.status).toBe(200);
    }

    const delivered = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Cookie', aCookie);
    const order = delivered.body.data.order;
    expect(order.status).toBe('DELIVERED');
    // No payment provider exists, so delivery never marks a payment.
    expect(order.payment?.status).not.toBe('PAID');

    const fresh = await lots.findById(lot.id);
    expect(fresh.soldQuantityKg).toBe(30);
    expect(fresh.reservedQuantityKg).toBe(0);

    const sellerNotifs = await request(app).get('/api/v1/notifications/my').set('Cookie', sCookie);
    expect(sellerNotifs.body.data.some((n) => n.message.includes(order.orderNumber))).toBe(true);
  });
});
