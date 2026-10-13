'use strict';

const request = require('supertest');
const app = require('../src/app');
const { prisma } = require('../src/config/db');
const auctionService = require('../src/services/auctionService');
const {
  createUser,
  createAdmin,
  createCategory,
  createPricing,
  submitWaste,
  attachImages,
} = require('./utils');

async function cookieFor(user) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123' });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

async function party() {
  const [seller, buyerA, buyerB, admin] = await Promise.all([
    createUser(),
    createUser(),
    createUser(),
    createAdmin(),
  ]);
  const [sCookie, aCookie, bCookie, adminCookie] = await Promise.all([
    cookieFor(seller),
    cookieFor(buyerA),
    cookieFor(buyerB),
    cookieFor(admin),
  ]);
  return { seller, buyerA, buyerB, admin, sCookie, aCookie, bCookie, adminCookie };
}

// ₹20/kg starting, ₹25/kg expected, ₹18/kg floor — all in rupees for the form.
const AUCTION_DEFAULTS = {
  quantityKg: 500,
  saleMode: 'AUCTION',
  startingPricePerKg: 20,
  expectedPricePerKg: 25,
  minAcceptablePerKg: 18,
};

function submitAuction(cookie, overrides = {}) {
  return submitWaste({ cookie, ...AUCTION_DEFAULTS, ...overrides });
}

function approveAuction(adminCookie, auctionId, body = {}) {
  return request(app)
    .post(`/api/v1/admin/auctions/${auctionId}/approve`)
    .set('Cookie', adminCookie)
    .send(body);
}

function placeBid(cookie, auctionId, bidPerKgPaise, idempotencyKey) {
  return request(app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Cookie', cookie)
    .send({ bidPerKgPaise, ...(idempotencyKey ? { idempotencyKey } : {}) });
}

/** Moves an ACTIVE auction's deadline relative to now (ms; negative = past). */
function shiftEndAt(auctionId, msFromNow) {
  return prisma.wasteAuction.update({
    where: { id: auctionId },
    data: { endAt: new Date(Date.now() + msFromNow) },
  });
}

/** Submit + approve (starts immediately) → live ACTIVE auction. */
async function createLiveAuction(sCookie, adminCookie, overrides = {}, approveBody = {}) {
  const res = await submitAuction(sCookie, overrides);
  expect(res.status).toBe(201);
  const auctionId = res.body.data.auction.id;
  const approved = await approveAuction(adminCookie, auctionId, approveBody);
  expect(approved.status).toBe(200);
  expect(approved.body.data.auction.status).toBe('ACTIVE');
  return { auctionId, submissionId: res.body.data.submission.id };
}

describe('Auction submission eligibility & creation', () => {
  test('auctions below the admin-configured minimum quantity are rejected', async () => {
    const { sCookie } = await party();
    const res = await submitAuction(sCookie, { quantityKg: 400 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 500 kg/i);
  });

  test('normal sales are unaffected (100 kg minimum still applies)', async () => {
    const { sCookie } = await party();
    const res = await submitWaste({ cookie: sCookie, quantityKg: 100 });
    expect(res.status).toBe(201);
    expect(res.body.data.submission.saleMode).toBe('NORMAL');
  });

  test('a qualifying auction creates the auction row together with the submission', async () => {
    const { sCookie, seller } = await party();
    const res = await submitAuction(sCookie);
    expect(res.status).toBe(201);

    const { submission, auction } = res.body.data;
    expect(submission.saleMode).toBe('AUCTION');
    expect(submission.status).toBe('PENDING_APPROVAL');
    expect(auction.status).toBe('PENDING_APPROVAL');
    expect(auction.quantityKg).toBe(500);
    expect(auction.startingPricePerKgPaise).toBe(2000); // ₹20/kg
    expect(auction.expectedPricePerKgPaise).toBe(2500); // owner-only field
    expect(auction.minAcceptableBidPerKgPaise).toBe(1800);
    expect(auction.minNextBidPaise).toBe(2000); // no bids → start at starting price
    expect(auction.bidCount).toBe(0);

    const row = await prisma.wasteAuction.findUnique({ where: { id: auction.id } });
    expect(row.sellerId).toBe(seller.id);
    expect(row.durationMinutes).toBe(30); // admin default
  });

  test('auction mode requires the weight-evidence photograph', async () => {
    const { sCookie } = await party();
    const category = await createCategory();
    await createPricing(category);

    let req = request(app).post('/api/v1/waste-submissions').set('Cookie', sCookie);
    const fields = {
      materialCategory: category.id,
      materialType: 'MS Scrap',
      quantityKg: 500,
      condition: 'LOOSE',
      qualityGrade: 'B',
      description: 'Clean mild steel scrap, sorted, free of paint and rust.',
      pickup: JSON.stringify({
        address: '12 Industrial Estate',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411019',
        contactName: 'Rohit Gupta',
        contactPhone: '9876543210',
      }),
      demandBasis: 'TOTAL',
      demandedPrice: 2000,
      saleMode: 'AUCTION',
      startingPricePerKg: 20,
    };
    for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
    req = await attachImages(req); // four sides only — no weight evidence
    const res = await req;

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/weight evidence/i);
  });

  test('auction mode requires a starting price and validates the reserve price', async () => {
    const { sCookie } = await party();
    const noStart = await submitAuction(sCookie, { startingPricePerKg: undefined });
    expect(noStart.status).toBe(400);

    const badReserve = await submitAuction(sCookie, {
      startingPricePerKg: 20,
      reservePricePerKg: 15, // below the starting price
    });
    expect(badReserve.status).toBe(400);
  });

  test('seller duration must be one of the admin-allowed options', async () => {
    const { sCookie } = await party();
    const notAllowed = await submitAuction(sCookie, { durationMinutes: 20 });
    expect(notAllowed.status).toBe(400);

    const allowed = await submitAuction(sCookie, { durationMinutes: 15, quantityKg: 600 });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.auction.durationMinutes).toBe(15);
  });
});

