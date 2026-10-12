'use strict';

const {
  User,
  MaterialCategory,
  PricingConfiguration,
  WasteSubmission,
  InventoryLot,
  MarketplaceListing,
  Order,
  InventoryMovement,
} = require('../src/models');

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createUser(overrides = {}, role = 'USER') {
  const user = new User({
    name: 'Test User',
    email: `user-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.dev`,
    phone: '9876543210',
    role,
    accountStatus: 'ACTIVE',
    emailVerification: { verified: true },
    ...overrides,
  });
  await user.setPassword('Password123');
  await user.save();
  return user;
}

async function createAdmin(overrides = {}) {
  return createUser({ email: `admin-${Date.now()}@test.dev`, ...overrides }, 'ADMIN');
}

async function createCategory(name = 'Ferrous Scrap') {
  return MaterialCategory.create({
    name: `${name} ${Date.now()}`,
    slug: `ferrous-${Date.now()}`,
    description: 'test category',
    icon: 'recycle',
    active: true,
  });
}

async function createPricing(category, overrides = {}) {
  return PricingConfiguration.create({
    materialCategory: category._id,
    materialType: 'MS Scrap',
    ratePerKgPaise: 1800, // ₹18/kg
    qualityMultipliers: { A: 1.1, B: 1.0, C: 0.9, D: 0.75 },
    basePickupChargePaise: 50000,
    perKmChargePaise: 1200,
    platformFeePercent: 5,
    taxPercent: 18,
    version: 1,
    active: true,
    ...overrides,
  });
}

const VALID_SUBMISSION = {
  materialCategory: null, // set by caller
  materialType: 'MS Scrap',
  quantityKg: 100,
  condition: 'LOOSE',
  qualityGrade: 'B',
  description: 'Clean mild steel scrap, sorted, free of paint and rust.',
  pickup: {
    address: '12 Industrial Estate',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411019',
    contactName: 'Rohit Gupta',
    contactPhone: '9876543210',
  },
  demandBasis: 'TOTAL',
  demandedPrice: 2000,
  comments: 'Pickup after 5pm preferred',
};

async function attachImages(req) {
  for (const side of ['front', 'back', 'left', 'right']) {
    // Chain attach calls synchronously; awaiting each intermediates breaks
    // superagent's multipart body build.
    // eslint-disable-next-line no-await-in-loop
    req = req.attach(side, MINI_PNG, `${side}.png`);
  }
  return req;
}

async function submitWaste(cookieOrAgent, overrides = {}) {
  const request = require('supertest');
  const app = require('../src/app');

  // Support the options-bag shorthand: submitWaste({ cookie, quantityKg, ... })
  if (
    cookieOrAgent &&
    typeof cookieOrAgent === 'object' &&
    (cookieOrAgent.cookie !== undefined || cookieOrAgent.cookieString !== undefined)
  ) {
    const { cookieString, cookie, ...extras } = cookieOrAgent;
    overrides = { ...overrides, ...extras };
    cookieOrAgent = cookieString || cookie || '';
  }

  const isCookieString = typeof cookieOrAgent === 'string';
  const cookie = isCookieString
    ? cookieOrAgent
    : (cookieOrAgent && (cookieOrAgent.cookieString || cookieOrAgent.cookie)) || '';

  const category = await createCategory();
  await createPricing(category);
  const data = { ...VALID_SUBMISSION, materialCategory: category._id, ...overrides };

  let req = request(app).post('/api/v1/waste-submissions').set('Cookie', cookie);
  for (const [k, v] of Object.entries(data)) {
    if (k === 'pickup') {
      req = req.field('pickup', JSON.stringify(v));
    } else if (k === 'images') {
      req = req.field('images', v);
    } else if (v === null || v === undefined) {
      // skip
    } else if (typeof v === 'object') {
      req = req.field(k, typeof v.toHexString === 'function' ? String(v) : JSON.stringify(v));
    } else {
      req = req.field(k, String(v));
    }
  }
  req = await attachImages(req);
  return req;
}

/**
 * Runs the admin pipeline for a submission up to "collected" and returns
 * { submission, lot, listing(if published) }.
 */
async function pipelineToCollected(submission, admin) {
  submission.status = 'APPROVED';
  submission.approvedBy = admin._id;
  submission.approvedAt = new Date();
  submission.proposedPurchasePricePaise = Math.max(0, submission.valuation.estimatedPayoutPaise);
  await submission.save();

  const lot = await InventoryLot.create({
    lotNumber: `LOT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sourceSubmission: submission._id,
    seller: submission.seller,
    materialCategory: submission.materialCategory,
    materialType: submission.materialType,
    qualityGrade: submission.qualityGrade,
    condition: submission.condition,
    acceptedQuantityKg: submission.quantityKg,
    availableQuantityKg: submission.quantityKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: submission.pickup.city, state: submission.pickup.state },
    lotStatus: 'ACCEPTED',
  });

  submission.inventoryLot = lot._id;
  submission.status = 'COLLECTED';
  submission.acceptedQuantityKg = submission.quantityKg;
  submission.collectedAt = new Date();
  await submission.save();

  return { submission, lot };
}

async function createPublishedListing({ submission, lot, agent, admin, overrides = {} }) {
  const res = await agent
    .post(`/api/v1/admin/waste-submissions/${submission._id}/publish`)
    .field('title', overrides.title || 'Mild Steel Scrap 100 kg')
    .field('description', overrides.description || 'Sorted, loose mild steel scrap.')
    .field('pricePerKg', overrides.pricePerKg || 25)
    .field('minPurchaseKg', overrides.minPurchaseKg || 0)
    .field('deliveryTerms', 'Pickup from factory');
  return res;
}

module.exports = {
  MINI_PNG,
  createUser,
  createAdmin,
  createCategory,
  createPricing,
  VALID_SUBMISSION,
  attachImages,
  submitWaste,
  pipelineToCollected,
  createPublishedListing,
  User,
  MaterialCategory,
  PricingConfiguration,
  WasteSubmission,
  InventoryLot,
  MarketplaceListing,
  Order,
  InventoryMovement,
};