'use strict';

const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.env.NODE_ENV = 'test';
process.env.DISABLE_CSRF = 'true';

// ── Dedicated test database ─────────────────────────────────────────────────
// The development database is never touched: tests always run against
// `metalmundi_test`, created lazily if missing. No DROP/TRUNCATE ever runs —
// rows are deleted with plain DELETEs between tests.
const BASE_URL =
  process.env.DATABASE_URL || 'postgresql://admin:adminpassword@localhost:5432/metalmundi';
const TEST_DB = 'metalmundi_test';

function urlWithDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

// Must be set BEFORE ../src is required — the Prisma client reads it on load.
process.env.DATABASE_URL = urlWithDatabase(BASE_URL, TEST_DB);

const { PrismaClient } = require('@prisma/client');

async function ensureTestDatabase() {
  const admin = new PrismaClient({ datasourceUrl: urlWithDatabase(BASE_URL, 'postgres') });
  try {
    const rows = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

beforeAll(async () => {
  await ensureTestDatabase();
  try {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: 'pipe',
    });
  } catch (err) {
    console.error(String(err.stderr || err.stdout || err.message));
    throw err;
  }
}, 120000);

const { prisma } = require('../src/config/db');

afterAll(async () => {
  await prisma.$disconnect();
});

// Children first, parents last (FK-safe). Plain DELETEs on the test DB only.
const DELETE_ORDER = [
  'wasteAuctionBid',
  'notification',
  'auditLog',
  'inventoryMovement',
  'order',
  'wasteAuction',
  'marketplaceListing',
  'inventoryLot',
  'wasteSubmission',
  'auctionSettings',
  'pricingConfiguration',
  'materialCategory',
  'user',
];

beforeEach(async () => {
  for (const model of DELETE_ORDER) {
    await prisma[model].deleteMany();
  }
});