describe('Auction approval & public visibility', () => {
  test('pending auctions are private until an admin approves them', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const res = await submitAuction(sCookie);
    const auctionId = res.body.data.auction.id;

    const list = await request(app).get('/api/v1/auctions');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);

    const detail = await request(app).get(`/api/v1/auctions/${auctionId}`);
    expect(detail.status).toBe(404);

    // The seller can see their own pending auction.
    const own = await request(app).get(`/api/v1/auctions/${auctionId}`).set('Cookie', sCookie);
    expect(own.status).toBe(200);
    expect(own.body.data.auction.status).toBe('PENDING_APPROVAL');

    // Buyers cannot see it either.
    const asBuyer = await request(app).get(`/api/v1/auctions/${auctionId}`).set('Cookie', aCookie);
    expect(asBuyer.status).toBe(404);

    // Only admins can approve.
    const notAdmin = await approveAuction(aCookie, auctionId);
    expect(notAdmin.status).toBe(403);

    const approve = await approveAuction(adminCookie, auctionId);
    expect(approve.status).toBe(200);
    expect(approve.body.data.auction.status).toBe('ACTIVE');

    const listAfter = await request(app).get('/api/v1/auctions?status=ACTIVE');
    expect(listAfter.body.data.some((a) => a.id === auctionId)).toBe(true);

    const sub = await prisma.wasteSubmission.findUnique({
      where: { id: res.body.data.submission.id },
    });
    expect(sub.status).toBe('APPROVED');
  });

  test('scheduled auctions become live via the worker when their start time arrives', async () => {
    const { sCookie, aCookie, adminCookie } = await party();
    const res = await submitAuction(sCookie);
    const auctionId = res.body.data.auction.id;

    const startAt = new Date(Date.now() + 60_000).toISOString();
    const approved = await approveAuction(adminCookie, auctionId, { startAt });
    expect(approved.body.data.auction.status).toBe('SCHEDULED');
    expect(approved.body.data.auction.endAt).toBeDefined();

    const early = await placeBid(aCookie, auctionId, 2000);
    expect(early.status).toBe(409);

    // Simulate the start time arriving, then run one worker pass.
    await prisma.wasteAuction.update({
      where: { id: auctionId },
      data: { startAt: new Date(Date.now() - 1000) },
    });
    await auctionService.tickAuctions();

    const detail = await request(app).get(`/api/v1/auctions/${auctionId}`);
    expect(detail.body.data.auction.status).toBe('ACTIVE');

    const late = await placeBid(aCookie, auctionId, 2000);
    expect(late.status).toBe(200);
  });
});

