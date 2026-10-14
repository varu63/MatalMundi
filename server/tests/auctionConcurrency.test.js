'use strict';

/**
 * Load-style test: many buyers bidding on the same auction at the same moment.
 * The service serialises every bid through an interactive transaction that
 * row-locks the auction (SELECT ... FOR UPDATE), so no matter how the requests
 * interleave the invariant set below must hold.
 */

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/db');
const { createUser, createAdmin, submitWaste } = require('./utils');

const AUCTION_DEFAULTS = {
  quantityKg: 500,
  saleMode: 'AUCTION',
  startingPricePerKg: 20,
  expectedPricePerKg: 25,
  minAcceptablePerKg: 18,
};

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

function placeBid(cookie, auctionId, bidPerKgPaise) {
  return request(app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Cookie', cookie)
    .send({ bidPerKgPaise });
}

describe('Concurrent bidding swarm (row-lock serialization under load)', () => {
  test('40 simultaneous buyers keep the auction ledger consistent', async () => {
    const BIDDERS = 40;
    const [seller, admin, ...buyers] = await Promise.all([
      createUser(),
      createAdmin(),
      ...Array.from({ length: BIDDERS }, () => createUser()),
    ]);

    const sCookie = await cookieFor(seller);
    const adminCookie = await cookieFor(admin);

    const submitted = await submitWaste({ cookie: sCookie, ...AUCTION_DEFAULTS });
    expect(submitted.status).toBe(201);
    const auctionId = submitted.body.data.auction.id;

    const approved = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/approve`)
      .set('Cookie', adminCookie)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.auction.status).toBe('ACTIVE');

    const cookies = await Promise.all(buyers.map((b) => cookieFor(b)));

    // Thundering herd: the first half all fire the SAME price point at once;
    // the second half fires an ascending ladder (some will land out of order).
    const SAME_PRICE = 2000; // paise
    const results = await Promise.all(
      cookies.map((cookie, i) =>
        i < BIDDERS / 2
          ? placeBid(cookie, auctionId, SAME_PRICE)
          : placeBid(cookie, auctionId, 2000 + (i - BIDDERS / 2 + 1) * 100)
      )
    );

    // 1. Every request gets a handled outcome — never a 5xx.
    for (const r of results) {
      expect([200, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.success).toBe(false);
    }

    const wins = results.filter((r) => r.status === 200);
    const amounts = wins.map((r) => r.body.data.bid.bidPerKgPaise);
    expect(wins.length).toBeGreaterThan(0);

    // 2. No two accepted bids share a price point, and accepted prices ascend.
    const sorted = [...amounts].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]).toBeGreaterThan(sorted[i - 1]);
    }

    // 3. The identical-price herd produces exactly one winner.
    const samePriceWins = amounts.filter((a) => a === SAME_PRICE).length;
    expect(samePriceWins).toBeLessThanOrEqual(1);

    // 4. Auction row matches the accepted set exactly.
    const row = await prisma.wasteAuction.findUnique({ where: { id: auctionId } });
    expect(row.bidCount).toBe(wins.length);
    expect(row.bidderCount).toBe(wins.length);
    expect(row.currentHighestBidPerKgPaise).toBe(Math.max(...amounts));

    const bidRows = await prisma.wasteAuctionBid.findMany({ where: { auctionId } });
    expect(bidRows).toHaveLength(wins.length);
    const dbAmounts = bidRows.map((b) => b.bidPerKgPaise).sort((a, b) => a - b);
    expect(dbAmounts).toEqual(sorted);

    // 5. Exactly one leading bid — the top one.
    const leading = bidRows.filter((b) => b.status === 'LEADING');
    expect(leading).toHaveLength(1);
    expect(leading[0].bidPerKgPaise).toBe(Math.max(...amounts));
    // Load-style test: ~85 bcryptjs cost-12 ops dominate runtime on slow CPUs
    // (measured ~285s of hashing on a 1.6GHz-constrained laptop; bids take ~5s).
  }, 480_000);
});
