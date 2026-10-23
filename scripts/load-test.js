'use strict';

/**
 * Load harness — zero new dependencies (Node core http + worker_threads).
 *
 *   node scripts/load-test.js --base-url http://localhost:5100 \
 *        --levels 1,10,25,50 --duration 20 --writes
 *
 * Closed workload model: for every level the harness keeps exactly N requests
 * in flight (N = virtual users) for `--duration` seconds. Thread count is
 * capped at the CPU count and each thread runs several sequential loops, so
 * "50 users" means 50 concurrent request loops, not 50 OS threads.
 *
 * Reports RPS, totals, 4xx/5xx, p50/p95/p99 per endpoint and overall, plus
 * PostgreSQL connection usage sampled from pg_stat_activity during each level.
 * Nothing is faked: a level that cannot complete is reported as it behaved.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { createRequire } = require('module');

const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {
    baseUrl: process.env.LOAD_BASE_URL || 'http://localhost:5100',
    fixtures: path.resolve(__dirname, 'load-fixtures.json'),
    levels: [1, 10, 25, 50],
    duration: 20, // seconds per level
    warmup: 3, // seconds discarded before sampling
    writes: false,
    dbUrl: process.env.LOAD_DATABASE_URL || '',
    outDir: path.resolve(__dirname, 'load-results'),
    runId: new Date().toISOString().replace(/[-:]/g, '').slice(0, 15),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--fixtures') args.fixtures = argv[++i];
    else if (argv[i] === '--levels') args.levels = argv[++i].split(',').map(Number);
    else if (argv[i] === '--duration') args.duration = Number(argv[++i]);
    else if (argv[i] === '--warmup') args.warmup = Number(argv[++i]);
    else if (argv[i] === '--db-url') args.dbUrl = argv[++i];
    else if (argv[i] === '--out-dir') args.outDir = argv[++i];
    else if (argv[i] === '--writes') args.writes = true;
    else if (argv[i] === '--run-id') args.runId = argv[++i];
  }
  if (args.levels.some((n) => !Number.isFinite(n) || n < 1)) {
    throw new Error('--levels must be positive integers, e.g. 1,10,25,50');
  }
  return args;
}

// ── Workload ────────────────────────────────────────────────────────────────

function buildMix(fixtures, withWrites) {
  const readListing = {
    name: 'listing-detail',
    method: 'GET',
    pick: () => `/api/v1/marketplace/${fixtures.readListingIds[0]}`,
    weight: 14,
  };
  const mix = [
    { name: 'health', method: 'GET', path: '/api/v1/health', weight: 4 },
    { name: 'health-db', method: 'GET', path: '/api/v1/health/db', weight: 4 },
    { name: 'categories', method: 'GET', path: '/api/v1/categories', weight: 8 },
    {
      name: 'marketplace-list',
      method: 'GET',
      pick: (rng) => {
        const page = 1 + Math.floor(rng() * 3);
        const sort = ['newest', 'price_asc', 'price_desc', 'quantity_desc'][Math.floor(rng() * 4)];
        return `/api/v1/marketplace?page=${page}&limit=12&sort=${sort}`;
      },
      weight: 26,
    },
    {
      name: 'marketplace-search',
      method: 'GET',
      pick: () => `/api/v1/marketplace?search=${encodeURIComponent('Copper')}&limit=12`,
      weight: 8,
    },
    {
      name: 'marketplace-nearby',
      method: 'GET',
      // The radius path loads every geocoded row and Haversines in Node.
      pick: () => `/api/v1/marketplace?lat=18.5204&lng=73.8567&radiusKm=25&limit=12`,
      weight: 8,
    },
    readListing,
    {
      name: 'orders-my',
      method: 'GET',
      path: '/api/v1/orders/my?limit=20',
      weight: 8,
      cookie: (fixtures) => fixtures.buyerCookies,
    },
    {
      name: 'submissions-my',
      method: 'GET',
      path: '/api/v1/waste-submissions/my?limit=20',
      weight: 6,
      cookie: (fixtures) => fixtures.buyerCookies,
    },
    {
      name: 'estimate',
      method: 'POST',
      path: '/api/v1/waste-submissions/estimate',
      weight: 6,
      cookie: (fixtures) => fixtures.buyerCookies,
      body: (fixtures, rng) => {
        const category = fixtures.categories[Math.floor(rng() * fixtures.categories.length)];
        return {
          materialCategory: category.id,
          materialType: category.types[0],
          quantityKg: 100,
          condition: 'LOOSE',
          qualityGrade: 'B',
          pickup: { city: 'Pune', state: 'Maharashtra', postalCode: '411019' },
          demandBasis: 'TOTAL',
          demandedPrice: 2000,
        };
      },
    },
  ];

  if (withWrites) {
    mix.push({
      name: 'order-create',
      method: 'POST',
      path: '/api/v1/orders',
      weight: 14,
      cookie: (fixtures) => fixtures.buyerCookies,
      body: (fixtures, rng, ctx) => {
        const listingId =
          fixtures.writeListingIds[Math.floor(rng() * fixtures.writeListingIds.length)];
        ctx.idempotencyKeys.add(`load-${ctx.runId}-${ctx.sequence}`);
        return {
          items: [{ listingId, weightKg: 5 }],
          delivery: {
            name: 'Load Buyer',
            phone: '9876500000',
            address: '1 Load Test Road',
            city: 'Pune',
            state: 'Maharashtra',
            postalCode: '411001',
          },
          idempotencyKey: `load-${ctx.runId}-${ctx.sequence}`,
        };
      },
    });
  }
  return mix;
}

/** Deterministic LCG so two runs of the same level emit the same request plan. */
function makeRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pickEndpoint(mix, rng) {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let ticket = rng() * total;
  for (const entry of mix) {
    ticket -= entry.weight;
    if (ticket <= 0) return entry;
  }
  return mix[mix.length - 1];
}

