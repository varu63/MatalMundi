/**
 * Browser end-to-end + failure-injection run (Playwright, Chromium).
 *
 *   node scripts/e2e-browser.mjs
 *
 * Requires the dev stack already running: API on http://localhost:5000 and the
 * Vite client on http://localhost:5173 (the client build in client/dist is also
 * fine). Three separate browser contexts model three real sessions: a visitor,
 * a buyer and an admin — cookies never cross between them.
 *
 * Every "success" assertion is checked twice: once in the UI and once against
 * the API/database, so a toast that lies is reported as a failure.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const CLIENT = process.env.E2E_CLIENT || 'http://localhost:5173';
const API = process.env.E2E_API || 'http://localhost:5000/api/v1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@metalmundi.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin@1234';
const OUT_DIR = path.resolve(import.meta.dirname, 'browser-evidence');
const RUN = new Date().toISOString().replace(/[:.]/g, '-');

const require_ = createRequire(import.meta.url);
const { signToken, AUTH_COOKIE } = require_('../server/src/services/tokenService.js');

const results = [];
const consoleErrors = [];
const netFailures = [];
let currentSection = 'setup';

function record(name, ok, evidence = '') {
  results.push({ section: currentSection, name, ok, evidence: String(evidence).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${currentSection}] ${name}${ok ? '' : ` → ${evidence}`}`);
}

async function check(name, fn) {
  try {
    const evidence = await fn();
    record(name, true, evidence || '');
    return evidence;
  } catch (err) {
    record(name, false, err.message);
    return null;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Direct API truth-check with a manually assembled cookie jar. */
function makeApiAgent() {
  const jar = new Map();
  const call = async (method, apiPath, body) => {
    // Unsafe methods need the double-submit token, so prime it with a GET first.
    if (method !== 'GET' && !jar.has('mm.csrf')) await call('GET', '/health');
    const headers = { accept: 'application/json' };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = jar.get('mm.csrf');
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${API}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return {
    jar,
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, body),
    patch: (p, body) => call('PATCH', p, body),
  };
}

function newContext(browser, label) {
  const context = browser.newContext({ viewport: { width: 1280, height: 900 } });
  return context;
}

async function attachConsole(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ context: label, text: msg.text() });
  });
  page.on('pageerror', (err) => consoleErrors.push({ context: label, text: `pageerror: ${err.message}` }));
  // A console line alone does not say which call failed, so keep the request too.
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      netFailures.push({
        context: label,
        section: currentSection,
        method: res.request().method(),
        url: res.url().slice(CLIENT.length) || res.url(),
        status: res.status(),
      });
    }
  });
}

async function shoot(page, name) {
  try {
    await page.screenshot({ path: path.join(OUT_DIR, `${RUN}-${name}.png`), fullPage: false });
  } catch {
    // Screenshots are best-effort evidence; the assertions above already ran.
  }
}

/** Fills a React-controlled input the way a user types. */
async function typeInto(page, selector, value) {
  const field = page.locator(selector).first();
  await field.click();
  await field.fill(String(value));
  expect(await field.inputValue(), `field ${selector} did not accept "${value}"`);
}

