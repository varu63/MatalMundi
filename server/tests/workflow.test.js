'use strict';

const request = require('supertest');
const app = require('../src/app');
const { createUser, createAdmin, submitWaste, InventoryLot, InventoryMovement } = require('./utils');

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function party() {
  const [seller, buyer, admin] = await Promise.all([
    createUser(),
    createUser(),
    createAdmin(),
  ]);
  const [sCookie, bCookie, aCookie] = await Promise.all([
    cookieFor(seller),
    cookieFor(buyer),
    cookieFor(admin),
  ]);
  return { seller, buyer, admin, sCookie, bCookie, aCookie };
}

describe('Full seller → admin → buyer workflow', () => {
  test('complete lifecycle: submit → approve → collect → publish → order → deliver', async () => {
    const { sCookie, bCookie, aCookie } = await party();

    // 1. Seller submits 100 kg waste with photographs.
    const submit = await submitWaste({ cookie: sCookie, quantityKg: 100 });
    expect(submit.status).toBe(201);
    const subId = submit.body.data.submission.id;
    expect(submit.body.data.submission.status).toBe('PENDING_APPROVAL');

    // 2. Admin sees it, reviews and approves.
    const dash = await request(app).get('/api/v1/admin/dashboard').set('Cookie', aCookie);
    expect(dash.body.data.stats.pendingSubmissions).toBeGreaterThanOrEqual(1);

    const review = await request(app)
      .patch(`/api/v1/admin/waste-submissions/${subId}/review`)
      .set('Cookie', aCookie)
      .send({ status: 'UNDER_REVIEW', note: 'Inspecting photos…' });
    expect(review.status).toBe(200);

    const approve = await request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/approve`)
      .set('Cookie', aCookie)
      .send({ proposedPricePerKg: 20 });
    expect(approve.status).toBe(200);
    expect(approve.body.data.submission.status).toBe('APPROVED');
    expect(approve.body.data.submission.proposedPurchasePricePaise).toBe(200000); // ₹20 × 100kg

    // 3. Approved but uncollected material is NOT listed.
    const beforeCollect = await request(app).get('/api/v1/marketplace');
    expect(beforeCollect.body.data).toHaveLength(0);

    // 4. Cannot publish before collection.
    const tooEarly = await request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/publish`)
      .set('Cookie', aCookie)
      .field('title', 'Early listing')
      .field('description', 'Trying too early without material collected.')
      .field('pricePerKg', '25');
    expect(tooEarly.status).toBe(409);

    // 5. Collect the material — inventory lot is created.
    const collect = await request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/collect`)
      .set('Cookie', aCookie)
      .send({ acceptedQuantityKg: 100 });
    expect(collect.status).toBe(200);
    const lotId = collect.body.data.lot.id;
    const lot = await InventoryLot.findById(lotId);
    expect(lot.availableQuantityKg).toBe(100);

    // 6. Publish to marketplace.
    let req = request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/publish`)
      .set('Cookie', aCookie)
      .field('title', 'MS Scrap — premium lot')
      .field('description', 'Sorted loose mild steel.')
      .field('pricePerKg', '21')
      .field('minPurchaseKg', '0');
    const publish = await req;
    expect(publish.status).toBe(200);
    const listingId = publish.body.data.listing.id;

    const market = await request(app).get('/api/v1/marketplace');
    expect(market.body.data.some((l) => l.id === listingId)).toBe(true);

    // 7. Seller receives notifications about the listing.
    const notifications = await request(app).get('/api/v1/notifications/my').set('Cookie', sCookie);
    expect(notifications.body.data.length).toBeGreaterThanOrEqual(4); // received, approved, collected, listed

    // 8. Buyer places a purchase request for 30 kg.
    const order = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', bCookie)
      .send({
        items: [{ listingId, weightKg: 30 }],
        delivery: {
          name: 'Buyer',
          phone: '9876500000',
          address: '1 Nehru Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          postalCode: '600001',
        },
      });
    expect(order.status).toBe(201);
    const orderId = order.body.data.order.id;
    expect(order.body.data.order.items[0].weightKg).toBe(30);

    // 9. Admin accepts → inventory is reserved atomically.
    const accept = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Cookie', aCookie)
      .send({ status: 'ACCEPTED' });
    expect(accept.status).toBe(200);

    let fresh = await InventoryLot.findById(lotId);
    expect(fresh.availableQuantityKg).toBe(70);
    expect(fresh.reservedQuantityKg).toBe(30);

    // 10. Move the order to delivered — reservation commits to sold.
    for (const st of ['CONFIRMED', 'PROCESSING', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set('Cookie', aCookie)
        .send({ status: st });
      expect(r.status).toBe(200);
    }

    fresh = await InventoryLot.findById(lotId);
    expect(fresh.availableQuantityKg).toBe(70);
    expect(fresh.reservedQuantityKg).toBe(0);
    expect(fresh.soldQuantityKg).toBe(30);

    const movements = await InventoryMovement.find({ lot: lotId });
    expect(movements.length).toBeGreaterThanOrEqual(3); // IN, RESERVE, COMMIT

    // 11. Buyer can track the order and has a notification.
    const myOrders = await request(app).get('/api/v1/orders/my').set('Cookie', bCookie);
    expect(myOrders.body.data.some((o) => o.id === orderId)).toBe(true);
    const buyerNotifs = await request(app).get('/api/v1/notifications/my').set('Cookie', bCookie);
    expect(buyerNotifs.body.data.length).toBeGreaterThanOrEqual(1);
    expect(buyerNotifs.body.meta.unread).toBeGreaterThanOrEqual(1);

    // 12. Audit trail exists for the approval and order actions.
    const audit = await request(app).get('/api/v1/admin/audit-logs').set('Cookie', aCookie);
    const actions = audit.body.data.map((l) => l.action);
    expect(actions).toContain('SUBMISSION_APPROVE');
    expect(actions).toContain('ORDER_STATUS');
  });

  test('rejection notifies the seller and blocks publishing', async () => {
    const { sCookie, aCookie } = await party();
    const submit = await submitWaste({ cookie: sCookie, quantityKg: 160 });
    const subId = submit.body.data.submission.id;

    const reject = await request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/reject`)
      .set('Cookie', aCookie)
      .send({ reason: 'Material contaminated; unacceptable for reprocessing.' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.submission.rejectionReason).toContain('contaminated');

    const notifs = await request(app).get('/api/v1/notifications/my').set('Cookie', sCookie);
    const rejectedNotif = notifs.body.data.find((n) => n.message.includes('rejected'));
    expect(rejectedNotif).toBeTruthy();

    const publish = await request(app)
      .post(`/api/v1/admin/waste-submissions/${subId}/publish`)
      .set('Cookie', aCookie)
      .field('title', 'bad')
      .field('description', 'bad material')
      .field('pricePerKg', '5');
    expect(publish.status).toBe(409);
  });
});