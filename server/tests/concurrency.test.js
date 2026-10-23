'use strict';

/**
 * Concurrency and race-condition tests.
 *
 * Every case fires real HTTP requests through the full middleware + service
 * stack with `Promise.all`, so the guards being tested are the database ones —
 * no frontend button-hiding is involved anywhere in this file.
 */

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/db');
const { signToken, AUTH_COOKIE } = require('../src/services/tokenService');
const { createUser, createAdmin, createCategory, createPricing, lots, listings, submitWaste } =
  require('./utils');

const cookieFor = (user) => `${AUTH_COOKIE}=${signToken(user)}`;

let seq = 0;
function tag() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function deliveryFor(name) {
  return {
    name,
    phone: '9876500001',
    address: '1 Race Track Road',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
  };
}

async function seedLot(availableKg, { pricePerKgPaise = 2000 } = {}) {
  const category = await createCategory('Race Cat');
  const seller = await createUser({ email: `seller-${tag()}@test.dev` });
  const lot = await lots.create({
    lotNumber: `LOT-RACE-${tag()}`,
    sellerId: seller.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    qualityGrade: 'B',
    condition: 'LOOSE',
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    city: 'Pune',
    state: 'Maharashtra',
    lotStatus: 'PUBLISHED',
  });
  const listing = await listings.create({
    title: 'Race test scrap',
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description: 'Scrap used by the concurrency suite.',
    images: [],
    inventoryLotId: lot.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise,
    minPurchaseKg: 0,
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    city: 'Pune',
    state: 'Maharashtra',
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedAt: new Date(),
  });
  return { lot, listing, seller, category };
}

/** Fires `requests` concurrently and splits the responses by outcome. */
async function fire(requests) {
  const responses = await Promise.all(requests.map((run) => run()));
  return {
    responses,
    ok: responses.filter((res) => res.status === 201 || res.status === 200),
    failed: responses.filter((res) => res.status >= 400),
    serverErrors: responses.filter((res) => res.status >= 500),
  };
}

/** Returns a thunk so `fire` controls when the request actually starts. */
function bookRequest(buyer, listingId, weightKg, extra = {}) {
  return () =>
    request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({
        items: [{ listingId, weightKg }],
        delivery: deliveryFor(`Buyer ${tag()}`),
        ...extra,
      });
}

