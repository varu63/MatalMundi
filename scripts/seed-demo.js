'use strict';

/**
 * Demo data generator (development only).
 *
 *   npm run seed:demo
 *
 * Creates a demo user and a fully worked example of the seller→buyer pipeline
 * (a collected & published listing backed by an inventory lot), so the
 * marketplace and storefront can be explored immediately. Uses generated
 * placeholder images stored locally — no external credentials required.
 */

const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
// Dependencies live in server/node_modules, not in the repo root.
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const dotenv = serverRequire('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const env = require('../server/src/config/env');
const { prisma } = require('../server/src/config/db');
const { users, categories, pricing, submissions, lots, listings } = require('../server/src/repositories');
const { ROLES, SUBMISSION_STATUS, LISTING_STATUS } = require('../server/src/utils/constants');
const { computeValuation } = require('../server/src/services/pricingService');

const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'http://localhost:5000';

// 1×1 tiled PNG placeholders so the demo needs no Cloudinary account.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function writePlaceholder(name) {
  const dir = path.resolve(__dirname, '../server/uploads/seed');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, PLACEHOLDER_PNG);
  return { url: `${API_PUBLIC_URL}/uploads/seed/${name}.png`, publicId: `seed/${name}.png`, provider: 'local' };
}

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@metalmundi.test').toLowerCase();
  let admin = await users.findByEmail(email);
  if (!admin) {
    admin = await users.create({
      name: process.env.ADMIN_NAME || 'MetalMundi Admin',
      email,
      phone: '0000000000',
      password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
      role: ROLES.ADMIN,
      accountStatus: 'ACTIVE',
      emailVerificationVerified: true,
    });
  }
  return admin;
}

async function ensureUser() {
  const email = 'demo@metalmundi.test';
  let user = await users.findByEmail(email);
  if (!user) {
    user = await users.create({
      name: 'Ananya Sharma',
      email,
      phone: '9812345678',
      password: 'Demo@1234',
      role: ROLES.USER,
      accountStatus: 'ACTIVE',
      emailVerificationVerified: true,
      address: { line1: 'B-42, Sector 18', city: 'Gurugram', state: 'Haryana', postalCode: '122015' },
    });
  }
  return user;
}

async function seedListing() {
  const category = await categories.findByNameOrSlug('Ferrous Scrap', 'ferrous-scrap');
  if (!category) throw new Error('Run npm run seed:admin first (no Ferrous Scrap category).');

  let listing = await prisma.marketplaceListing.findFirst({ where: { materialType: 'MS Scrap' } });
  if (listing) {
    console.log('✔ Demo listing already exists — skipping.');
    return listing;
  }

  const pricingConfig = await pricing.getActive(category.id);
  if (!pricingConfig) throw new Error('No pricing configured for Ferrous Scrap.');

  const user = await ensureUser();
  const admin = await ensureAdmin();
  const pickup = {
    address: 'B-42, Sector 18',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122015',
    contactName: 'Ananya Sharma',
    contactPhone: '9812345678',
  };

  const quantityKg = 500;
  const valuation = computeValuation({
    pricingConfig,
    quantityKg,
    qualityGrade: 'B',
    pickup,
  });

  const submission = await submissions.create({
    submissionNumber: `WS-${new Date().getFullYear()}-DEMO01`,
    sellerId: user.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    quantityKg,
    condition: 'LOOSE',
    qualityGrade: 'B',
    description: 'Clean mild steel scrap from a recent demolition, free of major rust.',
    images: {
      front: writePlaceholder('front'),
      back: writePlaceholder('back'),
      left: writePlaceholder('left'),
      right: writePlaceholder('right'),
      additional: [],
    },
    pickup,
    demandBasis: 'TOTAL',
    demandedTotalPaise: 900000, // ₹9,000 whole sale
    demandedPerKgPaise: 1800,
    valuation,
    proposedPurchasePricePaise: valuation.estimatedPayoutPaise,
    acceptedQuantityKg: quantityKg,
    status: SUBMISSION_STATUS.COLLECTED,
    reviewedById: admin.id,
    reviewedAt: new Date(),
    approvedById: admin.id,
    approvedAt: new Date(),
  });

  const lot = await lots.create({
    lotNumber: `LOT-${new Date().getFullYear()}-DEMO01`,
    sourceSubmissionId: submission.id,
    sellerId: user.id,
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    qualityGrade: 'B',
    condition: 'LOOSE',
    acceptedQuantityKg: quantityKg,
    availableQuantityKg: quantityKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: 'Gurugram', state: 'Haryana' },
    lotStatus: 'PUBLISHED',
    receivedAt: new Date(),
  });

  await submissions.updateById(submission.id, { status: SUBMISSION_STATUS.PURCHASED });

  listing = await listings.create({
    title: 'Mild Steel Scrap (MS) — 500 kg',
    materialCategoryId: category.id,
    materialType: 'MS Scrap',
    description:
      'Clean mild steel scrap from a recent demolition. Sorted, loose, graded B. Rated at ₹18/kg.',
    images: [
      writePlaceholder('front'),
      writePlaceholder('back'),
      writePlaceholder('left'),
      writePlaceholder('right'),
    ],
    inventoryLotId: lot.id,
    sourceSubmissionId: submission.id,
    qualityGrade: 'B',
    condition: 'LOOSE',
    pricePerKgPaise: 1800,
    minPurchaseKg: 0,
    acceptedQuantityKg: quantityKg,
    availableQuantityKg: quantityKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: 'Gurugram', state: 'Haryana' },
    deliveryTerms: 'Pickup from MetalMundi yard or delivery within Gurugram (provisional quote).',
    publicationStatus: LISTING_STATUS.PUBLISHED,
    active: true,
    publishedAt: new Date(),
  });

  return listing;
}

async function main() {
  console.log('Connecting to PostgreSQL…', env.databaseUrl.replace(/:([^@/]+)@/, ':***@'));
  await prisma.$connect();
  const listing = await seedListing();
  console.log('✔ Demo listing:', listing.title);
  console.log('✔ Demo user: demo@metalmundi.test / Demo@1234');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Demo seed failed:', err.message);
  process.exit(1);
});