describe('Bidding rules (server-validated)', () => {
  test('login is required to bid', async () => {
    const { sCookie, adminCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    const res = await request(app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .send({ bidPerKgPaise: 2000 });
    expect(res.status).toBe(401);
  });

  test('the first bid must be at least the starting price', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);

    const tooLow = await placeBid(aCookie, auctionId, 1999);
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.message).toMatch(/minimum acceptable bid is 2000/i);

    const ok = await placeBid(aCookie, auctionId, 2000);
    expect(ok.status).toBe(200);
    expect(ok.body.data.bid.bidPerKgPaise).toBe(2000);
    expect(ok.body.data.auction.currentHighestBidPerKgPaise).toBe(2000);
  });

  test('subsequent bids must beat the current bid by the minimum increment', async () => {
    const { sCookie, adminCookie, aCookie, bCookie, buyerA } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);

    const tooLow = await placeBid(bCookie, auctionId, 2099); // increment is 100 paise
    expect(tooLow.status).toBe(409);

    const ok = await placeBid(bCookie, auctionId, 2100);
    expect(ok.status).toBe(200);

    // A's bid is now outbid.
    const aBid = await prisma.wasteAuctionBid.findFirst({
      where: { auctionId, bidderId: buyerA.id },
    });
    expect(aBid.status).toBe('OUTBID');
  });

  test('sellers cannot bid on their own waste', async () => {
    const { sCookie, adminCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    const res = await placeBid(sCookie, auctionId, 2000);
    expect(res.status).toBe(403);
  });

  test('bids after the deadline are rejected', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await shiftEndAt(auctionId, -5000);

    const res = await placeBid(aCookie, auctionId, 2000);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ended/i);
  });

  test('retried bids with the same idempotency key are recorded exactly once', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    const key = 'retry-key-1234567890';

    const first = await placeBid(aCookie, auctionId, 2000, key);
    expect(first.status).toBe(200);
    const second = await placeBid(aCookie, auctionId, 2000, key);
    expect(second.status).toBe(200);
    expect(second.body.data.bid.id).toBe(first.body.data.bid.id);

    expect(await prisma.wasteAuctionBid.count({ where: { auctionId } })).toBe(1);
    const row = await prisma.wasteAuction.findUnique({ where: { id: auctionId } });
    expect(row.bidCount).toBe(1);
  });

  test('two simultaneous identical bids never both win (row-lock serialization)', async () => {
    const { sCookie, adminCookie, aCookie, bCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);

    const [r1, r2] = await Promise.all([
      placeBid(aCookie, auctionId, 2000),
      placeBid(bCookie, auctionId, 2000),
    ]);
    const wins = [r1, r2].filter((r) => r.status === 200).length;
    const conflicts = [r1, r2].filter((r) => r.status === 409).length;
    expect(wins).toBe(1);
    expect(conflicts).toBe(1);

    const row = await prisma.wasteAuction.findUnique({ where: { id: auctionId } });
    expect(row.bidCount).toBe(1);
    expect(row.bidderCount).toBe(1);
  });

  test('outbid buyers are notified in-app', async () => {
    const { sCookie, adminCookie, aCookie, bCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);
    await placeBid(bCookie, auctionId, 2100);

    const notes = await request(app).get('/api/v1/notifications/my').set('Cookie', aCookie);
    expect(notes.status).toBe(200);
    const outbid = notes.body.data.find((n) => /outbid/i.test(n.title));
    expect(outbid).toBeDefined();
    expect(outbid.type).toBe('AUCTION');
  });

  test('anti-sniping is disabled by default and never extends the timer', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await shiftEndAt(auctionId, 10_000); // inside any would-be window
    const res = await placeBid(aCookie, auctionId, 2000);
    expect(res.status).toBe(200);
    expect(res.body.data.auction.extensionCount).toBe(0);
  });

  test('anti-sniping (when enabled by admin) extends the deadline on late bids', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    await request(app)
      .patch('/api/v1/admin/auction-settings')
      .set('Cookie', adminCookie)
      .send({
        antiSnipingEnabled: true,
        antiSnipingWindowSeconds: 30,
        antiSnipingExtensionSeconds: 60,
      })
      .expect(200);

    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await shiftEndAt(auctionId, 10_000);

    const res = await placeBid(aCookie, auctionId, 2000);
    expect(res.status).toBe(200);
    expect(res.body.data.auction.extensionCount).toBe(1);
    const newEnd = new Date(res.body.data.auction.endAt).getTime();
    expect(newEnd).toBeGreaterThan(Date.now() + 55_000);
  });
});