// ── Worker thread: one level slice of virtual users ─────────────────────────

function runWorker() {
  // The mix holds closures, which structuredClone refuses, so each thread
  // rebuilds the identical weight table from the plain fixtures object.
  const { baseUrl, levelSpec, fixtures, withWrites } = workerData;
  const mix = buildMix(fixtures, withWrites);
  const { loopsPerThread, durationMs, warmupMs, runId, seedOffset } = levelSpec;
  const url = new URL(baseUrl);
  const agent = new http.Agent({ keepAlive: true, maxSockets: loopsPerThread + 4 });

  let sequence = 0;
  const idempotencyKeys = new Set();
  // The real double-submit handshake: earn the mm.csrf cookie once per thread
  // and echo it on every unsafe request, so no security control is disabled.
  let csrfToken = null;

  function httpRaw(method, fullPath, headers) {
    return new Promise((resolve) => {
      const req = http.request(
        { host: url.hostname, port: url.port || 80, path: fullPath, method, agent, headers },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
          );
        }
      );
      req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
      req.setTimeout(15000, () => req.destroy());
      req.end();
    });
  }

  async function bootstrapCsrf() {
    const res = await httpRaw('GET', '/api/v1/categories', { accept: 'application/json' });
    const cookies = res.headers['set-cookie'] || [];
    for (const cookie of cookies) {
      const match = /^mm\.csrf=([^;]+)/.exec(cookie);
      if (match) csrfToken = match[1];
    }
  }

  function requestOnce(entry, rng) {
    const started = process.hrtime.bigint();
    const ctx = { runId, sequence: (sequence += 1), idempotencyKeys };
    const fullPath = entry.pick ? entry.pick(rng) : entry.path;
    const cookies = entry.cookie ? entry.cookie(fixtures) : null;
    const sessionCookie = cookies ? cookies[Math.floor(rng() * cookies.length)] : undefined;
    // The double-submit check compares the echoed header to the cookie, so a
    // real client must present both: its session and its csrf cookie.
    const cookieHeader =
      [sessionCookie, csrfToken ? `mm.csrf=${csrfToken}` : null].filter(Boolean).join('; ') ||
      undefined;
    const payload = entry.body ? JSON.stringify(entry.body(fixtures, rng, ctx)) : null;

    return new Promise((resolve) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port || 80,
          path: fullPath,
          method: entry.method,
          agent,
          headers: {
            accept: 'application/json',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
            ...(entry.method !== 'GET' && csrfToken ? { 'x-csrf-token': csrfToken } : {}),
            ...(payload
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
              : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            resolve({
              endpoint: entry.name,
              status: res.statusCode,
              ms,
              bytes: Buffer.concat(chunks).length,
            });
          });
        }
      );
      req.on('error', (err) => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        resolve({ endpoint: entry.name, status: 0, ms, error: err.code || err.message, bytes: 0 });
      });
      req.setTimeout(30000, () => req.destroy(new Error('client-timeout')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function loop(loopIndex) {
    const rng = makeRng(1000 + (seedOffset + loopIndex) * 7919);
    const samples = [];
    const deadline = Date.now() + durationMs;
    const warmupUntil = Date.now() + warmupMs;
    while (Date.now() < deadline) {
      const entry = pickEndpoint(mix, rng);
      const sample = await requestOnce(entry, rng);
      if (Date.now() >= warmupUntil) samples.push(sample);
    }
    return samples;
  }

  bootstrapCsrf()
    .then(() => Promise.all(Array.from({ length: loopsPerThread }, (_, i) => loop(i))))
    .then((all) =>
      parentPort.postMessage({ samples: all.flat(), idempotencyKeys: [...idempotencyKeys] })
    )
    .catch((err) => parentPort.postMessage({ fatal: String(err && err.stack) }));
}

// ── Coordinator ─────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarise(samples, durationMs) {
  const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byEndpoint = {};
  const statusBuckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, error: 0 };
  const statusCodes = {};
  for (const s of samples) {
    if (s.status) statusCodes[s.status] = (statusCodes[s.status] || 0) + 1;
    const bucket =
      s.status === 0
        ? 'error'
        : s.status < 300
          ? '2xx'
          : s.status < 400
            ? '3xx'
            : s.status < 500
              ? '4xx'
              : '5xx';
    statusBuckets[bucket] += 1;
    const entry = (byEndpoint[s.endpoint] ||= {
      count: 0,
      latencies: [],
      failures: 0,
      statuses: {},
    });
    entry.count += 1;
    entry.latencies.push(s.ms);
    entry.statuses[s.status] = (entry.statuses[s.status] || 0) + 1;
    if (bucket === '4xx' || bucket === '5xx' || bucket === 'error') entry.failures += 1;
  }
  for (const entry of Object.values(byEndpoint)) {
    entry.latencies.sort((a, b) => a - b);
    entry.p50 = percentile(entry.latencies, 50);
    entry.p95 = percentile(entry.latencies, 95);
    entry.p99 = percentile(entry.latencies, 99);
    entry.mean = entry.latencies.reduce((a, b) => a + b, 0) / entry.latencies.length;
    delete entry.latencies;
  }
  const total = samples.length;
  return {
    durationMs,
    requests: total,
    rps: Math.round((total / (durationMs / 1000)) * 10) / 10,
    statusBuckets,
    statusCodes,
    errorRatePercent:
      Math.round(
        ((statusBuckets['4xx'] + statusBuckets['5xx'] + statusBuckets.error) / total) * 1000
      ) / 10,
    // 5xx + transport errors are the "server actually failed" measure; a 4xx
    // from an honest validation guard is not a performance failure.
    serverErrorRatePercent:
      Math.round(((statusBuckets['5xx'] + statusBuckets.error) / total) * 1000) / 10,
    p50: percentile(lat, 50),
    p90: percentile(lat, 90),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    max: lat[lat.length - 1],
    mean: lat.reduce((a, b) => a + b, 0) / (total || 1),
    bytesPerSecond: Math.round(
      samples.reduce((sum, s) => sum + s.bytes, 0) / (durationMs / 1000)
    ),
    byEndpoint,
  };
}

