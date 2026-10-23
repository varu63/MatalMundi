'use strict';

/**
 * Security and authorization tests.
 *
 * Sessions are minted with `signToken` instead of `POST /auth/login` so the
 * suite stays fast (bcrypt cost 12 is ~3 s per login) while still exercising the
 * real `protect` / `authorize` middleware chain.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const env = require('../src/config/env');
const { prisma } = require('../src/config/db');
const { newId } = require('../src/utils/idGenerator');
const { signToken, AUTH_COOKIE } = require('../src/services/tokenService');
const { verifyCsrf } = require('../src/middleware/csrf');
const ApiError = require('../src/utils/ApiError');
const {
  createUser,
  createAdmin,
  createCategory,
  lots,
  listings,
} = require('./utils');

const cookieFor = (user) => `${AUTH_COOKIE}=${signToken(user)}`;

let seq = 0;
function uniqueSuffix() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

const CHENNAI = { lat: 13.0827, lng: 80.2707 };

const DELIVERY = {
  name: 'Privacy Tester',
  phone: '9876500002',
  address: '4 Hidden Lane',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
};

async function seedListing({ availableKg = 100, city = 'Chennai' } = {}) {
  const category = await createCategory('Security Cat');
  const seller = await createUser({ email: `seller-${uniqueSuffix()}@test.dev` });
  // The street lives in the lot's `location` json; coordinates are set so the
  // exposure tests can prove neither reaches a public payload.
  const location = { address: 'Secret Yard, Gate 7', city, state: 'Tamil Nadu' };
  const lot = await lots.create({
    lotNumber: `LOT-SEC-${uniqueSuffix()}`,
    sellerId: seller.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    qualityGrade: 'B',
    condition: 'LOOSE',
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    city,
    state: 'Tamil Nadu',
    latitude: CHENNAI.lat,
    longitude: CHENNAI.lng,
    location,
    lotStatus: 'PUBLISHED',
  });
  const listing = await listings.create({
    title: 'Security test scrap',
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description: 'Scrap used by the security suite.',
    images: [],
    inventoryLotId: lot.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise: 2000,
    minPurchaseKg: 0,
    acceptedQuantityKg: availableKg,
    availableQuantityKg: availableKg,
    city,
    state: 'Tamil Nadu',
    latitude: CHENNAI.lat,
    longitude: CHENNAI.lng,
    location,
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedAt: new Date(),
  });
  return { lot, listing, seller, category };
}

describe('Security — session handling', () => {
  test('protected endpoints reject missing, garbage and badly signed tokens', async () => {
    const endpoints = ['/api/v1/orders/my', '/api/v1/users/me', '/api/v1/admin/dashboard'];
    for (const path of endpoints) {
      const anonymous = await request(app).get(path);
      expect([401, 403]).toContain(anonymous.status);

      const garbage = await request(app).get(path).set('Cookie', `${AUTH_COOKIE}=not-a-jwt`);
      expect(garbage.status).toBe(401);

      const wrongSecret = jwt.sign({ sub: 'whatever' }, 'some-other-secret', {
        expiresIn: '5m',
      });
      const forged = await request(app)
        .get(path)
        .set('Cookie', `${AUTH_COOKIE}=${wrongSecret}`);
      expect(forged.status).toBe(401);
      expect(forged.body.message).toBe('Invalid or expired session');
    }
  });

  test('an algorithm-none token is refused', async () => {
    const user = await createUser();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user.id })).toString('base64url');
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', `${AUTH_COOKIE}=${header}.${payload}.`);
    expect(res.status).toBe(401);
  });

  test('an expired token is refused even for a real active account', async () => {
    const user = await createUser();
    const expired = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
      expiresIn: '-30s',
    });
    const res = await request(app)
      .get('/api/v1/orders/my')
      .set('Cookie', `${AUTH_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid or expired session');
  });

  test('a token for a deleted account is refused', async () => {
    const user = await createUser();
    const token = signToken(user);
    await prisma.user.delete({ where: { id: user.id } });
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', `${AUTH_COOKIE}=${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Account no longer exists');
  });

  test('a suspended account keeps its cookie but loses access', async () => {
    const user = await createUser();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookieFor(user))
      .send({ name: 'Still Me' });
    expect(res.status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'SUSPENDED' } });
    const blocked = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', cookieFor(user));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('Account suspended');
  });

  test('double-submit CSRF: header must match the cookie, safe methods exempt', () => {
    // verifyCsrf reports through next(err) rather than throwing, so capture it.
    // The jest bootstrap disables CSRF globally; re-enable it for these calls.
    const run = (method, cookieToken, headerToken) => {
      const previousTest = env.isTest;
      const previousDisable = process.env.DISABLE_CSRF;
      env.isTest = false;
      delete process.env.DISABLE_CSRF;
      let error = 'unset';
      try {
        verifyCsrf(
          {
            method,
            cookies: cookieToken === undefined ? {} : { 'mm.csrf': cookieToken },
            get: () => headerToken,
          },
          {},
          (err) => {
            error = err;
          }
        );
      } finally {
        env.isTest = previousTest;
        if (previousDisable !== undefined) process.env.DISABLE_CSRF = previousDisable;
      }
      return error;
    };

    const missingHeader = run('POST', 'aaaa', undefined);
    expect(missingHeader).toBeInstanceOf(ApiError);
    expect(missingHeader.statusCode).toBe(403);

    const differentLength = run('POST', 'aaaa', 'bbbbbb');
    expect(differentLength.message).toMatch(/CSRF/);

    const sameLengthWrong = run('POST', 'aaaa', 'zzzz');
    expect(sameLengthWrong.message).toMatch(/CSRF/);

    const noCookie = run('POST', undefined, 'aaaa');
    expect(noCookie).toBeInstanceOf(ApiError);

    expect(run('POST', 'aaaa', 'aaaa')).toBeUndefined();
    expect(run('GET', undefined, undefined)).toBeUndefined();
    expect(run('DELETE', 'aaaa', 'aaaa')).toBeUndefined();
  });
});

describe('Security — role and object-level authorization', () => {
  const ADMIN_GET_PATHS = [
    '/api/v1/admin/dashboard',
    '/api/v1/admin/waste-submissions',
    '/api/v1/admin/listings',
    '/api/v1/admin/inventory',
    '/api/v1/admin/orders',
    '/api/v1/admin/users',
    '/api/v1/admin/categories',
    '/api/v1/admin/pricing',
    '/api/v1/admin/auction-settings',
    '/api/v1/admin/audit-logs',
  ];

  test('no admin read endpoint is reachable without the ADMIN role', async () => {
    const attacker = await createUser();
    for (const path of ADMIN_GET_PATHS) {
      const anon = await request(app).get(path);
      expect(anon.status).toBe(401);

      const asUser = await request(app).get(path).set('Cookie', cookieFor(attacker));
      expect(asUser.status).toBe(403);
      expect(asUser.body.message).toBe('You do not have permission to perform this action');
    }
  });

  test('the same endpoints answer 200 for a real admin', async () => {
    const admin = await createAdmin();
    for (const path of ADMIN_GET_PATHS) {
      const res = await request(app).get(path).set('Cookie', cookieFor(admin));
      expect(res.status).toBe(200);
    }
  });

  test('a user cannot read another user order, notification or submission', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const { listing } = await seedListing();

    const created = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(owner))
      .send({ items: [{ listingId: listing.id, weightKg: 10 }], delivery: DELIVERY });
    expect(created.status).toBe(201);
    const orderId = created.body.data.order.id;

    const direct = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', cookieFor(intruder));
    expect(direct.status).toBe(403);

    const listed = await request(app)
      .get('/api/v1/orders/my')
      .set('Cookie', cookieFor(intruder));
    expect(listed.body.data.map((o) => o.id)).not.toContain(orderId);

    const notification = await prisma.notification.create({
      data: {
        id: newId(),
        userId: owner.id,
        title: 'Private',
        message: 'Order ORD-PRIVATE update',
        type: 'ORDER',
      },
    });
    const readOther = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Cookie', cookieFor(intruder));
    expect([403, 404]).toContain(readOther.status);

    const own = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Cookie', cookieFor(owner));
    expect(own.status).toBe(200);

    const submissions = await prisma.wasteSubmission.create({
      data: {
        id: newId(),
        submissionNumber: `WS-SEC-${Date.now()}`,
        sellerId: owner.id,
        materialCategoryId: listing.materialCategoryId,
        materialType: 'MS Scrap',
        quantityKg: 100,
        condition: 'LOOSE',
        qualityGrade: 'B',
        description: 'Not for prying eyes.',
        pickup: { city: 'Chennai', state: 'Tamil Nadu', address: '4 Hidden Lane' },
        status: 'PENDING_APPROVAL',
        images: [],
        demandBasis: 'TOTAL',
        demandedTotalPaise: 100000,
        demandedPerKgPaise: 0,
        valuation: {},
      },
    });
    const peek = await request(app)
      .get(`/api/v1/waste-submissions/${submissions.id}`)
      .set('Cookie', cookieFor(intruder));
    expect([403, 404]).toContain(peek.status);
  });

  test('a buyer cannot push their own order through the status endpoint', async () => {
    const buyer = await createUser();
    const { listing } = await seedListing();
    const created = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({ items: [{ listingId: listing.id, weightKg: 10 }], delivery: DELIVERY });
    const orderId = created.body.data.order.id;

    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Cookie', cookieFor(buyer))
      .send({ status: 'DELIVERED' });
    expect([401, 403]).toContain(res.status);
  });

  test('a seller cannot dispatch an order they do not own', async () => {
    const buyer = await createUser();
    const otherSeller = await createUser();
    const { listing } = await seedListing();
    const created = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({ items: [{ listingId: listing.id, weightKg: 10 }], delivery: DELIVERY });
    const orderId = created.body.data.order.id;
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });

    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Cookie', cookieFor(otherSeller))
      .send({ status: 'PROCESSING' });
    expect([403, 404]).toContain(res.status);

    const stillConfirmed = await prisma.order.findUnique({ where: { id: orderId } });
    expect(stillConfirmed.status).toBe('CONFIRMED');
  });
});

describe('Security — input validation and mass assignment', () => {
  test('a client cannot grant itself a role, status or verified flag', async () => {
    const email = `escalate-${Date.now()}@test.dev`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Wannabe Admin',
        email,
        phone: '9876543210',
        password: 'Password123',
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        emailVerificationVerified: true,
        isAdmin: true,
      });
    expect(res.status).toBe(201);
    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored.role).toBe('USER');
    expect(stored.emailVerificationVerified).toBe(false);
  });

  test('profile updates cannot rewrite role or account status', async () => {
    const user = await createUser();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Cookie', cookieFor(user))
      .send({ name: 'Renamed', role: 'ADMIN', accountStatus: 'ACTIVE', passwordHash: 'x' });
    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.role).toBe('USER');
    expect(stored.passwordHash).not.toBe('x');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  test('an order body cannot dictate totals, status, release flags or another buyer', async () => {
    const buyer = await createUser();
    const victim = await createUser();
    const { listing } = await seedListing({ availableKg: 100 });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({
        items: [{ listingId: listing.id, weightKg: 10, unitPricePaise: 1 }],
        delivery: DELIVERY,
        buyerId: victim.id,
        status: 'DELIVERED',
        totalPaise: 1,
        taxPaise: 0,
        paymentStatus: 'PAID',
        addressReleased: true,
        inventoryReserved: false,
      });
    expect(res.status).toBe(201);
    const order = res.body.data.order;

    const stored = await prisma.order.findUnique({ where: { id: order.id } });
    expect(stored.buyerId).toBe(buyer.id);
    expect(stored.status).toBe('PENDING_ADMIN_APPROVAL');
    expect(stored.paymentStatus).toBe('UNPAID');
    expect(stored.addressReleased).toBe(false);
    expect(stored.inventoryReserved).toBe(true);
    // 10 kg at the stored ₹20/kg, plus 18% tax — the client's ₹0.01 is ignored.
    expect(stored.materialSubtotalPaise).toBe(20000);
    expect(stored.totalPaise).toBeGreaterThan(20000);
  });

  test('oversized JSON bodies fail with 413, not a 500', async () => {
    const category = await createCategory();
    const huge = 'x'.repeat(1.2 * 1024 * 1024);
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: huge, materialCategoryId: category.id }));
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.stack).toBeUndefined();
  });

  test('malformed JSON is a 400 with no parser internals', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": broken}');
    expect(res.status).toBe(400);
    expect(res.body.stack).toBeUndefined();
    expect(res.body.message).toBe('Malformed JSON body');
  });

  test('queries survive SQL-ish and wildcard input without crashing', async () => {
    await seedListing({ city: 'Chennai' });
    const payloads = [
      "' OR 1=1; DROP TABLE users;--",
      '%',
      '_',
      '\\',
      '%%',
      "'; DELETE FROM orders WHERE 1=1 --",
      '<script>alert(1)</script>',
      '1' + '0'.repeat(300),
    ];
    const usersBefore = await prisma.user.count();
    for (const search of payloads) {
      const res = await request(app)
        .get('/api/v1/marketplace')
        .query({ search, city: search, sort: search, page: 1, limit: 5 });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
    expect(await prisma.user.count()).toBe(usersBefore);
  });

  test('pagination, radius and coordinates are clamped instead of trusted', async () => {
    const { listing } = await seedListing({ availableKg: 100 });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { latitude: 13.0827, longitude: 80.2707 },
    });

    const paged = await request(app)
      .get('/api/v1/marketplace')
      .query({ page: -5, limit: 100000 });
    expect(paged.status).toBe(200);
    expect(paged.body.meta.limit).toBeLessThanOrEqual(100);
    expect(paged.body.meta.page).toBe(1);

    const hugeRadius = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: 13.0827, lng: 80.2707, radiusKm: 999999 });
    expect(hugeRadius.status).toBe(200);
    expect(hugeRadius.body.meta.radiusKm).toBeLessThanOrEqual(env.business.maxRadiusKm);

    const badCoords = await request(app)
      .get('/api/v1/marketplace')
      .query({ lat: 999, lng: -999, radiusKm: 50 });
    expect(badCoords.status).toBe(200);
    expect(badCoords.body.meta.origin).toBeUndefined();

    for (const value of ['NaN', 'Infinity', '13;--', '0x51', '1e999']) {
      const res = await request(app).get('/api/v1/marketplace').query({ lat: value, lng: value });
      expect(res.status).toBe(200);
    }
  });

  test('unknown route ids answer 404/400, never a 500', async () => {
    const admin = await createAdmin();
    for (const path of [
      '/api/v1/marketplace/does-not-exist',
      '/api/v1/orders/deadbeefdeadbeefdeadbeef',
      '/api/v1/waste-submissions/nope',
    ]) {
      const res = await request(app).get(path).set('Cookie', cookieFor(admin));
      expect([400, 404]).toContain(res.status);
      expect(res.body.stack).toBeUndefined();
    }
  });
});

describe('Security — upload limits', () => {
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('idat chunk data')
  ]);

  async function submissionAgent() {
    const user = await createUser();
    return { user, cookie: cookieFor(user) };
  }

  test('non-image content types are rejected', async () => {
    const { cookie } = await submissionAgent();
    const req = request(app)
      .post('/api/v1/waste-submissions')
      .set('Cookie', cookie)
      .field('materialType', 'MS Scrap')
      .attach('front', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'evil.sh',
        contentType: 'application/x-sh',
      });
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unsupported image type|Upload error/);
  });

  test('a file over the size limit is rejected before it reaches storage', async () => {
    const { cookie } = await submissionAgent();
    const oversized = Buffer.concat([pngHeader, Buffer.alloc(5 * 1024 * 1024 + 1024, 7)]);
    const res = await request(app)
      .post('/api/v1/waste-submissions')
      .set('Cookie', cookie)
      .field('materialType', 'MS Scrap')
      .attach('front', oversized, 'big.png');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Upload error|too large/);
    expect(res.body.stack).toBeUndefined();
  });

  test('no order of any kind is persisted when a request fails validation', async () => {
    const { listing } = await seedListing({ availableKg: 100 });
    const buyer = await createUser();
    const before = {
      orders: await prisma.order.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({ items: [{ listingId: listing.id, weightKg: 5000 }], delivery: DELIVERY });
    // The controller pre-checks live stock (400); the transactional guard
    // answers 409 when stock moves between the two reads.
    expect([400, 409]).toContain(res.status);
    expect(res.body.message).toMatch(/available/i);

    expect(await prisma.order.count()).toBe(before.orders);
    expect(await prisma.inventoryMovement.count()).toBe(before.movements);
    const lot = await prisma.inventoryLot.findUnique({ where: { id: listing.inventoryLotId } });
    expect(lot.reservedQuantityKg).toBe(0);
    expect(lot.availableQuantityKg).toBe(100);
  });
});

describe('Security — data exposure and transport', () => {
  test('public listings expose neither the pickup street nor the coordinates', async () => {
    const { listing } = await seedListing({ city: 'Chennai' });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { latitude: 13.0827, longitude: 80.2707 },
    });

    const list = await request(app).get('/api/v1/marketplace');
    expect(list.status).toBe(200);
    const json = JSON.stringify(list.body);
    expect(json).not.toContain('Secret Yard');
    expect(json).not.toContain('80.2707');

    const detail = await request(app).get(`/api/v1/marketplace/${listing.id}`);
    expect(JSON.stringify(detail.body)).not.toContain('Secret Yard');
    expect(JSON.stringify(detail.body)).not.toContain('80.2707');
  });

  test('the buyer street address stays out of the seller payload until release', async () => {
    const buyer = await createUser();
    const { seller, listing } = await seedListing();
    const created = await request(app)
      .post('/api/v1/orders')
      .set('Cookie', cookieFor(buyer))
      .send({ items: [{ listingId: listing.id, weightKg: 20 }], delivery: DELIVERY });
    const orderId = created.body.data.order.id;
    await prisma.order.update({ where: { id: orderId }, data: { status: 'ACCEPTED' } });

    const asSeller = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Cookie', cookieFor(seller));
    expect(asSeller.status).toBe(200);
    expect(asSeller.body.data.order.delivery.address).toBeUndefined();
    expect(JSON.stringify(asSeller.body)).not.toContain('4 Hidden Lane');

    const asAdmin = await request(app)
      .get(`/api/v1/admin/orders/${orderId}`)
      .set('Cookie', cookieFor(await createAdmin()));
    expect(asAdmin.body.data.order.delivery.address).toBe('4 Hidden Lane');
  });

  test('security headers and CORS behave for the configured origins', async () => {
    const allowed = env.corsOrigins[0];
    const ok = await request(app).get('/api/v1/categories').set('Origin', allowed);
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['x-powered-by']).toBeUndefined();
    expect(ok.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');

    const preflight = await request(app)
      .options('/api/v1/orders')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');

    const rejected = await request(app)
      .get('/api/v1/categories')
      .set('Origin', 'https://evil-copier.example');
    expect(rejected.status).toBe(403);
    expect(rejected.body.message).toMatch(/CORS/);
  });

  test('server errors never leak stacks in production mode', async () => {
    const { errorHandler } = require('../src/middleware/error');
    const previous = env.isProd;
    env.isProd = true;
    try {
      let captured;
      const res = {
        status(code) {
          captured = { code, body: null };
          return this;
        },
        json(body) {
          captured.body = body;
          return this;
        },
      };
      errorHandler(new Error('secret internals at /home/dev'), { path: '/x' }, res, () => {});
      expect(captured.code).toBe(500);
      expect(captured.body.message).toBe('Internal Server Error');
      expect(captured.body.stack).toBeUndefined();
      expect(JSON.stringify(captured.body)).not.toContain('secret internals');
    } finally {
      env.isProd = previous;
    }
  });

  test('health endpoints expose no secrets or credentials', async () => {
    for (const path of ['/api/v1/health', '/api/v1/health/db']) {
      const res = await request(app).get(path);
      const json = JSON.stringify(res.body);
      expect(res.status).toBe(200);
      expect(json).not.toMatch(/password|secret|adminpassword|postgresql:/i);
    }
  });
});