describe('Auction engine: expiry, reserve price, no-bids', () => {
  test('an auction with no bids ends as NO_BIDS and creates no order', async () => {
    const { sCookie, adminCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await shiftEndAt(auctionId, -1000);
    await auctionService.tickAuctions();

    const detail = await request(app).get(`/api/v1/auctions/${auctionId}`);
    expect(detail.body.data.auction.status).toBe('NO_BIDS');
    expect(detail.body.data.auction.winnerSelectionReason).toBe('NO_BIDS');
    expect(await prisma.order.count()).toBe(0);
  });

  test('a winning bid below the reserve price never auto-awards the auction', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie, {
      reservePricePerKg: 50, // ₹50/kg reserve
    });
    const bid = await placeBid(aCookie, auctionId, 4500); // ₹45/kg < reserve
    expect(bid.status).toBe(200);

    await shiftEndAt(auctionId, -1000);
    await auctionService.tickAuctions();

    const detail = await request(app)
      .get(`/api/v1/admin/auctions/${auctionId}`)
      .set('Cookie', adminCookie);
    expect(detail.body.data.auction.status).toBe('ENDED');
    expect(detail.body.data.auction.winnerSelectionReason).toBe('RESERVE_NOT_MET');
    expect(detail.body.data.auction.winner).toBeFalsy();
    expect(await prisma.order.count()).toBe(0);
  });

  test('startup recovery finalizes auctions that expired while the server was down', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);
    await shiftEndAt(auctionId, -60_000);

    await auctionService.recoverAuctions(); // same pass the server runs at boot

    const row = await prisma.wasteAuction.findUnique({ where: { id: auctionId } });
    expect(row.status).toBe('AWAITING_PAYMENT');
  });

  test('finalization is exactly-once (worker + lazy read do not double-run)', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);
    await shiftEndAt(auctionId, -1000);

    await Promise.all([
      auctionService.tickAuctions(),
      request(app).get(`/api/v1/auctions/${auctionId}`), // lazy finalize path
    ]);
    await auctionService.finalizeAuction(auctionId, { trigger: 'test' }); // late third caller

    expect(await prisma.order.count()).toBe(1);
    const row = await prisma.wasteAuction.findUnique({ where: { id: auctionId } });
    expect(row.status).toBe('AWAITING_PAYMENT');
  });
});

