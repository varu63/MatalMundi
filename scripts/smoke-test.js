'use strict';

/**
 * Production smoke test — run against any deployment.
 *
 *   node scripts/smoke-test.js [BASE_URL] [FRONTEND_URL]
 *   npm run smoke -- https://matalmundi.onrender.com
 *
 * BASE_URL is the site origin (API is mounted at /api/v1 on the same origin in
 * the single-service Render deployment). Defaults also read BASE_URL /
 * FRONTEND_URL environment variables.
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const FRONT = (process.argv[3] || process.env.FRONTEND_URL || BASE).replace(/\/+$/, '');
const API = `${BASE}/api/v1`;

const EXPECTED_CATEGORY_SLUGS = [
  'ferrous',
  'non-ferrous',
  'e-waste',
  'battery',
  'industrial-scrap',
  'automotive-scrap',
  'construction-demolition',
  'plastic',
  'paper-cardboard',
  'other-recyclables',
];

let failures = 0;
function check(name, okFlag, detail = '') {
  console.log(`${okFlag ? '✔' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!okFlag) failures += 1;
}

async function get(url, opts = {}) {
  const res = await fetch(url, { redirect: 'manual', ...opts });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body, text };
}

async function main() {
  console.log(`Smoke-testing API ${API} · frontend ${FRONT}\n`);

  // 1. /health — process up.
  const health = await get(`${API}/health`);
  check('GET /health returns 200', health.status === 200, `status ${health.status}`);

  // 2. /health/db — real query against PostgreSQL.
  const healthDb = await get(`${API}/health/db`);
  check('GET /health/db reports connected', healthDb.status === 200 && healthDb.body?.data?.db === 'connected', `status ${healthDb.status}`);

  // 3. Categories — all 10 intended slugs present and active.
  const cats = await get(`${API}/categories`);
  const list = cats.body?.data?.categories || [];
  const slugs = new Set(list.map((c) => c.slug));
  const missing = EXPECTED_CATEGORY_SLUGS.filter((s) => !slugs.has(s));
  check(
    'GET /categories contains the 10 seeded categories',
    cats.status === 200 && missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${list.length} total`
  );

  // 4. Protected route without a session → 401 JSON.
  const guarded = await get(`${API}/admin/dashboard`);
  check(
    'Unauthenticated /admin/dashboard returns 401',
    guarded.status === 401 && guarded.body?.success === false,
    `status ${guarded.status}`
  );

  // 5. Unknown API route → JSON 404 (not an SPA HTML fallback).
  const nope = await get(`${API}/not-a-real-route-xyz`);
  check(
    'Unknown API route returns JSON 404',
    nope.status === 404 && nope.body?.success === false,
    `status ${nope.status}`
  );

  // 6. CORS preflight from the frontend origin.
  const preflight = await fetch(`${API}/categories`, {
    method: 'OPTIONS',
    headers: { Origin: FRONT, 'Access-Control-Request-Method': 'GET' },
  });
  const allowOrigin = preflight.headers.get('access-control-allow-origin');
  check(
    'CORS preflight allows the frontend origin',
    preflight.status < 400 && (allowOrigin === FRONT || allowOrigin === '*'),
    `allow-origin: ${allowOrigin}`
  );

  // 7. Frontend HTML loads and references a JS bundle.
  const html = await get(FRONT);
  const bundleMatch = (html.text || '').match(/\/assets\/index-[\w-]+\.js/);
  check('Frontend HTML loads with a JS bundle', html.status === 200 && !!bundleMatch, bundleMatch ? bundleMatch[0] : 'no bundle found');

  // 8. The served bundle must not contain a localhost API base.
  if (bundleMatch) {
    const bundle = await get(`${FRONT}${bundleMatch[0]}`);
    const leaks = /localhost:5000|http:\/\/127\.0\.0\.1/.test(bundle.text || '');
    check('JS bundle contains no localhost API URL', !leaks);
  }

  console.log(`\n${failures === 0 ? 'All checks passed ✔' : `${failures} check(s) FAILED ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test could not run:', err.message);
  process.exit(1);
});
