'use strict';

const {
  users,
  categories,
  pricing,
  submissions,
  lots,
  listings,
  movements,
  orders,
} = require('../src/repositories');

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createUser(overrides = {}, role = 'USER') {
  return users.create({
    name: 'Test User',
    email: `user-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.dev`,
    phone: '9876543210',
    password: 'Password123',
    role,
    accountStatus: 'ACTIVE',
    emailVerificationVerified: true,
    ...overrides,
  });
}

async function createAdmin(overrides = {}) {
  return createUser({ email: `admin-${Date.now()}@test.dev`, ...overrides }, 'ADMIN');
}

async function createCategory(name = 'Ferrous Scrap') {
  return categories.create({
    name: `${name} ${Date.now()}`,
    description: 'test category',
    icon: 'recycle',
    active: true,
  });
}

async function createPricing(category, overrides = {}) {
  return pricing.create({
    materialCategoryId: category.id,
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

async function attachImages(req, { weightEvidence = false } = {}) {
  for (const side of ['front', 'back', 'left', 'right']) {
    // Chain attach calls synchronously; awaiting each intermediates breaks
    // superagent's multipart body build.
    // eslint-disable-next-line no-await-in-loop
    req = req.attach(side, MINI_PNG, `${side}.png`);
  }
  if (weightEvidence) {
    req = req.attach('weightEvidence', MINI_PNG, 'weightEvidence.png');
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
  const data = { ...VALID_SUBMISSION, materialCategory: category.id, ...overrides };

  let req = request(app).post('/api/v1/waste-submissions').set('Cookie', cookie);
  for (const [k, v] of Object.entries(data)) {
    if (k === 'pickup') {
      req = req.field('pickup', JSON.stringify(v));
    } else if (k === 'images') {
      req = req.field('images', v);
    } else if (v === null || v === undefined) {
      // skip
    } else if (typeof v === 'object') {
      req = req.field(k, JSON.stringify(v));
    } else {
      req = req.field(k, String(v));
    }
  }
  req = await attachImages(req, { weightEvidence: data.saleMode === 'AUCTION' });
  return req;
}

/**
 * Runs the admin pipeline for a submission up to "collected" and returns
 * { submission, lot, listing(if published) }.
 */
async function pipelineToCollected(submission, admin) {
  const submissionId = submission.id || submission._id;

  await submissions.updateById(submissionId, {
    status: 'APPROVED',
    approvedById: admin.id || admin._id,
    approvedAt: new Date(),
    proposedPurchasePricePaise: Math.max(0, submission.valuation?.estimatedPayoutPaise || 0),
  });

  const lot = await lots.create({
    lotNumber: `LOT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sourceSubmissionId: submissionId,
    sellerId: submission.sellerId || submission.seller?._id || submission.seller,
    materialCategoryId:
      submission.materialCategoryId || submission.materialCategory?._id || submission.materialCategory,
    materialType: submission.materialType,
    qualityGrade: submission.qualityGrade,
    condition: submission.condition,
    acceptedQuantityKg: submission.quantityKg,
    availableQuantityKg: submission.quantityKg,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: submission.pickup?.city, state: submission.pickup?.state },
    lotStatus: 'ACCEPTED',
  });

  await submissions.updateById(submissionId, {
    status: 'COLLECTED',
    acceptedQuantityKg: submission.quantityKg,
    collectedAt: new Date(),
  });

  return { submission, lot };
}

async function createPublishedListing({ submission, lot, agent, admin, overrides = {} }) {
  const submissionId = submission.id || submission._id;
  const res = await agent
    .post(`/api/v1/admin/waste-submissions/${submissionId}/publish`)
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
  users,
  categories,
  pricing,
  submissions,
  lots,
  listings,
  movements,
  orders,
};
