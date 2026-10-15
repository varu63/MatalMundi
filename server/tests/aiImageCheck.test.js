'use strict';

/**
 * AI-image screening (warn-only) tests. The real Python service can't run in
 * CI/dev here, so an in-process HTTP stub implements the same contract
 * (GET /health, POST /detect multipart "files" → { results: [{ name, aiScore }] })
 * and also serves the photo bytes, keeping every image download local.
 *
 * Invariants under test:
 *  - no ML_SERVICE_URL            → check skipped silently, listing unaffected
 *  - publish with ML up           → background check flags high scores
 *  - ML down / malformed response → listing still saved, status='error'
 *  - admin filter + recheck       → flagged-only list, manual re-run works
 */

const http = require('http');
const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/db');
const env = require('../src/config/env');
const { runAiImageCheck } = require('../src/services/aiImageCheck');
const { MINI_PNG, createUser, createAdmin, submitWaste } = require('./utils');

let stub;
let stubBase;
let stubMode = 'high'; // 'high' | 'low' | 'down' | 'garbage'

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    if (req.url === '/img') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(MINI_PNG);
      return;
    }
    if (req.url === '/detect') {
      req.resume();
      req.on('end', () => {
        if (stubMode === 'down') {
          res.writeHead(500);
          res.end('boom');
          return;
        }
        if (stubMode === 'garbage') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>not json</html>');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            results: [{ name: 'a.png', aiScore: stubMode === 'high' ? 0.97 : 0.05 }],
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubBase = `http://127.0.0.1:${stub.address().port}`;
}, 30000);

afterAll(async () => new Promise((resolve) => stub.close(resolve)));

afterEach(() => {
  env.mlServiceUrl = '';
  stubMode = 'high';
});

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function settle(listingId, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const row = await prisma.marketplaceListing.findUnique({ where: { id: listingId } });
    if (row.imageCheckStatus !== 'pending') return row;
    if (Date.now() - start > timeoutMs) throw new Error('image check did not settle');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Full sell → approve → collect → publish flow over HTTP (photos = stub). */
async function publishListing() {
  const [seller, admin] = await Promise.all([createUser(), createAdmin()]);
  const [sellerCookie, adminCookie] = await Promise.all([cookieFor(seller), cookieFor(admin)]);

  const submitted = await submitWaste({ cookie: sellerCookie, quantityKg: 500 });
  expect(submitted.status).toBe(201);
  const submission = submitted.body.data.submission;

  const approve = await request(app)
    .post(`/api/v1/admin/waste-submissions/${submission.id}/approve`)
    .set('Cookie', adminCookie)
    .send({});
  expect(approve.status).toBe(200);

  const collect = await request(app)
    .post(`/api/v1/admin/waste-submissions/${submission.id}/collect`)
    .set('Cookie', adminCookie)
    .send({ acceptedQuantityKg: 500 });
  expect(collect.status).toBe(200);

  // Point the submission photos at the stub so the check never needs the network.
  const stubImage = { url: `${stubBase}/img`, publicId: 'stub/img', provider: 'stub' };
  await prisma.wasteSubmission.update({
    where: { id: submission.id },
    data: { images: { front: stubImage, back: stubImage, left: stubImage, right: stubImage } },
  });

  const publish = await request(app)
    .post(`/api/v1/admin/waste-submissions/${submission.id}/publish`)
    .set('Cookie', adminCookie)
    .field('title', 'Copper scrap 500 kg')
    .field('description', 'Sorted, clean copper scrap from a verified seller.')
    .field('pricePerKg', 480)
    .field('minPurchaseKg', 0)
    .field('deliveryTerms', 'Pickup from facility');
  expect(publish.status).toBe(200);
  return { listing: publish.body.data.listing, adminCookie };
}

describe('AI-image screening of marketplace listings', () => {
  test('without ML_SERVICE_URL the check is skipped silently', async () => {
    env.mlServiceUrl = '';
    const { listing } = await publishListing();
    const row = await prisma.marketplaceListing.findUnique({ where: { id: listing.id } });
    expect(row.publicationStatus).toBe('PUBLISHED');
    expect(row.imageCheckStatus).toBe('pending');
    expect(row.imageCheckFlagged).toBe(false);
  }, 180000);

  test('publish background-check flags the listing when the ML service reports a high score', async () => {
    stubMode = 'high';
    env.mlServiceUrl = stubBase;
    const { listing, adminCookie } = await publishListing();

    const row = await settle(listing.id);
    expect(row.imageCheckStatus).toBe('done');
    expect(row.imageCheckFlagged).toBe(true);
    expect(row.imageCheckMaxScore).toBeCloseTo(0.97, 5);
    expect(Array.isArray(row.imageCheckPerImage)).toBe(true);

    const res = await request(app)
      .get('/api/v1/admin/listings?aiFlagged=true')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const flagged = res.body.data.filter((l) => l.id === listing.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].imageCheck.status).toBe('done');
    expect(flagged[0].imageCheck.flagged).toBe(true);

    const unflagged = await request(app)
      .get('/api/v1/admin/listings?aiFlagged=false')
      .set('Cookie', adminCookie);
    expect(unflagged.body.data.some((l) => l.id === listing.id)).toBe(false);
  }, 180000);

  test('low ML scores leave the listing unflagged', async () => {
    stubMode = 'low';
    env.mlServiceUrl = stubBase;
    const { listing } = await publishListing();

    const row = await settle(listing.id);
    expect(row.imageCheckStatus).toBe('done');
    expect(row.imageCheckFlagged).toBe(false);
    expect(row.imageCheckMaxScore).toBeCloseTo(0.05, 5);
  }, 180000);

  test('ML service down → listing is still published, check records error, nothing throws', async () => {
    stubMode = 'down';
    env.mlServiceUrl = stubBase;
    const { listing } = await publishListing();

    const row = await settle(listing.id);
    expect(row.publicationStatus).toBe('PUBLISHED');
    expect(row.imageCheckStatus).toBe('error');
    expect(row.imageCheckError).toBeTruthy();
    expect(row.imageCheckFlagged).toBe(false);
  }, 180000);

  test('malformed ML response is recorded as error, never thrown', async () => {
    const { listing } = await publishListing();
    stubMode = 'garbage';
    env.mlServiceUrl = stubBase;

    await expect(
      runAiImageCheck(listing.id, [{ url: `${stubBase}/img` }])
    ).resolves.toBeUndefined();

    const row = await prisma.marketplaceListing.findUnique({ where: { id: listing.id } });
    expect(row.imageCheckStatus).toBe('error');
  }, 180000);

  test('admin recheck endpoint re-runs the check from stored photo URLs', async () => {
    const { listing, adminCookie } = await publishListing();
    expect(
      (await prisma.marketplaceListing.findUnique({ where: { id: listing.id } })).imageCheckStatus
    ).toBe('pending');

    // Non-admin cannot trigger a recheck.
    const stranger = await createUser();
    const strangerCookie = await cookieFor(stranger);
    const denied = await request(app)
      .post(`/api/v1/admin/listings/${listing.id}/recheck`)
      .set('Cookie', strangerCookie);
    expect(denied.status).toBe(403);

    stubMode = 'high';
    env.mlServiceUrl = stubBase;
    const res = await request(app)
      .post(`/api/v1/admin/listings/${listing.id}/recheck`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.listing.imageCheck.status).toBe('pending');

    const row = await settle(listing.id);
    expect(row.imageCheckStatus).toBe('done');
    expect(row.imageCheckFlagged).toBe(true);
  }, 180000);
});
