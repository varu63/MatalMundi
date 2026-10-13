/**
 * Restart-recovery prep: creates a 1-minute live auction owned by a fresh
 * seller, approves it via the admin API and prints AUCTION_ID / END_AT so the
 * shell driver can kill the server past the deadline and restart it.
 *
 * Usage: node scripts/e2e-recovery-prep.mjs <adminEmail> <adminPassword> <categoryId>
 */
const BASE = process.env.BASE || 'http://localhost:5000/api/v1';
const [adminEmail, adminPassword, categoryId, durationArg] = process.argv.slice(2);
const DURATION = Number(durationArg) || 1;
const RUN = Date.now().toString(36);

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function makeJar() {
  const jar = new Map();
  const api = async (method, path, { body, form } = {}) => {
    const h = {};
    if (jar.size) h.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = jar.get('mm.csrf');
    if (csrf) h['x-csrf-token'] = csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return {
    get: (p) => api('GET', p),
    post: (p, body) => api('POST', p, { body }),
    patch: (p, body) => api('PATCH', p, { body }),
    postForm: (p, form) => api('POST', p, { form }),
    primeCsrf: () => api('GET', '/auth/csrf'),
  };
}

async function main() {
  const adminJ = makeJar();
  const sellerJ = makeJar();
  await adminJ.primeCsrf();
  const login = await adminJ.post('/auth/login', { email: adminEmail, password: adminPassword });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.json)}`);

  // Temporarily allow 1-minute auctions so the recovery window is short.
  const before = await adminJ.get('/admin/auction-settings');
  const original = before.json.data.settings;
  const relaxed = await adminJ.patch('/admin/auction-settings', {
    minDurationMinutes: 1,
    defaultDurationMinutes: DURATION,
    allowedDurationsMinutes: [DURATION],
  });
  if (relaxed.status !== 200) throw new Error(`settings relax failed: ${JSON.stringify(relaxed.json)}`);

  await sellerJ.primeCsrf();
  const email = `recovery-seller-${RUN}@e2e.dev`;
  const reg = await sellerJ.post('/auth/register', {
    name: 'Recovery Seller',
    email,
    phone: '9876543210',
    password: 'Password123!',
  });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
  await sellerJ.post('/auth/verify-email', { token: reg.json.data.emailVerificationToken });

  const fd = new FormData();
  for (const [k, v] of Object.entries({
    materialCategory: categoryId,
    materialType: 'MS Scrap',
    quantityKg: 600,
    condition: 'LOOSE',
    qualityGrade: 'B',
    description: 'Restart-recovery lot — server will be down at the deadline.',
    pickup: JSON.stringify({
      address: '9 Foundry Road',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411019',
      contactName: 'Recovery Seller',
      contactPhone: '9876543210',
    }),
    demandBasis: 'TOTAL',
    demandedPrice: 12000,
    saleMode: 'AUCTION',
    startingPricePerKg: 22,
    durationMinutes: DURATION,
  })) {
    fd.append(k, v);
  }
  for (const side of ['front', 'back', 'left', 'right', 'weightEvidence']) {
    fd.append(side, new Blob([MINI_PNG], { type: 'image/png' }), `${side}.png`);
  }
  const sub = await sellerJ.postForm('/waste-submissions', fd);
  if (sub.status !== 201) throw new Error(`submission failed: ${JSON.stringify(sub.json).slice(0, 300)}`);

  const mine = await sellerJ.get('/auctions/my');
  const auction = mine.json.data[0];

  const approve = await adminJ.post(`/admin/auctions/${auction.id}/approve`, { durationMinutes: DURATION });
  if (approve.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approve.json).slice(0, 300)}`);

  // Restore the platform settings right away — the auction keeps its 1-minute duration.
  const restore = await adminJ.patch('/admin/auction-settings', {
    minDurationMinutes: original.minDurationMinutes,
    defaultDurationMinutes: original.defaultDurationMinutes,
    allowedDurationsMinutes: original.allowedDurationsMinutes,
  });
  if (restore.status !== 200) throw new Error(`settings restore failed: ${JSON.stringify(restore.json)}`);

  const live = approve.json.data.auction;
  console.log(`AUCTION_ID=${live.id}`);
  console.log(`END_AT=${new Date(live.endAt).toISOString()}`);
  console.log(`SELLER_EMAIL=${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