describe('Winner settlement, payment & completion', () => {
  async function liveAuctionWithWinner(winningBid = 2500) {
    const p = await party();
    const { auctionId, submissionId } = await createLiveAuction(p.sCookie, p.adminCookie);
    await placeBid(p.aCookie, auctionId, winningBid);
    await shiftEndAt(auctionId, -1000);
    await auctionService.tickAuctions();
    return { ...p, auctionId, submissionId };
  }

  test('the highest bidder wins, an order is created and the money math is exact', async () => {
    const { auctionId, adminCookie, admin } = await liveAuctionWithWinner(2500);

    const detail = await request(app)
      .get(`/api/v1/admin/auctions/${auctionId}`)
      .set('Cookie', adminCookie);
    const auction = detail.body.data.auction;

    expect(auction.status).toBe('AWAITING_PAYMENT');
    expect(auction.winner).toBeTruthy();
    expect(auction.winningBidPerKgPaise).toBe(2500);
    expect(auction.winnerSelectionReason).toBe('WINNER');

    // gross = 2500 paise × 500 kg = 1,250,000 paise
    const gross = 2500 * 500;
    const tax = Math.round((gross * 18) / 100); // test pricing: 18% tax
    const fee = Math.round((gross * 5) / 100); // test pricing: 5% platform fee
    expect(auction.settlement.grossPaise).toBe(gross);
    expect(auction.settlement.taxPaise).toBe(tax);
    expect(auction.settlement.buyerPayablePaise).toBe(gross + tax);
    expect(auction.settlement.platformFeePaise).toBe(fee);
    expect(auction.settlement.pickupCostPaise).toBeGreaterThan(0);
    expect(auction.settlement.sellerPayoutPaise).toBe(
      gross - fee - auction.settlement.pickupCostPaise
    );
    expect(auction.winningTotalPaise).toBe(gross);

    // The linked order mirrors the auction outcome.
    const order = await prisma.order.findFirst({ where: { auctionId } });
    expect(order).toBeTruthy();
    expect(order.buyerId).toBe(auction.winner.id ?? auction.winner._id);
    expect(order.status).toBe('ACCEPTED');
    expect(order.totalPaise).toBe(gross + tax);
    expect(order.materialSubtotalPaise).toBe(gross);
    expect(order.items[0].unitPricePaise).toBe(2500);
    expect(order.items[0].weightKg).toBe(500);
    expect(order.inventoryReserved).toBe(false);

    // Winner's bid is WON; admin sees it in the bid history.
    const bids = await request(app)
      .get(`/api/v1/admin/auctions/${auctionId}/bids`)
      .set('Cookie', adminCookie);
    const won = bids.body.data.find((b) => b.status === 'WON');
    expect(won).toBeTruthy();
    expect(won.bidderId).toBe(order.buyerId);

    // No inventory lot was ever created for the auction flow.
    expect(await prisma.inventoryLot.count()).toBe(0);
    expect(admin.role).toBe('ADMIN');
  });

  test('payment → pickup → completion runs the full auction lifecycle', async () => {
    const { auctionId, submissionId, adminCookie, sCookie } = await liveAuctionWithWinner(2500);

    const pay = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/payment-received`)
      .set('Cookie', adminCookie)
      .send({ provider: 'MANUAL', reference: 'TXN-TEST-1' });
    expect(pay.status).toBe(200);
    expect(pay.body.data.auction.status).toBe('AWAITING_PICKUP');

    let order = await prisma.order.findFirst({ where: { auctionId } });
    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).toBe('PROCESSING');

    const complete = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/complete`)
      .set('Cookie', adminCookie)
      .send({});
    expect(complete.status).toBe(200);
    expect(complete.body.data.auction.status).toBe('COMPLETED');

    order = await prisma.order.findFirst({ where: { auctionId } });
    expect(order.status).toBe('DELIVERED');

    const sub = await prisma.wasteSubmission.findUnique({ where: { id: submissionId } });
    expect(sub.status).toBe('PURCHASED');

    // Seller gets the completion notification.
    const notes = await request(app).get('/api/v1/notifications/my').set('Cookie', sCookie);
    expect(notes.body.data.some((n) => /completed/i.test(n.title))).toBe(true);
  });

  test('a verified quantity change at pickup is documented and recomputes the settlement', async () => {
    const { auctionId, adminCookie } = await liveAuctionWithWinner(2500);
    await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/payment-received`)
      .set('Cookie', adminCookie)
      .send({});

    const complete = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/complete`)
      .set('Cookie', adminCookie)
      .send({ verifiedQuantityKg: 450, note: 'Weighbridge reading' });
    expect(complete.status).toBe(200);

    const auction = complete.body.data.auction;
    expect(auction.settlement.quantitySource).toBe('VERIFIED');
    expect(auction.settlement.quantityKg).toBe(450);
    expect(auction.settlement.grossPaise).toBe(2500 * 450);
    expect(auction.settlement.buyerPayablePaise).toBe(
      2500 * 450 + Math.round((2500 * 450 * 18) / 100)
    );
    expect(auction.adjustments).toHaveLength(1);
    expect(auction.adjustments[0].fromQuantityKg).toBe(500);
    expect(auction.adjustments[0].toQuantityKg).toBe(450);
    expect(auction.adjustments[0].previous.buyerPayablePaise).toBe(
      2500 * 500 + Math.round((2500 * 500 * 18) / 100)
    );

    const order = await prisma.order.findFirst({ where: { auctionId } });
    expect(order.items[0].weightKg).toBe(450);
    expect(order.items[0].fulfilledWeightKg).toBe(450);
    expect(order.totalPaise).toBe(auction.settlement.buyerPayablePaise);
  });

  test('auction orders cannot be driven from the normal order panel', async () => {
    const { auctionId, adminCookie } = await liveAuctionWithWinner(2500);
    const order = await prisma.order.findFirst({ where: { auctionId } });

    const res = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/auction management/i);
  });
});

