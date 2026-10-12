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
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const mongoose = require('mongoose');
const {
  User,
  MaterialCategory,
  PricingConfiguration,
  WasteSubmission,
  InventoryLot,
  MarketplaceListing,
} = require('../server/src/models');
const {
  ROLES,
  SUBMISSION_STATUS,
  LISTING_STATUS,
} = require('../server/src/utils/constants');
const { computeValuation } = require('../server/src/services/pricingService');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/metalmundi';
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
  let admin = await User.findOne({ email });
  if (!admin) {
    admin = new User({
      name: process.env.ADMIN_NAME || 'MetalMundi Admin',
      email,
      phone: '0000000000',
      role: ROLES.ADMIN,
      accountStatus: 'ACTIVE',
      emailVerification: { verified: true },
    });
    await admin.setPassword(process.env.ADMIN_PASSWORD || 'ChangeMe123!');
    await admin.save();
  }
  return admin;
}

async function ensureUser() {
  const email = 'demo@metalmundi.test';
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      name: 'Ananya Sharma',
      email,
      phone: '9812345678',
      role: ROLES.USER,
      accountStatus: 'ACTIVE',
      emailVerification: { verified: true },
      address: { line1: 'B-42, Sector 18', city: 'Gurugram', state: 'Haryana', postalCode: '122015' },
    });
    await user.setPassword('Demo@1234');
    await user.save();
  }
  return user;
}

async function seedListing() {
  const category = await MaterialCategory.findOne({ name: 'Ferrous Scrap' });
  if (!category) throw new Error('Run npm run seed:admin first (no Ferrous Scrap category).');

  let listing = await MarketplaceListing.findOne({ materialType: 'MS Scrap' });
  if (listing) {
    console.log('✔ Demo listing already exists — skipping.');
    return listing;
  }

  const pricing = await PricingConfiguration.findOne({
    materialCategory: category._id,
    active: true,
  }).sort({ version: -1 });
  if (!pricing) throw new Error('No pricing configured for Ferrous Scrap.');

  const user = await ensureUser();
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
    pricingConfig: pricing,
    quantityKg,
    qualityGrade: 'B',
    pickup,
  });

  const submission = await WasteSubmission.create({
    submissionNumber: `WS-${new Date().getFullYear()}-DEMO01`,
    seller: user._id,
    materialCategory: category._id,
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
    reviewedBy: (await ensureAdmin())._id,
    reviewedAt: new Date(),
    approvedBy: (await ensureAdmin())._id,
    approvedAt: new Date(),
  });

  const lot = await InventoryLot.create({
    lotNumber: `LOT-${new Date().getFullYear()}-DEMO01`,
    sourceSubmission: submission._id,
    seller: user._id,
    materialCategory: category._id,
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

  submission.inventoryLot = lot._id;
  submission.status = SUBMISSION_STATUS.PURCHASED;
  await submission.save();

  listing = await MarketplaceListing.create({
    title: 'Mild Steel Scrap (MS) — 500 kg',
    materialCategory: category._id,
    materialType: 'MS Scrap',
    description:
      'Clean mild steel scrap from a recent demolition. Sorted, loose, graded B. Rated at ₹18/kg.',
    images: [
      writePlaceholder('front'),
      writePlaceholder('back'),
      writePlaceholder('left'),
      writePlaceholder('right'),
    ],
    inventoryLot: lot._id,
    sourceSubmission: submission._id,
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
  console.log('Connecting…');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const listing = await seedListing();
  console.log('✔ Demo listing:', listing.title);
  console.log('✔ Demo user: demo@metalmundi.test / Demo@1234');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Demo seed failed:', err.message);
  process.exit(1);
});