describe('Concurrency — marketplace stock reservation', () => {
  test('ten buyers racing for the same lot never oversell it', async () => {
    const { listing, lot } = await seedLot(100);
    const buyers = await Promise.all(
      Array.from({ length: 10 }, async () => createUser({ email: `buyer-${tag()}@test.dev` }))
    );

    const { ok, failed, serverErrors } = await fire(
      buyers.map((buyer) => bookRequest(buyer, listing.id, 20))
    );

    expect(serverErrors).toEqual([]);
    // 100 kg / 20 kg = exactly five winners, five honest rejections.
    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    failed.forEach((res) => expect([400, 409]).toContain(res.status));

    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.availableQuantityKg).toBe(0);
    expect(freshLot.reservedQuantityKg).toBe(100);
    expect(freshLot.availableQuantityKg).toBeGreaterThanOrEqual(0);
    expect(freshLot.availableQuantityKg + freshLot.reservedQuantityKg).toBe(
      freshLot.acceptedQuantityKg
    );

    const orders = await prisma.order.findMany();
    expect(orders).toHaveLength(5);
    const bookedKg = orders.reduce(
      (sum, order) => sum + order.items.reduce((s, item) => s + item.weightKg, 0),
      0
    );
    expect(bookedKg).toBe(100);

    const movements = await prisma.inventoryMovement.findMany({ where: { lotId: lot.id } });
    expect(movements).toHaveLength(5);
    expect(movements.reduce((sum, m) => sum + m.quantityKg, 0)).toBe(100);

    // The listing cache must not drift from the authoritative lot.
    const freshListing = await prisma.marketplaceListing.findUnique({
      where: { id: listing.id },
    });
    expect(freshListing.availableQuantityKg).toBe(freshLot.availableQuantityKg);
    expect(freshListing.reservedQuantityKg).toBe(freshLot.reservedQuantityKg);
  });

  test('only one of eight buyers can take the last of a lot', async () => {
    const { listing, lot } = await seedLot(10);
    const buyers = await Promise.all(
      Array.from({ length: 8 }, async () => createUser({ email: `buyer-${tag()}@test.dev` }))
    );

    const { ok, failed, serverErrors } = await fire(
      buyers.map((buyer) => bookRequest(buyer, listing.id, 10))
    );

    expect(serverErrors).toEqual([]);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);

    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.availableQuantityKg).toBe(0);
    expect(freshLot.reservedQuantityKg).toBe(10);
    expect(await prisma.order.count()).toBe(1);
  });

  test('a buyer whose reservation lost the race keeps no order or ledger row', async () => {
    const { listing, lot } = await seedLot(5);
    const [first, second] = await Promise.all([
      createUser({ email: `buyer-${tag()}@test.dev` }),
      createUser({ email: `buyer-${tag()}@test.dev` }),
    ]);

    const { responses } = await fire([
      bookRequest(first, listing.id, 5),
      bookRequest(second, listing.id, 5),
    ]);

    // Which guard catches the loser depends on the interleaving: the controller
    // pre-check answers 400, the transactional stock guard answers 409.
    const wins = responses.filter((res) => res.status === 201);
    const losses = responses.filter((res) => res.status >= 400);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect([400, 409]).toContain(losses[0].status);
    expect(losses[0].body.data).toBeUndefined();

    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.inventoryMovement.count({ where: { lotId: lot.id } })).toBe(1);
    // Only the winner's two notifications (buyer + seller) exist.
    expect(await prisma.notification.count({ where: { type: 'ORDER' } })).toBe(2);
  });

  test('a double-clicked submit with one idempotency key creates exactly one order', async () => {
    const { listing, lot } = await seedLot(100);
    const buyer = await createUser({ email: `buyer-${tag()}@test.dev` });
    const key = `click-${tag()}`;

    const { ok, serverErrors } = await fire(
      Array.from({ length: 6 }, () => bookRequest(buyer, listing.id, 10, { idempotencyKey: key }))
    );

    expect(serverErrors).toEqual([]);
    expect(ok).toHaveLength(6);

    const orderIds = new Set(ok.map((res) => res.body.data.order.id));
    expect(orderIds.size).toBe(1);
    expect(await prisma.order.count()).toBe(1);

    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.reservedQuantityKg).toBe(10);
    expect(freshLot.availableQuantityKg).toBe(90);
    expect(await prisma.inventoryMovement.count({ where: { lotId: lot.id } })).toBe(1);
  });

  test('a retry after the first request committed returns the original order', async () => {
    const { listing, lot } = await seedLot(50);
    const buyer = await createUser({ email: `buyer-${tag()}@test.dev` });
    const key = `retry-${tag()}`;

    const first = await bookRequest(buyer, listing.id, 25, { idempotencyKey: key })();
    expect(first.status).toBe(201);
    const second = await bookRequest(buyer, listing.id, 25, { idempotencyKey: key })();

    expect(second.status).toBe(201);
    expect(second.body.data.order.id).toBe(first.body.data.order.id);

    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.reservedQuantityKg).toBe(25);
    expect(await prisma.order.count()).toBe(1);
  });

  test('concurrent submits for the same listing from different buyers sum to real stock', async () => {
    const { listing, lot } = await seedLot(30);
    const buyers = await Promise.all(
      Array.from({ length: 10 }, async () => createUser({ email: `buyer-${tag()}@test.dev` }))
    );

    const { ok, serverErrors } = await fire(
      buyers.map((buyer) => bookRequest(buyer, listing.id, 5))
    );

    expect(serverErrors).toEqual([]);
    // 30 kg available, 5 kg each: at most six may succeed.
    expect(ok.length).toBeLessThanOrEqual(6);
    expect(ok.length).toBeGreaterThanOrEqual(1);

    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.availableQuantityKg).toBeGreaterThanOrEqual(0);
    expect(freshLot.availableQuantityKg + freshLot.reservedQuantityKg).toBe(30);
    expect(ok.length * 5).toBe(freshLot.reservedQuantityKg);
  });
});