function fmt(n, digits = 1) {
  return n === null || n === undefined ? '-' : Number(n).toFixed(digits);
}

function printLevel(users, summary, dbSamples) {
  console.log('');
  console.log(
    `── ${users} virtual users ─ ${summary.requests} requests in ${fmt(
      summary.durationMs / 1000
    )}s · ${summary.rps} req/s · p50 ${fmt(summary.p50)}ms p95 ${fmt(summary.p95)}ms p99 ${fmt(
      summary.p99
    )}ms max ${fmt(summary.max)}ms`
  );
  console.log(
    `   status: 2xx ${summary.statusBuckets['2xx']} · 4xx ${summary.statusBuckets['4xx']} · 5xx ${
      summary.statusBuckets['5xx']
    } · transport ${summary.statusBuckets.error} · error rate ${summary.errorRatePercent}% (${
      summary.serverErrorRatePercent
    }% server)`
  );
  const codes = Object.entries(summary.statusCodes || {}).sort((a, b) => b[1] - a[1]);
  if (codes.length) {
    console.log(`   codes: ${codes.map(([c, n]) => `${c}×${n}`).join(' · ')}`);
  }
  if (dbSamples.length) {
    const counts = dbSamples.map((s) => s.backends);
    console.log(
      `   postgres backends: min ${Math.min(...counts)} · max ${Math.max(
        ...counts
      )} · avg ${fmt(counts.reduce((a, b) => a + b, 0) / counts.length)} (sampled every 1s)`
    );
  }
  const rows = Object.entries(summary.byEndpoint).sort((a, b) => b[1].count - a[1].count);
  console.log(`   ${'endpoint'.padEnd(20)}${'n'.padStart(8)}${'p50'.padStart(9)}${'p95'.padStart(9)}${'p99'.padStart(9)}${'fail'.padStart(7)}`);
  for (const [name, entry] of rows) {
    console.log(
      `   ${name.padEnd(20)}${String(entry.count).padStart(8)}${fmt(entry.p50).padStart(9)}${fmt(
        entry.p95
      ).padStart(9)}${fmt(entry.p99).padStart(9)}${String(entry.failures).padStart(7)}`
    );
  }
}