describe('Admin controls & queue separation', () => {
  test('rejecting a pending auction cancels it and rejects the submission', async () => {
    const { sCookie, adminCookie } = await party();
    const res = await submitAuction(sCookie);
    const { id: auctionId } = res.body.data.auction;
    const submissionId = res.body.data.submission.id;

    const reject = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/reject`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Photos do not match the described material' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.auction.status).toBe('CANCELLED');

    const sub = await prisma.wasteSubmission.findUnique({ where: { id: submissionId } });
    expect(sub.status).toBe('REJECTED');
    expect(sub.rejectionReason).toMatch(/photos/i);
  });

  test('pre-bid adjustments are allowed, but rules freeze once bids exist', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const res = await submitAuction(sCookie);
    const auctionId = res.body.data.auction.id;

    const adjust = await request(app)
      .patch(`/api/v1/admin/auctions/${auctionId}`)
      .set('Cookie', adminCookie)
      .send({ startingPricePerKgPaise: 2200, minIncrementValue: 200 });
    expect(adjust.status).toBe(200);
    expect(adjust.body.data.auction.startingPricePerKgPaise).toBe(2200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'AUCTION_UPDATE', resourceId: auctionId },
    });
    expect(audit).toBeTruthy();
    expect(audit.before.startingPricePerKgPaise).toBe(2000);
    expect(audit.after.startingPricePerKgPaise).toBe(2200);

    // Approve (starting price is now ₹22/kg) and bid, then try to change rules.
    await approveAuction(adminCookie, auctionId);
    const bid = await placeBid(aCookie, auctionId, 2200);
    expect(bid.status).toBe(200);

    const frozen = await request(app)
      .patch(`/api/v1/admin/auctions/${auctionId}`)
      .set('Cookie', adminCookie)
      .send({ startingPricePerKgPaise: 1000 });
    expect(frozen.status).toBe(409);
    expect(frozen.body.message).toMatch(/already has bids/i);
  });

  test('cancelling after a winner exists cancels the order too (payment failure)', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);
    await shiftEndAt(auctionId, -1000);
    await auctionService.tickAuctions();

    const cancel = await request(app)
      .post(`/api/v1/admin/auctions/${auctionId}/cancel`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Winner did not pay within the window' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.auction.status).toBe('CANCELLED');
    expect(cancel.body.data.auction.winnerSelectionReason).toBe('PAYMENT_FAILED');

    const order = await prisma.order.findFirst({ where: { auctionId } });
    expect(order.status).toBe('CANCELLED');
  });

  test('admin queue lists exclude auction submissions; sellers still see them', async () => {
    const { sCookie, adminCookie } = await party();
    const normal = await submitWaste({ cookie: sCookie, quantityKg: 100 });
    expect(normal.status).toBe(201);
    const auction = await submitAuction(sCookie, { quantityKg: 700 });
    expect(auction.status).toBe(201);

    const queue = await request(app)
      .get('/api/v1/admin/waste-submissions')
      .set('Cookie', adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0].saleMode).toBe('NORMAL');

    const mine = await request(app).get('/api/v1/waste-submissions/my').set('Cookie', sCookie);
    expect(mine.body.data).toHaveLength(2);
    const mineAuction = mine.body.data.find((s) => s.saleMode === 'AUCTION');
    expect(mineAuction).toBeTruthy();
    expect(mineAuction.auction.status).toBe('PENDING_APPROVAL');
  });

  test('admins configure auction eligibility via settings', async () => {
    const { sCookie, adminCookie } = await party();

    const defaults = await request(app)
      .get('/api/v1/admin/auction-settings')
      .set('Cookie', adminCookie);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.settings.minAuctionQuantityKg).toBe(500);
    expect(defaults.body.data.settings.allowedDurationsMinutes).toEqual([10, 15, 30, 60]);

    const invalid = await request(app)
      .patch('/api/v1/admin/auction-settings')
      .set('Cookie', adminCookie)
      .send({ minDurationMinutes: 60, defaultDurationMinutes: 30 });
    expect(invalid.status).toBe(400);

    const updated = await request(app)
      .patch('/api/v1/admin/auction-settings')
      .set('Cookie', adminCookie)
      .send({ minAuctionQuantityKg: 300 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.settings.minAuctionQuantityKg).toBe(300);

    const small = await submitAuction(sCookie, { quantityKg: 400 });
    expect(small.status).toBe(201); // now above the new 300 kg minimum
    const tooSmall = await submitAuction(sCookie, { quantityKg: 250 });
    expect(tooSmall.status).toBe(400);
  });

  test('when admins disable duration choice, the default duration is forced', async () => {
    const { sCookie, adminCookie } = await party();
    await request(app)
      .patch('/api/v1/admin/auction-settings')
      .set('Cookie', adminCookie)
      .send({ sellerCanChooseDuration: false, defaultDurationMinutes: 15 })
      .expect(200);

    const res = await submitAuction(sCookie, { quantityKg: 800, durationMinutes: 60 });
    expect(res.status).toBe(201);
    expect(res.body.data.auction.durationMinutes).toBe(15);
  });
});

describe('Authorization & bidder privacy', () => {
  test('auction detail never leaks the reserve or seller price signals publicly', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie, {
      reservePricePerKg: 30,
    });

    const pub = await request(app).get(`/api/v1/auctions/${auctionId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.auction.reservePricePerKgPaise).toBeUndefined();
    expect(pub.body.data.auction.expectedPricePerKgPaise).toBeUndefined();
    expect(pub.body.data.auction.minAcceptableBidPerKgPaise).toBeUndefined();
    expect(pub.body.data.auction.settlement).toBeUndefined();
    expect(pub.body.data.auction.seller).toBeUndefined();
    expect(pub.body.data.auction.canBid).toBe(true);

    // A logged-in buyer sees exactly the same public view.
    const buyer = await request(app).get(`/api/v1/auctions/${auctionId}`).set('Cookie', aCookie);
    expect(buyer.body.data.auction.reservePricePerKgPaise).toBeUndefined();

    // The seller and admins see the reserve.
    const owner = await request(app).get(`/api/v1/auctions/${auctionId}`).set('Cookie', sCookie);
    expect(owner.body.data.auction.reservePricePerKgPaise).toBe(3000);

    const admin = await request(app)
      .get(`/api/v1/admin/auctions/${auctionId}`)
      .set('Cookie', adminCookie);
    expect(admin.body.data.auction.reservePricePerKgPaise).toBe(3000);
  });

  test('bid histories anonymize other bidders until the auction concludes', async () => {
    const { sCookie, adminCookie, aCookie, bCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);
    await placeBid(bCookie, auctionId, 2100);

    // Buyer B looks at the history: A's identity is hidden, their own is shown.
    const asBuyer = await request(app)
      .get(`/api/v1/auctions/${auctionId}/bids`)
      .set('Cookie', bCookie);
    const rows = asBuyer.body.data;
    expect(rows).toHaveLength(2);
    const other = rows.find((r) => !r.isOwn);
    const mine = rows.find((r) => r.isOwn);
    expect(other.bidderId).toBeUndefined();
    expect(other.anonymous).toBe(true);
    expect(mine.anonymous).toBe(false);
    expect(mine.bidderId).toBeTruthy();

    // The seller cannot identify bidders while the auction is live…
    const ownerLive = await request(app)
      .get(`/api/v1/auctions/${auctionId}/bids`)
      .set('Cookie', sCookie);
    expect(ownerLive.body.data.every((r) => r.anonymous)).toBe(true);

    // …but learns them once it concludes (logistics need).
    await shiftEndAt(auctionId, -1000);
    await auctionService.tickAuctions();
    const ownerEnded = await request(app)
      .get(`/api/v1/auctions/${auctionId}/bids`)
      .set('Cookie', sCookie);
    expect(ownerEnded.body.data.some((r) => r.bidderId)).toBe(true);

    // Admins always see identities.
    const asAdmin = await request(app)
      .get(`/api/v1/admin/auctions/${auctionId}/bids`)
      .set('Cookie', adminCookie);
    expect(asAdmin.body.data.every((r) => r.bidderId)).toBe(true);
  });

  test('non-admins cannot reach the admin auction APIs', async () => {
    const { aCookie } = await party();
    const res = await request(app).get('/api/v1/admin/auctions').set('Cookie', aCookie);
    expect(res.status).toBe(403);
    const settings = await request(app)
      .get('/api/v1/admin/auction-settings')
      .set('Cookie', aCookie);
    expect(settings.status).toBe(403);
  });

  test('my-bids gives buyers the auction context of every bid', async () => {
    const { sCookie, adminCookie, aCookie } = await party();
    const { auctionId } = await createLiveAuction(sCookie, adminCookie);
    await placeBid(aCookie, auctionId, 2000);

    const res = await request(app).get('/api/v1/auctions/my/bids').set('Cookie', aCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('LEADING');
    expect(res.body.data[0].auction.id).toBe(auctionId);
    expect(res.body.data[0].auction.auctionNumber).toMatch(/^AUC/);
  });
});
