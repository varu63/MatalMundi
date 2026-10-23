/**
 * Frontend timing probe (Playwright, Chromium).
 *
 *   node scripts/e2e-perf.mjs
 *
 * Measures how long the SPA takes to become useful on the local dev stack:
 * document timing for the shell, plus the moment real content (a heading, a
 * listing card, a rendered form) is present. Each page is loaded in a fresh
 * context so no warm HTTP cache or service worker flatters the numbers, and the
 * repeat run shows what a returning visitor sees.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = process.env.E2E_CLIENT || 'http://localhost:5173';
const OUT_DIR = path.resolve(import.meta.dirname, 'browser-evidence');
const RUNS = 3;

const PAGES = [
  { name: 'landing', path: '/', ready: 'h1' },
  { name: 'marketplace', path: '/marketplace', ready: 'a[href*="/marketplace/"]' },
  { name: 'login', path: '/login', ready: '#login-email' },
  { name: 'register', path: '/register', ready: '#register-email' },
];

async function measure(browser, page, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // LCP entries are only exposed to getEntriesByType once a buffered observer has
  // subscribed, so register one before any script on the page runs.
  await context.addInitScript(() => {
    window.__lcp = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const p = await context.newPage();
  const started = Date.now();
  const response = await p.goto(`${CLIENT}${page.path}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector(page.ready, { timeout: 30000 });
  const readyMs = Date.now() - started;
  const timing = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const lcp = window.__lcp || [...performance.getEntriesByType('largest-contentful-paint')].pop();
    return {
      ttfbMs: Math.round(nav.responseEnd - nav.responseStart),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      loadMs: Math.round(nav.loadEventEnd - nav.startTime),
      lcpMs: lcp ? Math.round(lcp.startTime) : null,
      transferBytes: nav.transferSize,
    };
  });
  await context.close();
  return {
    page: page.name,
    label,
    status: response ? response.status() : null,
    readyMs,
    ...timing,
  };
}

// Interaction timings: how long a user waits between acting and seeing the new
// results. apiMs is the round trip to the matching endpoint; renderMs is measured
// page-side as the quiet period after the DOM stops changing.
async function waitForQuiet(p, quietMs = 250) {
  return p.evaluate(
    (q) =>
      new Promise((resolve) => {
        let timer;
        const obs = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, q);
        });
        function done() {
          obs.disconnect();
          resolve(performance.now() - window.__t0);
        }
        window.__t0 = performance.now();
        timer = setTimeout(done, q);
        obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      }),
    quietMs
  );
}

async function measureInteractions(browser) {
  const out = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  const run = async (name, path, action, apiMatch) => {
    await p.goto(`${CLIENT}${path}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('main');
    // one settle so the initial load does not count as the interaction
    await waitForQuiet(p);
    const started = Date.now();
    const watcher = p
      .waitForResponse((res) => res.url().includes(apiMatch), { timeout: 20000 })
      .then((res) => ({ status: res.status(), apiMs: Date.now() - started }))
      .catch(() => null);
    await action(p);
    const api = await watcher;
    const renderMs = Math.round(await waitForQuiet(p));
    out.push({ name, totalMs: Date.now() - started, renderMs, ...(api || { status: null, apiMs: null }) });
  };

  await run('marketplace search', '/marketplace', async (page) => {
    await page.waitForSelector('[aria-label="Search materials"]');
    await page.fill('[aria-label="Search materials"]', 'steel');
    await page.press('[aria-label="Search materials"]', 'Enter');
  }, '/api/v1/marketplace');

  await run('marketplace category chip', '/marketplace', async (page) => {
    await page.waitForSelector('.chip');
    await page.locator('.chip').nth(1).click();
  }, '/api/v1/marketplace');

  await run('listing detail open', '/marketplace', async (page) => {
    await page.waitForSelector('a[href*="/marketplace/"]');
    await Promise.all([
      page.waitForNavigation().catch(() => null),
      page.locator('a[href*="/marketplace/"]').first().click(),
    ]);
  }, '/api/v1/marketplace/');

  await context.close();
  return out;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];
  // Vite serves unbundled modules on the first hit and caches them afterwards,
  // so the first pass is labelled cold and the rest warm.
  for (let i = 0; i < RUNS; i += 1) {
    const label = i === 0 ? 'cold' : 'warm';
    for (const page of PAGES) rows.push(await measure(browser, page, label));
  }
  const interactions = await measureInteractions(browser);
  await browser.close();

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const cold = rows.filter((r) => r.label === 'cold');
  const warm = rows.filter((r) => r.label === 'warm');
  const table = PAGES.map((page) => {
    const c = cold.filter((r) => r.page === page.name);
    const w = warm.filter((r) => r.page === page.name);
    return {
      page: page.name,
      coldReadyMs: median(c.map((r) => r.readyMs)),
      warmReadyMs: median(w.map((r) => r.readyMs)),
      coldLcpMs: median(c.map((r) => r.lcpMs ?? r.readyMs)),
      coldTtfbMs: median(c.map((r) => r.ttfbMs)),
      coldTransferBytes: Math.max(...c.map((r) => r.transferBytes || 0), 0),
    };
  });

  const out = path.join(OUT_DIR, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify({ client: CLIENT, runs: RUNS, rows, table, interactions }, null, 2));
  console.log(
    `${'page'.padEnd(12)}${'cold ready'.padStart(11)}${'warm ready'.padStart(11)}${'cold LCP'.padStart(10)}${'TTFB'.padStart(7)}${'bytes'.padStart(9)}`
  );
  for (const row of table) {
    console.log(
      `${row.page.padEnd(12)}${`${row.coldReadyMs}ms`.padStart(11)}${`${row.warmReadyMs}ms`.padStart(11)}${`${row.coldLcpMs}ms`.padStart(10)}${`${row.coldTtfbMs}ms`.padStart(7)}${String(row.coldTransferBytes).padStart(9)}`
    );
  }
  console.log(`\n${'interaction'.padEnd(26)}${'api'.padStart(8)}${'render'.padStart(8)}${'total'.padStart(8)}  status`);
  for (const row of interactions) {
    console.log(
      `${row.name.padEnd(26)}${`${row.apiMs}ms`.padStart(8)}${`${row.renderMs}ms`.padStart(8)}${`${row.totalMs}ms`.padStart(8)}  ${row.status}`
    );
  }
  console.log(`\nReport: ${out}`);
}

main().catch((err) => {
  console.error('Perf harness failure:', err);
  process.exit(2);
});