async function sampleDatabase(prismaClient, stopFlag, sink) {
  while (stopFlag.value) {
    try {
      const rows = await prismaClient.$queryRawUnsafe(
        'SELECT count(*)::int AS backends, sum(CASE WHEN state=$1 THEN 1 ELSE 0 END)::int AS active ' +
          'FROM pg_stat_activity WHERE datname = current_database()',
        'active'
      );
      sink.push({ at: Date.now(), backends: rows[0].backends, active: rows[0].active });
    } catch (err) {
      sink.push({ at: Date.now(), error: err.message });
    }
    await sleep(1000);
  }
}

function systemSnapshot() {
  const load = os.loadavg();
  const free = os.freemem();
  const total = os.totalmem();
  let nodeRssMb = null;
  try {
    // Best-effort: the harness samples the server process when PID is provided.
    if (process.env.LOAD_SERVER_PID) {
      const { execSync } = require('child_process');
      const out = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${process.env.LOAD_SERVER_PID}).WorkingSet64"`,
        { timeout: 5000 }
      ).toString();
      nodeRssMb = Math.round((Number(out.trim()) / 1048576) * 10) / 10;
    }
  } catch {
    nodeRssMb = null;
  }
  return {
    loadAvg1m: load[0],
    usedMemoryMb: Math.round((total - free) / 1048576),
    totalMemoryMb: Math.round(total / 1048576),
    serverRssMb: nodeRssMb,
  };
}

async function runLevel(users, { fixtures, baseUrl, durationMs, warmupMs, runId, withWrites }) {
  const maxThreads = Math.max(1, os.availableParallelism ? os.availableParallelism() : os.cpus().length);
  const threads = Math.min(users, maxThreads);
  // Spread the virtual users evenly so the concurrency actually driven equals
  // the requested level (ceil() per thread would quietly overshoot).
  const base = Math.floor(users / threads);
  const extra = users % threads;
  const loopsFor = (i) => base + (i < extra ? 1 : 0);
  const actualLoops = users;

  const levelSpec = { loops: threads, durationMs, warmupMs, runId };
  const workers = [];
  const started = Date.now();
  const done = Array.from({ length: threads }, (_, i) => {
    const worker = new Worker(__filename, {
      workerData: {
        baseUrl,
        levelSpec: { ...levelSpec, seedOffset: i, loopsPerThread: loopsFor(i) },
        fixtures,
        withWrites,
      },
    });
    workers.push(worker);
    return new Promise((resolve, reject) => {
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`worker exit ${code}`))));
    });
  });

  const results = await Promise.all(done);
  const elapsed = Date.now() - started;
  const samples = results.filter(Boolean).flatMap((r) => r.samples || []);
  const fatals = results.filter((r) => r && r.fatal);
  const keys = results.filter(Boolean).flatMap((r) => r.idempotencyKeys || []);
  return { summary: summarise(samples, elapsed), fatals, idempotencyKeys: keys, actualLoops };
}