describe('Concurrency — order workflow', () => {
  async function bookedOrder(kg = 20) {
    const seeded = await seedLot(100);
    const buyer = await createUser({ email: `buyer-${tag()}@test.dev` });
    const created = await bookRequest(buyer, seeded.listing.id, kg)();
    expect(created.status).toBe(201);
    return { ...seeded, buyer, orderId: created.body.data.order.id };
  }

  function asAdmin(admin, method, path, body) {
    return request(app)[method](`/api/v1/admin${path}`)
      .set('Cookie', cookieFor(admin))
      .send(body);
  }

  /** Drives an order to DISPATCH-eligible state through the real endpoints. */
  async function walkToReadyForDispatch(order) {
    const { admin, buyer, orderId } = order;
    const sellerUser = await prisma.user.findUnique({ where: { id: order.seller.id } });

    const steps = [
      [
        () =>
          asAdmin(admin, 'patch', `/orders/${orderId}/inspection`, {
            status: 'PASSED',
            actualQuantityKg: 20,
          }),
        'pass inspection',
      ],
      [
        () =>
          asAdmin(admin, 'patch', `/orders/${orderId}/delivery-charge`, {
            deliveryChargePaise: 150000,
          }),
        'set delivery charge',
      ],
      [
        () =>
          request(app)
            .patch(`/api/v1/orders/${orderId}/confirm`)
            .set('Cookie', cookieFor(buyer))
            .send({ note: 'confirmed' }),
        'buyer confirmation',
      ],
      [
        () =>
          request(app)
            .patch(`/api/v1/orders/${orderId}/status`)
            .set('Cookie', cookieFor(sellerUser))
            .send({ status: 'PROCESSING' }),
        'seller accepts processing',
      ],
      [
        () =>
          request(app)
            .patch(`/api/v1/orders/${orderId}/status`)
            .set('Cookie', cookieFor(sellerUser))
            .send({ status: 'READY_FOR_DISPATCH' }),
        'seller marks ready',
      ],
    ];

    for (const [run, label] of steps) {
      const res = await run();
      if (res.status !== 200) {
        throw new Error(`${label} failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    return sellerUser;
  }

  test('two admins accepting the same request at once leave one clean history entry', async () => {
    const { orderId, lot } = await bookedOrder();
    const [adminA, adminB] = await Promise.all([createAdmin(), createAdmin()]);

    const run = (admin) => () =>
      request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set('Cookie', cookieFor(admin))
        .send({ status: 'ACCEPTED', note: 'approved from queue' });

    const { responses, serverErrors } = await fire([run(adminA), run(adminB)]);
    expect(serverErrors).toEqual([]);
    responses.forEach((res) => expect([200, 409]).toContain(res.status));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.status).toBe('ACCEPTED');
    const acceptEntries = order.statusHistory.filter((entry) => entry.status === 'ACCEPTED');
    expect(acceptEntries).toHaveLength(1);

    // Accepting must not double-reserve: booking already reserved 20 kg.
    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(freshLot.reservedQuantityKg).toBe(20);
    expect(await prisma.inventoryMovement.count({ where: { lotId: lot.id } })).toBe(1);
  });

  test('concurrent inspection writes converge on one consistent state', async () => {
    const { orderId } = await bookedOrder();
    const [adminA, adminB] = await Promise.all([createAdmin(), createAdmin()]);

    const run = (admin, payload) => () =>
      request(app)
        .patch(`/api/v1/admin/orders/${orderId}/inspection`)
        .set('Cookie', cookieFor(admin))
        .send(payload);

    const { responses, serverErrors } = await fire([
      run(adminA, { status: 'IN_PROGRESS', notes: 'yard visit started' }),
      run(adminB, { status: 'PASSED', actualQuantityKg: 18, notes: 'weighed out' }),
    ]);
    expect(serverErrors).toEqual([]);
    responses.forEach((res) => expect([200, 409]).toContain(res.status));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const inspection = await prisma.inspection.findUnique({ where: { orderId } });

    // Whatever wins, the mirrored order status and the inspection row agree.
    expect(order.inspectionStatus).toBe(inspection.status);
    if (inspection.status === 'PASSED') {
      expect(order.status).toBe('ACCEPTED');
      expect(Number(order.items[0].weightKg)).toBeCloseTo(18, 2);
      expect(order.materialSubtotalPaise).toBe(36000);
      expect(order.totalPaise).toBeGreaterThan(order.materialSubtotalPaise);
      expect(order.termsRevision).toBe(1);
    } else {
      expect(['PENDING_ADMIN_APPROVAL', 'ACCEPTED', 'INSPECTION_IN_PROGRESS']).toContain(
        order.status
      );
    }
  });

  test('a buyer confirming while an admin re-prices cannot release a stale address', async () => {
    const { orderId, buyer } = await bookedOrder();
    const admin = await createAdmin();

    await asAdmin(admin, 'patch', `/orders/${orderId}/inspection`, {
      status: 'PASSED',
      actualQuantityKg: 20,
    });

    const charge = () =>
      request(app)
        .patch(`/api/v1/admin/orders/${orderId}/delivery-charge`)
        .set('Cookie', cookieFor(admin))
        .send({ deliveryChargePaise: 150000 });
    const confirm = () =>
      request(app)
        .patch(`/api/v1/orders/${orderId}/confirm`)
        .set('Cookie', cookieFor(buyer))
        .send({ note: 'looks fine' });

    const { responses, serverErrors } = await fire([charge, confirm]);
    expect(serverErrors).toEqual([]);
    // One of the two must be refused: a charge cannot overwrite a confirmed
    // order, and a confirm with no pending charge cannot pass.
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order.addressReleased) {
      expect(order.deliveryChargeStatus).toBe('CONFIRMED');
      expect(order.totalPaise).toBe(
        order.materialSubtotalPaise + order.taxPaise + order.transportationPaise
      );
    } else {
      expect(order.status).toBe('AWAITING_BUYER_CONFIRMATION');
      expect(order.addressReleased).toBe(false);
      expect(order.transportationPaise).toBe(150000);
    }
  });

  test('a seller clicking dispatch twice does not duplicate the transition', async () => {
    const order = await bookedOrder();
    const admin = await createAdmin();
    const sellerUser = await walkToReadyForDispatch({ ...order, admin });

    const dispatch = () =>
      request(app)
        .patch(`/api/v1/orders/${order.orderId}/status`)
        .set('Cookie', cookieFor(sellerUser))
        .send({ status: 'DISPATCHED' });

    const { responses, serverErrors } = await fire([dispatch, dispatch]);
    expect(serverErrors).toEqual([]);
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 409)).toHaveLength(1);

    const fresh = await prisma.order.findUnique({ where: { id: order.orderId } });
    expect(fresh.status).toBe('DISPATCHED');
    expect(fresh.statusHistory.filter((entry) => entry.status === 'DISPATCHED')).toHaveLength(1);

    // DISPATCH does not commit stock — only DELIVERED does.
    const afterDispatch = await prisma.inventoryLot.findUnique({ where: { id: order.lot.id } });
    expect(afterDispatch.reservedQuantityKg).toBe(20);
    expect(afterDispatch.soldQuantityKg).toBe(0);

    const deliver = () =>
      request(app)
        .patch(`/api/v1/orders/${order.orderId}/status`)
        .set('Cookie', cookieFor(sellerUser))
        .send({ status: 'DELIVERED' });

    const second = await fire([deliver, deliver]);
    expect(second.serverErrors).toEqual([]);
    expect(second.responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(second.responses.filter((res) => res.status === 409)).toHaveLength(1);

    const delivered = await prisma.order.findUnique({ where: { id: order.orderId } });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.inventoryCommitted).toBe(true);
    expect(delivered.statusHistory.filter((entry) => entry.status === 'DELIVERED')).toHaveLength(1);

    // Exactly one commit: 20 kg moved from reserved to sold, never twice.
    const finalLot = await prisma.inventoryLot.findUnique({ where: { id: order.lot.id } });
    expect(finalLot.reservedQuantityKg).toBe(0);
    expect(finalLot.soldQuantityKg).toBe(20);
    expect(
      await prisma.inventoryMovement.count({ where: { lotId: order.lot.id, type: 'COMMIT' } })
    ).toBe(1);
  });
});

describe('Concurrency — writes and reads under fan-out', () => {
  test('ten sellers submitting at the same moment all get their own submission', async () => {
    const category = await createCategory('Race Cat');
    // submitWaste mints its own throwaway category internally; the valuation
    // step needs pricing on the category we actually submit against.
    await createPricing(category);
    const sellers = await Promise.all(
      Array.from({ length: 10 }, async () => createUser({ email: `seller-${tag()}@test.dev` }))
    );

    const { responses, ok, serverErrors } = await fire(
      sellers.map((seller, index) => async () => {
        const res = await submitWaste({
          cookie: cookieFor(seller),
          materialCategory: category.id,
          quantityKg: 100 + index,
        });
        return res;
      })
    );

    expect(serverErrors).toEqual([]);
    if (ok.length !== 10) {
      throw new Error(
        responses
          .slice(0, 3)
          .map((res) => `${res.status} ${JSON.stringify(res.body)}`)
          .join(' | ')
      );
    }

    const created = await prisma.wasteSubmission.findMany();
    expect(created).toHaveLength(10);
    expect(new Set(created.map((s) => s.submissionNumber)).size).toBe(10);
    expect(new Set(created.map((s) => s.id)).size).toBe(10);
    expect(created.map((s) => s.quantityKg).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => 100 + i)
    );
  });

  test('thirty mixed catalogue queries run in parallel without corrupting results', async () => {
    const seeds = await Promise.all([seedLot(100), seedLot(40), seedLot(10)]);
    for (const seed of seeds) {
      await prisma.marketplaceListing.update({
        where: { id: seed.listing.id },
        data: { latitude: 18.5204, longitude: 73.8567 },
      });
    }

    const variants = [];
    for (let i = 0; i < 30; i += 1) {
      variants.push({
        search: 'Race',
        sort: ['price_asc', 'price_desc', 'newest', 'nearby'][i % 4],
        page: (i % 3) + 1,
        limit: 2,
        ...(i % 5 === 0 ? { city: 'Pune' } : {}),
        ...(i % 7 === 0 ? { lat: 18.5204, lng: 73.8567, radiusKm: 25 } : {}),
      });
    }

    const { ok, serverErrors } = await fire(
      variants.map((query) => () => request(app).get('/api/v1/marketplace').query(query))
    );

    expect(serverErrors).toEqual([]);
    expect(ok).toHaveLength(30);
    ok.forEach((res) => {
      // Pages beyond the three fixtures legitimately return a short slice; the
      // invariant is that the page size cap and the total stay consistent.
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.total).toBe(3);
    });
    expect(ok.filter((res) => res.body.data.length === 2).length).toBeGreaterThan(0);

    // Nothing was written by the read fan-out.
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(0);
    const allLots = await prisma.inventoryLot.findMany();
    expect(allLots.map((lot) => lot.availableQuantityKg).sort((a, b) => a - b)).toEqual([
      10, 40, 100,
    ]);
  });

  test('concurrent listing edits on different fields both survive', async () => {
    const { listing } = await seedLot(100);
    const admin = await createAdmin();

    const run = (body) => () =>
      request(app)
        .patch(`/api/v1/admin/listings/${listing.id}`)
        .set('Cookie', cookieFor(admin))
        .send(body);

    const { responses, serverErrors } = await fire([
      run({ title: 'Renamed by queue' }),
      run({ pricePerKg: 31 }),
    ]);
    expect(serverErrors).toEqual([]);
    responses.forEach((res) => expect(res.status).toBe(200));

    const fresh = await prisma.marketplaceListing.findUnique({ where: { id: listing.id } });
    expect(fresh.title).toBe('Renamed by queue');
    expect(fresh.pricePerKgPaise).toBe(3100);
  });

  test('parallel publish/pause toggles never leave the listing contradicting its lot', async () => {
    const { listing, lot } = await seedLot(0);
    const admin = await createAdmin();

    const run = (status) => () =>
      request(app)
        .patch(`/api/v1/admin/listings/${listing.id}/status`)
        .set('Cookie', cookieFor(admin))
        .send({ status });

    const { responses, serverErrors } = await fire([run('PUBLISHED'), run('PAUSED')]);
    expect(serverErrors).toEqual([]);
    // Publishing an empty lot is refused regardless of the interleaving.
    const published = responses.find((res) => res.status === 409);
    expect(published).toBeDefined();
    expect(published.body.message).toMatch(/no available stock/i);

    const fresh = await prisma.marketplaceListing.findUnique({ where: { id: listing.id } });
    const freshLot = await prisma.inventoryLot.findUnique({ where: { id: lot.id } });
    expect(fresh.availableQuantityKg).toBe(freshLot.availableQuantityKg);
    expect(fresh.publicationStatus).not.toBe('PUBLISHED');
  });
});
