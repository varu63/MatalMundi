/**
 * Live end-to-end verification of the auction feature against the running
 * dev stack (Express on :5000 + Docker PostgreSQL). Creates REAL records via
 * the public/admin APIs — no mocks, no direct table writes except promoting
 * the admin account (no API exists for that by design).
 *
 * Usage:  node scripts/e2e-auction-live.mjs
 * Env:    BASE (default http://localhost:5000/api/v1), ORIGIN (default http://localhost:5000)
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// socket.io-client is a dependency of the React app, not the server.
const clientRequire = createRequire(
  fileURLToPath(new URL('../../client/package.json', import.meta.url))
);
const { io } = clientRequire('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:5000/api/v1';
const ORIGIN = process.env.ORIGIN || 'http://localhost:5000';
const RUN = Date.now().toString(36);
const PASSWORD = 'Password123!';

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Tiny cookie-jar fetch wrapper ────────────────────────────────────────────
function makeJar(base) {
  const jar = new Map();
  const api = async (method, path, { body, form, headers = {} } = {}) => {
    const h = { ...headers };
    if (jar.size) h.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = jar.get('mm.csrf');
    if (csrf) h['x-csrf-token'] = csrf;
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: h,
      body: payload,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  };
  return {
    jar,
    get: (p) => api('GET', p),
    post: (p, body) => api('POST', p, { body }),
    patch: (p, body) => api('PATCH', p, { body }),
    postForm: (p, form) => api('POST', p, { form }),
    cookieHeader: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    primeCsrf: () => api('GET', '/auth/csrf'),
  };
}

function form(fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  for (const [field, filename] of files) {
    fd.append(field, new Blob([MINI_PNG], { type: 'image/png' }), filename);
  }
  return fd;
}

async function main() {
  console.log(`\n=== Live auction E2E on ${BASE} (run ${RUN}) ===\n`);

  // ── 1. Accounts (real registration flow) ───────────────────────────────────
  console.log('1. Accounts');
  const sellerJ = makeJar(BASE);
  const buyerAJ = makeJar(BASE);
  const buyerBJ = makeJar(BASE);
  const adminJ = makeJar(BASE);
  const anonJ = makeJar(BASE);

  const users = [
    ['seller', sellerJ, `seller-${RUN}@e2e.dev`],
    ['buyerA', buyerAJ, `buyerA-${RUN}@e2e.dev`],
    ['buyerB', buyerBJ, `buyerB-${RUN}@e2e.dev`],
    ['admin', adminJ, `admin-${RUN}@e2e.dev`],
  ];
  for (const [label, jar, email] of users) {
    await jar.primeCsrf();
    const reg = await jar.post('/auth/register', {
      name: `E2E ${label}`,
      email,
      phone: '9876543210',
      password: PASSWORD,
    });
    if (reg.status !== 201)
      throw new Error(`register ${label} failed: ${JSON.stringify(reg.json)}`);
    if (reg.json.data.emailVerificationToken) {
      const v = await jar.post('/auth/verify-email', {
        token: reg.json.data.emailVerificationToken,
      });
      check(`${label} registered + email verified`, v.status === 200, `status ${v.status}`);
    } else {
      check(`${label} registered`, true);
    }
  }

  // Admin role has no self-service path by design — promote directly in the DB.
  const adminEmail = users[3][2];
  execSync(
    `docker exec metalmundi psql -U admin -d metalmundi -c "UPDATE users SET role='ADMIN' WHERE email='${adminEmail}';"`,
    { stdio: 'pipe' }
  );
  for (const [label, jar, email] of users) {
    await jar.post('/auth/logout');
    const login = await jar.post('/auth/login', { email, password: PASSWORD });
    if (login.status !== 200)
      throw new Error(`login ${label} failed: ${JSON.stringify(login.json)}`);
  }
  const me = await adminJ.get('/auth/me');
  check(
    'admin login carries ADMIN role',
    me.json?.data?.user?.role === 'ADMIN',
    JSON.stringify(me.json?.data?.user?.role)
  );

  // ── 2. Admin configuration ─────────────────────────────────────────────────
  console.log('\n2. Admin configuration');
  const before = await adminJ.get('/admin/auction-settings');
  const original = before.json.data.settings;
  const patch = await adminJ.patch('/admin/auction-settings', {
    minDurationMinutes: 1,
    defaultDurationMinutes: 1,
    allowedDurationsMinutes: [1, 2],
  });
  check(
    'auction settings updated (1–2 min durations)',
    patch.status === 200 && patch.json.data.settings.defaultDurationMinutes === 1
  );
  const cutoff = await adminJ.patch('/admin/auction-settings', { minDurationMinutes: 10 });
  check(
    'cross-field validation rejected (min above default)',
    cutoff.status === 400,
    `status ${cutoff.status}`
  );
  await adminJ.patch('/admin/auction-settings', { minDurationMinutes: 1 });

  const cat = await adminJ.post('/admin/categories', { name: `E2E Ferrous ${RUN}` });
  const categoryId = cat.json?.data?.category?.id;
  check('category created', cat.status === 201 && Boolean(categoryId));
  const price = await adminJ.post('/admin/pricing', {
    materialCategory: categoryId,
    materialType: 'MS Scrap',
    ratePerKg: 18,
    basePickupCharge: 500,
    perKmCharge: 12,
    platformFeePercent: 5,
    taxPercent: 18,
  });
  check('pricing config created', price.status === 201, JSON.stringify(price.json).slice(0, 120));

  // ── 3. Seller submits an auction ───────────────────────────────────────────
  console.log('\n3. Auction submission');
  const sub = await sellerJ.postForm(
    '/waste-submissions',
    form(
      {
        materialCategory: categoryId,
        materialType: 'MS Scrap',
        quantityKg: 500,
        condition: 'LOOSE',
        qualityGrade: 'B',
        description: 'Live E2E auction lot — sorted mild steel scrap, free of paint and rust.',
        pickup: {
          address: '12 Industrial Estate',
          city: 'Pune',
          state: 'Maharashtra',
          postalCode: '411019',
          contactName: 'E2E Seller',
          contactPhone: '9876543210',
        },
        demandBasis: 'TOTAL',
        demandedPrice: 10000,
        comments: 'E2E live run',
        saleMode: 'AUCTION',
        startingPricePerKg: 20,
        expectedPricePerKg: 25,
        minAcceptablePerKg: 18,
        reservePricePerKg: 21,
        durationMinutes: 1,
        inspectionNotes: 'Weighed on certified scale.',
      },
      [
        ['front', 'front.png'],
        ['back', 'back.png'],
        ['left', 'left.png'],
        ['right', 'right.png'],
        ['weightEvidence', 'weightEvidence.png'],
      ]
    )
  );
  check(
    'auction submission accepted',
    sub.status === 201,
    `status ${sub.status}: ${JSON.stringify(sub.json).slice(0, 200)}`
  );
  let myAuctions = await sellerJ.get('/auctions/my');
  const auction = myAuctions.json?.data?.[0];
  check(
    'auction record created (PENDING_APPROVAL)',
    auction?.status === 'PENDING_APPROVAL',
    auction?.status
  );
  const auctionId = auction.id;

  const queue = await adminJ.get('/admin/auctions?status=PENDING_APPROVAL');
  const inQueue = (queue.json?.data || []).some((a) => a.id === auctionId);
  check('auction visible in admin queue', inQueue);

  // ── 4. Approval + socket subscription ─────────────────────────────────────
  console.log('\n4. Approval + real-time subscription');
  const approve = await adminJ.post(`/admin/auctions/${auctionId}/approve`, { durationMinutes: 1 });
  check(
    'auction approved and live',
    approve.status === 200 && approve.json.data.auction.status === 'ACTIVE'
  );

  const socketEvents = [];
  const socket = io(ORIGIN, {
    transports: ['websocket'],
    extraHeaders: { Cookie: buyerAJ.cookieHeader() },
  });
  const userSocketEvents = [];
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
  socket.on('auction:bid', (p) => socketEvents.push(['bid', p]));
  socket.on('auction:extended', (p) => socketEvents.push(['extended', p]));
  socket.on('auction:ended', (p) => socketEvents.push(['ended', p]));
  socket.on('auction:outbid', (p) => userSocketEvents.push(p));
  socket.emit('auction:join', auctionId);
  await sleep(400);

  // ── 5. Bidding rules ───────────────────────────────────────────────────────
  console.log('\n5. Bidding rules');
  await anonJ.primeCsrf();
  const anonBid = await anonJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2000 });
  check('anonymous bid rejected (401)', anonBid.status === 401, `status ${anonBid.status}`);

  const selfBid = await sellerJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2000 });
  check('seller self-bid rejected (403)', selfBid.status === 403, `status ${selfBid.status}`);

  const lowBid = await buyerAJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 1900 });
  check(
    'bid below starting price rejected (409)',
    lowBid.status === 409,
    `status ${lowBid.status}`
  );

  const key = `e2e-${RUN}-a1`;
  const bidA = await buyerAJ.post(`/auctions/${auctionId}/bids`, {
    bidPerKgPaise: 2000,
    idempotencyKey: key,
  });
  check(
    'first bid at starting price accepted',
    bidA.status === 200,
    `status ${bidA.status}: ${JSON.stringify(bidA.json).slice(0, 160)}`
  );
  const replay = await buyerAJ.post(`/auctions/${auctionId}/bids`, {
    bidPerKgPaise: 2000,
    idempotencyKey: key,
  });
  check(
    'idempotent replay reported, not re-recorded',
    replay.status === 200 && /already recorded/i.test(replay.json?.message || ''),
    `status ${replay.status}: ${replay.json?.message}`
  );

  const staleBid = await buyerBJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2000 });
  check('equal/stale bid rejected (409)', staleBid.status === 409, `status ${staleBid.status}`);

  const bidB = await buyerBJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2100 });
  check('higher bid accepted (reserve met exactly)', bidB.status === 200, `status ${bidB.status}`);

  const pub = await anonJ.get(`/auctions/${auctionId}`);
  const a = pub.json.data.auction;
  check(
    'public state shows highest bid',
    a.currentHighestBidPerKgPaise === 2100,
    String(a.currentHighestBidPerKgPaise)
  );
  check(
    'public state hides reserve/minAcceptable/expected',
    a.reservePricePerKgPaise === undefined &&
      a.minAcceptablePerKgPaise === undefined &&
      a.expectedPricePerKgPaise === undefined
  );
  const ownerView = await sellerJ.get(`/auctions/${auctionId}`);
  check(
    'owner sees reserve price',
    ownerView.json.data.auction.reservePricePerKgPaise === 2100,
    String(ownerView.json.data.auction.reservePricePerKgPaise)
  );

  const bids = await anonJ.get(`/auctions/${auctionId}/bids`);
  const bidRows = bids.json.data;
  check(
    'bid history order (2100 first)',
    bidRows[0].bidPerKgPaise === 2100 && bidRows.length === 2,
    JSON.stringify(bidRows.map((b) => b.bidPerKgPaise))
  );
  check(
    'public bid history anonymizes bidders',
    bidRows.every((b) => !b.bidderName && !b.bidderEmail)
  );

  await sleep(600);
  check(
    'socket auction:bid broadcast received',
    socketEvents.some(([e]) => e === 'bid')
  );
  check(
    'outbid party notified in real time',
    userSocketEvents.length >= 1,
    JSON.stringify(userSocketEvents).slice(0, 160)
  );

  const notifA = await buyerAJ.get('/notifications/my');
  const outbidNotif = (notifA.json?.data || []).find(
    (n) => n.type === 'AUCTION' && /outbid/i.test(n.title)
  );
  check(
    'in-app outbid notification stored (type AUCTION)',
    Boolean(outbidNotif),
    JSON.stringify(notifA.json).slice(0, 200)
  );

  // ── 6. Server-authoritative deadline ───────────────────────────────────────
  console.log('\n6. Deadline enforcement + worker finalization');
  const mineBefore = await sellerJ.get('/auctions/my');
  const endAt = new Date(mineBefore.json.data[0].endAt).getTime();
  const early = await buyerAJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2200 });
  check('bid before deadline accepted (2200)', early.status === 200, `status ${early.status}`);

  console.log(
    `   waiting for deadline (${Math.max(0, Math.round((endAt - Date.now()) / 1000))}s)…`
  );
  let finalState = null;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const s = await anonJ.get(`/auctions/${auctionId}`);
    finalState = s.json.data.auction;
    if (['AWAITING_PAYMENT', 'ENDED', 'NO_BIDS'].includes(finalState.status)) break;
  }
  check(
    'auction finalized by worker after deadline',
    finalState.status === 'AWAITING_PAYMENT',
    finalState.status
  );
  check('winner is the latest highest bidder', finalState.currentHighestBidPerKgPaise === 2200);
  check(
    'socket auction:ended broadcast received',
    socketEvents.some(([e]) => e === 'ended')
  );

  const latebid = await buyerAJ.post(`/auctions/${auctionId}/bids`, { bidPerKgPaise: 2300 });
  check('bid after deadline rejected (409)', latebid.status === 409, `status ${latebid.status}`);

  // ── 7. Settlement, payment, pickup ─────────────────────────────────────────
  console.log('\n7. Settlement + payment + pickup');
  const detail = await adminJ.get(`/admin/auctions/${auctionId}`);
  const settled = detail.json.data.auction;
  const gross = 2200 * 500;
  check(
    'settlement gross = bid × listed qty',
    settled.settlement?.grossPaise === gross,
    `${settled.settlement?.grossPaise} vs ${gross}`
  );
  check(
    'settlement tax = 18% of gross',
    settled.settlement?.taxPaise === Math.round(gross * 0.18),
    String(settled.settlement?.taxPaise)
  );
  check(
    'buyer payable = gross + tax',
    settled.settlement?.buyerPayablePaise === gross + Math.round(gross * 0.18)
  );

  // The final 2200 bid was placed by buyer A — the winner and order owner.
  const myOrders = await buyerAJ.get('/orders/my');
  const order = (myOrders.json?.data || []).find((o) => o.auction === auction.id);
  check(
    'winner has a linked order (UNPAID, AWAITING flow)',
    Boolean(order) && order?.payment?.status === 'UNPAID',
    JSON.stringify((myOrders.json?.data || []).slice(0, 1)).slice(0, 200)
  );

  const pay = await adminJ.post(`/admin/auctions/${auctionId}/payment-received`, {
    provider: 'MANUAL',
    reference: `E2E-${RUN}`,
  });
  check(
    'payment recorded → AWAITING_PICKUP',
    pay.status === 200 && pay.json.data.auction.status === 'AWAITING_PICKUP'
  );

  const complete = await adminJ.post(`/admin/auctions/${auctionId}/complete`, {
    verifiedQuantityKg: 480,
    note: 'E2E verified weight 480 kg',
  });
  const done = complete.json?.data?.auction;
  check(
    'verified quantity adjustment recomputes settlement',
    done?.settlement?.grossPaise === 2200 * 480 && done?.settlement?.quantitySource === 'VERIFIED',
    JSON.stringify(done?.settlement)?.slice(0, 200)
  );
  check(
    'adjustment recorded on auction',
    Array.isArray(done?.adjustments) && done.adjustments.length === 1
  );
  check('auction COMPLETED', done?.status === 'COMPLETED', done?.status);

  const myOrders2 = await buyerAJ.get('/orders/my');
  const order2 = (myOrders2.json?.data || []).find((o) => o.auction === auction.id);
  check(
    'order delivered with verified weight',
    order2?.status === 'DELIVERED' && order2?.items?.[0]?.weightKg === 480,
    JSON.stringify({ status: order2?.status, kg: order2?.items?.[0]?.weightKg })
  );

  if (order2) {
    const orderPanel = await adminJ.patch(`/admin/orders/${order2.id}/status`, {
      status: 'PROCESSING',
    });
    check(
      'auction order blocked from the normal order panel (409)',
      orderPanel.status === 409,
      `status ${orderPanel.status}`
    );
  } else {
    check('auction order blocked from the normal order panel (409)', false, 'no order found');
  }

  const sellerNotif = await sellerJ.get('/notifications/my');
  const sellerList = sellerNotif.json?.data || [];
  check(
    'seller got payment + completion notifications',
    sellerList.some((n) => /payment received/i.test(n.title)) &&
      sellerList.some((n) => /auction completed/i.test(n.title)),
    JSON.stringify(sellerList.map((n) => n.title)).slice(0, 200)
  );

  // ── 8. Restore original settings ───────────────────────────────────────────
  console.log('\n8. Restore settings');
  const restore = await adminJ.patch('/admin/auction-settings', {
    minAuctionQuantityKg: original.minAuctionQuantityKg,
    defaultDurationMinutes: original.defaultDurationMinutes,
    minDurationMinutes: original.minDurationMinutes,
    maxDurationMinutes: original.maxDurationMinutes,
    allowedDurationsMinutes: original.allowedDurationsMinutes,
    minIncrementType: original.minIncrementType,
    minIncrementValue: original.minIncrementValue,
  });
  check(
    'settings restored to pre-run values',
    restore.status === 200 &&
      restore.json.data.settings.minDurationMinutes === original.minDurationMinutes
  );

  socket.close();

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nE2E crashed:', err);
  process.exit(1);
});