async function cleanupWrites(dbUrl, keys) {
  const { PrismaClient } = serverRequire('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    // Only the harness's own orders are removed (identified by their key
    // prefix), then the seeded lots are returned to fixture stock.
    const orders = await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: 'load-' } } });
    await prisma.inventoryMovement.deleteMany({ where: { reason: 'Reserved for order' } });
    const lots = await prisma.inventoryLot.findMany({ where: { lotNumber: { startsWith: 'LOT-LOAD-' } } });
    for (const lot of lots) {
      await prisma.inventoryLot.update({
        where: { id: lot.id },
        data: {
          availableQuantityKg: lot.acceptedQuantityKg,
          reservedQuantityKg: 0,
          soldQuantityKg: 0,
        },
      });
      await prisma.marketplaceListing.updateMany({
        where: { inventoryLotId: lot.id },
        data: {
          availableQuantityKg: lot.acceptedQuantityKg,
          reservedQuantityKg: 0,
          soldQuantityKg: 0,
        },
      });
    }
    console.log(`   cleanup: removed ${orders.count} harness orders and reset ${lots.length} lots`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.fixtures)) {
    throw new Error(
      `Missing ${args.fixtures}. Run scripts/seed-load.js against your load database first.`
    );
  }
  const fixtures = JSON.parse(fs.readFileSync(args.fixtures, 'utf8'));
  const mix = buildMix(fixtures, args.writes);

  let dbPrisma = null;
  if (args.dbUrl) {
    const { PrismaClient } = serverRequire('@prisma/client');
    dbPrisma = new PrismaClient({ datasources: { db: { url: args.dbUrl } } });
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const report = {
    runId: args.runId,
    baseUrl: args.baseUrl,
    startedAt: new Date().toISOString(),
    workload: mix.map((m) => ({ endpoint: m.name, weight: m.weight })),
    thresholds: {
      labelled: 'provisional',
      note: 'No SLA exists for this deployment; these are working targets for a local single-node stack.',
      p95MsOverall: 800,
      serverErrorRatePercent: 1,
    },
    host: { cpus: os.cpus().length, totalMemoryMb: Math.round(os.totalmem() / 1048576) },
    levels: [],
  };

  console.log(
    `Load run ${args.runId} against ${args.baseUrl} · levels ${args.levels.join(', ')} · ` +
      `${args.duration}s each · writes ${args.writes ? 'ON' : 'OFF'}`
  );

  for (const users of args.levels) {
    const dbSamples = [];
    const stopFlag = { value: true };
    const sampler = dbPrisma ? sampleDatabase(dbPrisma, stopFlag, dbSamples) : null;
    const before = systemSnapshot();

    const { summary, fatals, actualLoops } = await runLevel(users, {
      fixtures,
      baseUrl: args.baseUrl,
      durationMs: args.duration * 1000,
      warmupMs: args.warmup * 1000,
      runId: args.runId,
      withWrites: args.writes,
    });

    stopFlag.value = false;
    if (sampler) await sampler;
    const after = systemSnapshot();

    printLevel(users, summary, dbSamples);
    console.log(
      `   host: load(1m) ${fmt(before.loadAvg1m, 2)}→${fmt(after.loadAvg1m, 2)} · ` +
        `memory used ${after.usedMemoryMb}/${after.totalMemoryMb} MB` +
        (after.serverRssMb ? ` · server RSS ${after.serverRssMb} MB` : '') +
        ` · scheduled loops ${actualLoops}`
    );
    if (fatals.length) console.log(`   worker failures: ${fatals.join('\n')}`);

    report.levels.push({
      users,
      scheduledLoops: actualLoops,
      summary,
      db: dbSamples.length
        ? {
            maxBackends: Math.max(...dbSamples.map((s) => s.backends || 0)),
            avgBackends: fmt(
              dbSamples.reduce((a, s) => a + (s.backends || 0), 0) / dbSamples.length
            ),
            samples: dbSamples.length,
          }
        : null,
      host: { before, after },
      fatals,
    });
    await sleep(2000);
  }

  if (args.writes && args.dbUrl) {
    console.log('');
    await cleanupWrites(args.dbUrl);
  }

  report.finishedAt = new Date().toISOString();
  const out = path.join(args.outDir, `load-${args.runId}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${out}`);
  if (dbPrisma) await dbPrisma.$disconnect();
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
} else {
  runWorker();
}