/** A one-off request carrying a hand-written Cookie header (role probes). */
async function rawCall(apiPath, cookieHeader) {
  const res = await fetch(`${API}${apiPath}`, {
    method: 'GET',
    headers: { accept: 'application/json', cookie: cookieHeader },
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Seller session minted the same way the jest suites do, for privacy probes. */
function sellerCookie(sellerId) {
  return `${AUTH_COOKIE}=${signToken({ id: sellerId, role: 'SELLER' })}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const visitor = await newContext(browser, 'visitor');
  const buyer = await newContext(browser, 'buyer');
  const admin = await newContext(browser, 'admin');

  const labels = ['visitor', 'buyer', 'admin'];
  const pages = await Promise.all(
    [visitor, buyer, admin].map(async (c, i) => {
      const p = await c.newPage();
      attachConsole(p, labels[i]);
      return p;
    })
  );
  const [visitorPage, buyerPage, adminPage] = pages;

  const email = `e2e-buyer-${Date.now()}@example.test`;
  const password = 'E2eTest@123';

  // ── 1. Visitor ────────────────────────────────────────────────────────────
  currentSection = 'visitor';
  await check('landing page renders the real headline', async () => {
    await visitorPage.goto(CLIENT, { waitUntil: 'networkidle' });
    const heading = await visitorPage.locator('h1').first().innerText();
    expect(heading.length > 5, `h1 was "${heading}"`);
    return heading;
  });

  await check('marketplace lists live listings', async () => {
    await visitorPage.goto(`${CLIENT}/marketplace`, { waitUntil: 'networkidle' });
    const cards = await visitorPage.locator('a[href*="/marketplace/"]').count();
    expect(cards > 0, 'no listing links found');
    return `${cards} listing links`;
  });

  const listingHref = await visitorPage.locator('a[href*="/marketplace/"]').first().getAttribute('href');
  const listingId = listingHref.split('/').filter(Boolean).pop();

  await check('a public listing card never shows a street address', async () => {
    await visitorPage.goto(`${CLIENT}${listingHref}`, { waitUntil: 'networkidle' });
    const text = await visitorPage.locator('main').innerText();
    const streetPattern = /\b(Gate|Plot No\.?|Industrial Estate|Lane|Road|Street)\b.*\d/i;
    expect(!streetPattern.test(text), `street-like address found in public detail: ${text.slice(0, 200)}`);
    const api = makeApiAgent();
    const detail = await api.get(`/marketplace/${listingId}`);
    expect(detail.status === 200, `API detail returned ${detail.status}`);
    const raw = JSON.stringify(detail.json);
    expect(!/"(latitude|longitude|pickupAddress)"/.test(raw), `API leaks coordinates: ${raw.slice(0, 200)}`);
    return 'UI + API both free of street/coordinate exposure';
  });

  await check('protected areas are unreachable for a visitor', async () => {
    await visitorPage.goto(`${CLIENT}/dashboard/orders`, { waitUntil: 'networkidle' });
    const url = visitorPage.url();
    expect(/login|register/.test(url), `visitor reached ${url} without logging in`);
    return url;
  });

  // ── 2. Registration and login ─────────────────────────────────────────────
  currentSection = 'auth';
  await check('a new account registers, persists server-side and can log back in', async () => {
    await buyerPage.goto(`${CLIENT}/register`, { waitUntil: 'networkidle' });
    await typeInto(buyerPage, '#register-full-name', 'E2E Buyer');
    await typeInto(buyerPage, '#register-email', email);
    await typeInto(buyerPage, '#register-phone', '9876500011');
    await typeInto(buyerPage, '#register-city', 'Pune');
    await typeInto(buyerPage, '#register-state', 'Maharashtra');
    await typeInto(buyerPage, '#register-password', password);
    await buyerPage.getByRole('button', { name: /create account/i }).first().click();
    await buyerPage.waitForURL(/dashboard/, { timeout: 25000 });
    const url = buyerPage.url();

    const probe = makeApiAgent();
    const login = await probe.post('/auth/login', { email, password });
    expect(login.status === 200, `server rejected the new credentials with ${login.status}`);
    return `landed on ${url}; login confirmed by the API`;
  });

  await check('a wrong password is refused and the UI says so', async () => {
    const api = makeApiAgent();
    const bad = await api.post('/auth/login', { email, password: 'NotThePassword' });
    expect([400, 401].includes(bad.status), `expected rejection, got ${bad.status}`);
    await buyerPage.goto(`${CLIENT}/login`, { waitUntil: 'networkidle' });
    await typeInto(buyerPage, '#login-email', email);
    await typeInto(buyerPage, '#login-password', 'NotThePassword');
    await buyerPage.getByRole('button', { name: /log in|sign in/i }).first().click();
    await buyerPage.waitForTimeout(2500);
    const alert = await buyerPage.getByText(/invalid|incorrect|wrong|not match|failed/i).first().innerText();
    const stillOut = !/dashboard/.test(buyerPage.url());
    expect(stillOut, `wrong password still navigated to ${buyerPage.url()}`);
    return alert;
  });

  await check('duplicate registration is refused with a real message', async () => {
    await buyerPage.goto(`${CLIENT}/register`, { waitUntil: 'networkidle' });
    await typeInto(buyerPage, '#register-full-name', 'E2E Buyer Again');
    await typeInto(buyerPage, '#register-email', email);
    await typeInto(buyerPage, '#register-phone', '9876500012');
    await typeInto(buyerPage, '#register-city', 'Nagpur');
    await typeInto(buyerPage, '#register-state', 'Maharashtra');
    await typeInto(buyerPage, '#register-password', password);
    await buyerPage.getByRole('button', { name: /create account/i }).first().click();
    await buyerPage.waitForTimeout(3000);
    const msg = await buyerPage.getByText(/already|registered|exists|taken/i).first().innerText();
    expect(/register/.test(buyerPage.url()), `duplicate sign-up left the page at ${buyerPage.url()}`);
    return msg;
  });

  // ── 3. Buyer purchase journey ─────────────────────────────────────────────
  currentSection = 'purchase';
  let orderFromUi = null;
  let bookedKg = null;

  await check('a logged-in buyer can stage an order from a listing', async () => {
    await buyerPage.goto(`${CLIENT}/login`, { waitUntil: 'networkidle' });
    await typeInto(buyerPage, '#login-email', email);
    await typeInto(buyerPage, '#login-password', password);
    await buyerPage.getByRole('button', { name: /log in|sign in/i }).first().click();
    await buyerPage.waitForURL(/dashboard/, { timeout: 25000 });

    await buyerPage.goto(`${CLIENT}${listingHref}`, { waitUntil: 'networkidle' });
    const weight = buyerPage.locator('#listingdetail-order-quantity-kg');
    const min = Number(await weight.getAttribute('min')) || 0;
    const max = Number(await weight.getAttribute('max')) || 0;
    expect(max > 0, `listing exposes no available quantity (max=${max})`);
    bookedKg = Math.max(min, Math.min(max, 500));
    await weight.fill(String(bookedKg));
    await buyerPage.getByRole('button', { name: /buy now/i }).first().click();
    await buyerPage.waitForURL(/\/cart/, { timeout: 20000 });
    return `${bookedKg} kg staged in the cart`;
  });

  await check('submitting the cart creates a real order with server-side totals', async () => {
    await typeInto(buyerPage, '#cart-full-name', 'E2E Buyer');
    await typeInto(buyerPage, '#cart-phone', '9876500011');
    await typeInto(buyerPage, '#cart-address', '12 E2E Industrial Lane');
    await typeInto(buyerPage, '#cart-city', 'Pune');
    await typeInto(buyerPage, '#cart-state', 'Maharashtra');
    await typeInto(buyerPage, '#cart-pin', '411001');
    await buyerPage.getByRole('button', { name: /submit purchase request/i }).first().click();
    await buyerPage.waitForURL(/dashboard\/orders/, { timeout: 30000 });
    await shoot(buyerPage, 'after-order-submit');

    const api = makeApiAgent();
    await api.post('/auth/login', { email, password });
    const mine = await api.get('/orders/my?limit=5');
    expect(mine.status === 200, `orders/my returned ${mine.status}`);
    const orders = mine.json.data || [];
    expect(orders.length > 0, 'UI reported success but the account has no orders');
    orderFromUi = orders[0];
    expect(
      orderFromUi.totalPaise >= orderFromUi.materialSubtotalPaise,
      `order totals look wrong: ${JSON.stringify(orderFromUi).slice(0, 200)}`
    );
    expect(
      orderFromUi.status === 'PENDING_ADMIN_APPROVAL',
      `expected a fresh request to await approval, got ${orderFromUi.status}`
    );
    return `${orderFromUi.orderNumber} status ${orderFromUi.status}, total ${orderFromUi.totalPaise} paise`;
  });

  await check('the order survives a full page reload', async () => {
    await buyerPage.goto(`${CLIENT}/dashboard/orders`, { waitUntil: 'networkidle' });
    const found = await buyerPage.getByText(orderFromUi.orderNumber).count();
    expect(found > 0, `${orderFromUi.orderNumber} missing after reload`);
    return orderFromUi.orderNumber;
  });

  await check('the buyer sees a pending state and no seller-side leakage', async () => {
    await buyerPage.goto(`${CLIENT}/dashboard/orders/${orderFromUi.id}`, { waitUntil: 'networkidle' });
    const text = await buyerPage.locator('main').innerText();
    expect(/awaiting|pending|review/i.test(text), `unexpected state text: ${text.slice(0, 200)}`);
    expect(
      /hidden from the seller/i.test(text),
      'the address-release explainer is missing before confirmation'
    );
    return text.match(/[^\n]*(awaiting|pending)[^\n]*/i)?.[0] || 'pending state shown';
  });

  // ── 4. Admin workflow ─────────────────────────────────────────────────────
  currentSection = 'admin workflow';
  const adminLogin = async (page) => {
    await page.goto(`${CLIENT}/login`, { waitUntil: 'networkidle' });
    await typeInto(page, '#login-email', ADMIN_EMAIL);
    await typeInto(page, '#login-password', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /log in|sign in/i }).first().click();
    await page.waitForURL(/dashboard|admin/, { timeout: 25000 });
  };
  const readOrder = async () => {
    const api = makeApiAgent();
    await api.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await api.get(`/admin/orders/${orderFromUi.id}`);
    expect(res.status === 200, `admin order read returned ${res.status}`);
    return res.json.data.order;
  };

  await check('admin logs in and opens the order in the queue', async () => {
    await adminLogin(adminPage);
    await adminPage.goto(`${CLIENT}/admin/orders`, { waitUntil: 'networkidle' });
    const row = adminPage.getByText(orderFromUi.orderNumber).first();
    expect(await row.count(), `${orderFromUi.orderNumber} not listed in the admin queue`);
    await row.click();
    await adminPage.waitForSelector('text=Buyer address release', { timeout: 20000 });
    return 'order detail panel rendered';
  });

  await check('accepting the request writes the transition to the database', async () => {
    await adminPage.getByRole('button', { name: /accept request/i }).first().click();
    await adminPage.waitForTimeout(2000);
    const order = await readOrder();
    expect(order.status === 'ACCEPTED', `status after accept is ${order.status}`);
    const accepted = (order.statusHistory || []).filter((h) => h.status === 'ACCEPTED');
    expect(accepted.length === 1, `${accepted.length} ACCEPTED history entries`);
    return 'status ACCEPTED, one history entry';
  });

  await check('the full inspection chain runs through the UI', async () => {
    const stamp = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
    await typeInto(adminPage, '#wf-scheduled-at', stamp);
    await adminPage.getByRole('button', { name: /schedule inspection/i }).first().click();
    await adminPage.waitForTimeout(1800);
    await adminPage.getByRole('button', { name: /start inspection/i }).first().click();
    await adminPage.waitForTimeout(1800);
    await adminPage.waitForSelector('#wf-actual-qty', { timeout: 20000 });
    await typeInto(adminPage, '#wf-actual-qty', String(bookedKg));
    await adminPage.getByRole('button', { name: /mark passed/i }).first().click();
    await adminPage.waitForTimeout(2200);
    await shoot(adminPage, 'after-inspection');

    const order = await readOrder();
    expect(order.inspection?.status === 'PASSED', `inspection status is ${order.inspection?.status}`);
    return `inspection PASSED, order ${order.status}`;
  });

  await check('admin sets the delivery charge and the total reprices', async () => {
    const before = await readOrder();
    await adminPage.waitForSelector('#wf-charge', { timeout: 20000 });
    await typeInto(adminPage, '#wf-charge', '1500');
    await typeInto(adminPage, '#wf-charge-notes', 'E2E: fixed truck charge for the test run');
    await adminPage.getByRole('button', { name: /send charge to buyer/i }).first().click();
    await adminPage.waitForTimeout(2200);

    const after = await readOrder();
    expect(after.transportationPaise === 150000, `charge not stored: ${after.transportationPaise}`);
    expect(
      after.totalPaise === before.materialSubtotalPaise + before.taxPaise + 150000,
      `total not repriced: expected ${before.materialSubtotalPaise + before.taxPaise + 150000}, got ${after.totalPaise}`
    );
    expect(
      after.status === 'AWAITING_BUYER_CONFIRMATION',
      `status is ${after.status}, expected AWAITING_BUYER_CONFIRMATION`
    );
    return `total ${after.totalPaise} paise, status ${after.status}`;
  });

  await check('the seller cannot read the buyer street before confirmation', async () => {
    const order = await readOrder();
    expect(order.addressReleased === false, `address already released (${order.addressReleased})`);
    expect(order.seller?.id, 'the admin payload carries no seller id');
    const probe = await rawCall(`/orders/${order.id}`, sellerCookie(order.seller.id));
    expect(probe.status === 200, `seller order read returned ${probe.status}`);
    const raw = JSON.stringify(probe.json);
    expect(
      !raw.includes('12 E2E Industrial Lane'),
      `seller payload leaks the street: ${raw.slice(0, 300)}`
    );
    expect(!raw.includes('9876500011'), 'seller payload leaks the buyer phone');
    return 'seller sees no street or phone while addressReleased is false';
  });

  await check('buyer confirmation releases the address and the admin sees it', async () => {
    await buyerPage.goto(`${CLIENT}/dashboard/orders/${orderFromUi.id}`, { waitUntil: 'networkidle' });
    await buyerPage.getByRole('button', { name: /^confirm/i }).first().click();
    await buyerPage.waitForTimeout(2200);
    await shoot(buyerPage, 'after-confirm');

    const buyerApi = makeApiAgent();
    await buyerApi.post('/auth/login', { email, password });
    const asBuyer = (await buyerApi.get(`/orders/${orderFromUi.id}`)).json.data.order;
    expect(asBuyer.addressReleased === true, `addressReleased is ${asBuyer.addressReleased}`);

    const after = await readOrder();
    expect(after.status === 'CONFIRMED', `order status after confirm is ${after.status}`);
    expect(after.delivery?.address, 'admin cannot see the delivery address after release');

    const sellerAfter = await rawCall(`/orders/${after.id}`, sellerCookie(after.seller.id));
    const raw = JSON.stringify(sellerAfter.json);
    expect(
      raw.includes('12 E2E Industrial Lane'),
      'the seller still cannot see the address after the buyer confirmed'
    );
    return 'buyer confirmed; admin and seller can now read the full address';
  });

  // ── 5. Failure injection and recovery ─────────────────────────────────────
  currentSection = 'failure injection';
  await check('an unreachable API shows a retryable error, never a blank page', async () => {
    const page = visitor;
    const probe = await page.newPage();
    await probe.route('**/api/v1/**', (route) => route.abort('failed'));
    await probe.goto(`${CLIENT}/marketplace`, { waitUntil: 'domcontentloaded' });
    await probe.waitForTimeout(2500);
    const body = await probe.locator('body').innerText();
    expect(/retry|error|unable|could not|something went wrong|offline/i.test(body), `body was: ${body.slice(0, 200)}`);
    await shoot(probe, 'api-down');
    await probe.unroute('**/api/v1/**');
    await probe.close();
    return body.match(/[^\n]*(retry|error|unable|offline)[^\n]*/i)?.[0];
  });

  await check('a slow API keeps a loading state instead of a spinner-free freeze', async () => {
    const probe = await visitor.newPage();
    await probe.route('**/api/v1/marketplace**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    await probe.goto(`${CLIENT}/marketplace`, { waitUntil: 'domcontentloaded' });
    await probe.waitForTimeout(800);
    const loading = await probe.locator('[class*="animate-pulse"], [role="status"], [aria-busy="true"], svg[class*="spin"]')
      .count();
    const body = await probe.locator('body').innerText();
    expect(loading > 0 || /load/i.test(body), 'no loading affordance seen during a 3 s response');
    await probe.waitForTimeout(3500);
    await shoot(probe, 'slow-api');
    await probe.close();
    return `${loading} loading elements`;
  });

  await check('a malformed server response does not crash the client', async () => {
    const probe = await visitor.newPage();
    await probe.route('**/api/v1/marketplace**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"not": ["valid"' })
    );
    await probe.goto(`${CLIENT}/marketplace`, { waitUntil: 'domcontentloaded' });
    await probe.waitForTimeout(2500);
    const body = await probe.locator('body').innerText();
    expect(body.length > 0, 'client rendered nothing at all');
    await shoot(probe, 'malformed-response');
    await probe.close();
    return body.match(/[^\n]*(error|retry|unable|went wrong)[^\n]*/i)?.[0] || 'page stayed interactive';
  });

  await check('a 503 from the API offers a retry that recovers once the service is back', async () => {
    const probe = await visitor.newPage();
    let failNext = true;
    await probe.route('**/api/v1/categories**', (route) => {
      if (!failNext) return route.continue();
      failNext = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Database unavailable', code: 'DB_UNAVAILABLE' }),
      });
    });
    await probe.goto(`${CLIENT}/marketplace`, { waitUntil: 'domcontentloaded' });
    await probe.waitForTimeout(1800);
    const errorText = await probe.getByText(/categories failed to load/i).first().innerText();
    const retry = probe.getByRole('button', { name: /^retry$/i }).first();
    expect(await retry.count(), `error shown (${errorText}) but no retry control`);
    await retry.click();
    await probe.waitForTimeout(2500);
    const gone = await probe.getByText(/categories failed to load/i).count();
    expect(gone === 0, 'the retry left the failure message on screen');
    const chips = await probe.locator('button.chip').count();
    expect(chips > 0, 'retry succeeded but no category chips rendered');
    await shoot(probe, 'retry-recovery');
    await probe.close();
    return `${errorText} → retry rendered ${chips} category chips`;
  });

  await check('an expired session during an operation lands on login, not a fake success', async () => {
    await buyerPage.goto(`${CLIENT}/dashboard/orders`, { waitUntil: 'networkidle' });
    await buyerPage.context().clearCookies();
    await buyerPage.reload({ waitUntil: 'networkidle' });
    await buyerPage.waitForTimeout(1200);
    const url = buyerPage.url();
    const body = await buyerPage.locator('body').innerText();
    expect(/login/.test(url) || /session|expired|log in/i.test(body), `stayed on ${url}: ${body.slice(0, 160)}`);
    await shoot(buyerPage, 'session-expired');
    return url;
  });

  await check('back/forward inside the admin session stays in the admin area', async () => {
    await adminPage.goBack();
    await adminPage.waitForTimeout(900);
    const backUrl = adminPage.url();
    await adminPage.goForward();
    await adminPage.waitForTimeout(900);
    const url = adminPage.url();
    expect(/admin/.test(backUrl) && /admin/.test(url), `history left the admin area: ${backUrl} → ${url}`);
    return `${backUrl} → ${url}`;
  });

  await check('history cannot revive an admin screen after logout', async () => {
    await adminPage.goto(`${CLIENT}/admin/orders`, { waitUntil: 'networkidle' });
    await adminPage.getByRole('button', { name: /log out|sign out/i }).first().click();
    await adminPage.waitForTimeout(1500);
    await adminPage.goBack();
    await adminPage.waitForTimeout(1500);
    const url = adminPage.url();
    const body = await adminPage.locator('body').innerText();
    const revived = /admin\/orders/.test(url) && body.includes(orderFromUi.orderNumber);
    expect(!revived, `the queue is still readable from history at ${url} after logout`);
    expect(/login/.test(url) || !body.includes(orderFromUi.orderNumber), `state: ${url}`);
    await shoot(adminPage, 'after-logout-back');
    return `history landed on ${url} with no order rows`;
  });

  // ── Report ────────────────────────────────────────────────────────────────
  const failures = results.filter((r) => !r.ok);
  const report = {
    run: RUN,
    client: CLIENT,
    api: API,
    passed: results.length - failures.length,
    failed: failures.length,
    consoleErrors: consoleErrors.slice(0, 40),
    netFailures,
    results,
  };
  const file = path.join(OUT_DIR, `browser-e2e-${RUN}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n${results.length - failures.length}/${results.length} browser checks passed`);
  console.log(`Report: ${file}`);
  if (netFailures.length) {
    const grouped = {};
    for (const f of netFailures) {
      const key = `${f.status} ${f.method} ${f.url} [${f.context}/${f.section}]`;
      grouped[key] = (grouped[key] || 0) + 1;
    }
    console.log('Failed API calls seen by the browser:');
    for (const [key, n] of Object.entries(grouped)) console.log(`   ${n}× ${key}`);
  }
  if (consoleErrors.length) {
    console.log(`Console errors captured: ${consoleErrors.length}`);
  }
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Harness failure:', err);
  process.exit(2);
});
