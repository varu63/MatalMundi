'use strict';

const { WasteSubmission, MaterialCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created, paginated } = require('../utils/apiResponse');
const { uploadImage, deleteAssets } = require('../services/storageService');
const {
  getActivePricing,
  computeValuation,
  normalizeDemand,
} = require('../services/pricingService');
const { notifySubmission } = require('../services/notificationService');
const { recordAudit } = require('../services/auditService');
const { generateReference } = require('../utils/idGenerator');
const { parsePage } = require('../utils/numbers');
const {
  SUBMISSION_STATUS,
  AUDIT_ACTION,
  DEMAND_BASIS,
  ROLES,
} = require('../utils/constants');

const REQUIRED_SIDES = ['front', 'back', 'left', 'right'];

function fileFor(files, name) {
  return files && files[name] && files[name][0];
}

/** POST /waste-submissions  (multipart) */
const createSubmission = asyncHandler(async (req, res) => {
  const files = req.files || {};

  // 1. All four required side photographs must be present.
  const missing = REQUIRED_SIDES.filter((side) => !fileFor(files, side));
  if (missing.length) {
    throw ApiError.badRequest(
      `All four side photographs are required. Missing: ${missing.join(', ')}`,
    );
  }

  // 2. Category must exist and be active (only supported categories allowed).
  const category = await MaterialCategory.findById(req.body.materialCategory);
  if (!category || !category.active) {
    throw ApiError.badRequest('Unsupported or inactive material category');
  }

  // 3. Server derives identity from the session — never from the client.
  const sellerId = req.user._id;

  // 4. Basic duplicate-submission guard (accidental double submit).
  const dupe = await WasteSubmission.findOne({
    seller: sellerId,
    materialType: req.body.materialType,
    quantityKg: req.body.quantityKg,
    createdAt: { $gte: new Date(Date.now() - 8000) },
  }).lean();
  if (dupe) {
    throw ApiError.conflict('A similar submission was just created. Please wait a moment.');
  }

  // 5. Pricing must exist for the category/type.
  const pricingConfig = await getActivePricing(category._id, req.body.materialType);
  if (!pricingConfig) {
    throw ApiError.badRequest('No pricing is configured for this material yet');
  }

  // 6. Upload images. If anything fails, delete what we uploaded (no orphaned
  //    or incomplete submissions).
  const uploaded = [];
  try {
    const folder = `waste/${category.slug}`;
    const images = {};
    for (const side of REQUIRED_SIDES) {
      // eslint-disable-next-line no-await-in-loop
      const asset = await uploadImage(fileFor(files, side).buffer, {
        folder,
        mimetype: fileFor(files, side).mimetype,
      });
      images[side] = asset;
      uploaded.push(asset);
    }

    const additional = [];
    for (const file of files.additional || []) {
      // eslint-disable-next-line no-await-in-loop
      const asset = await uploadImage(file.buffer, { folder, mimetype: file.mimetype });
      additional.push(asset);
      uploaded.push(asset);
    }
    images.additional = additional;

    // 7. Server-authoritative valuation snapshot.
    const valuation = computeValuation({
      pricingConfig,
      quantityKg: req.body.quantityKg,
      qualityGrade: req.body.qualityGrade,
      pickup: req.body.pickup,
    });

    const demand = normalizeDemand({
      demandBasis: req.body.demandBasis,
      demandedTotalPaise: req.body.demandBasis === DEMAND_BASIS.TOTAL
        ? Math.round(req.body.demandedPrice * 100)
        : 0,
      demandedPerKgPaise: req.body.demandBasis === DEMAND_BASIS.PER_KG
        ? Math.round(req.body.demandedPrice * 100)
        : 0,
      quantityKg: req.body.quantityKg,
    });

    const submission = await WasteSubmission.create({
      submissionNumber: generateReference('WS'),
      seller: sellerId,
      materialCategory: category._id,
      materialType: req.body.materialType,
      quantityKg: req.body.quantityKg,
      condition: req.body.condition,
      qualityGrade: req.body.qualityGrade,
      description: req.body.description,
      images,
      pickup: req.body.pickup,
      demandBasis: req.body.demandBasis,
      demandedTotalPaise: demand.demandedTotalPaise,
      demandedPerKgPaise: demand.demandedPerKgPaise,
      valuation,
      status: SUBMISSION_STATUS.PENDING_APPROVAL,
    });

    await notifySubmission(
      sellerId,
      'Waste submission received',
      `Your submission ${submission.submissionNumber} was received and is pending review.`,
      submission._id,
    );
    await recordAudit({
      action: AUDIT_ACTION.SUBMISSION_CREATE,
      resourceType: 'WasteSubmission',
      resourceId: submission._id,
      req,
    });

    return created(res, { submission: submission.toJSON() }, 'Waste submission created');
  } catch (err) {
    // 8. Roll back uploaded assets on any failure.
    await deleteAssets(uploaded);
    throw err;
  }
});

function sanitizeSubmission(submission, isAdmin) {
  const obj = submission.toJSON ? submission.toJSON() : submission;
  if (!isAdmin) {
    delete obj.adminNotes;
    delete obj.proposedPurchasePriceSetBy;
  }
  return obj;
}

/** GET /waste-submissions/my */
const mySubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = { seller: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    WasteSubmission.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('materialCategory', 'name slug')
      .lean(),
    WasteSubmission.countDocuments(filter),
  ]);

  const sanitized = items.map((s) => {
    delete s.adminNotes;
    return s;
  });
  return paginated(res, sanitized, { page, limit, total });
});

/** GET /waste-submissions/:id — owner or admin only. */
const getSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id)
    .populate('materialCategory', 'name slug')
    .populate('seller', 'name email phone')
    .populate('inventoryLot', 'lotNumber availableQuantityKg acceptedQuantityKg lotStatus')
    .populate('listing', 'title pricePerKgPaise publicationStatus active availableQuantityKg');
  if (!submission) throw ApiError.notFound('Submission not found');

  const isAdmin = req.user.role === ROLES.ADMIN;
  const isOwner = String(submission.seller._id || submission.seller) === String(req.user._id);
  if (!isAdmin && !isOwner) throw ApiError.forbidden('You cannot view this submission');

  return ok(res, { submission: sanitizeSubmission(submission, isAdmin) });
});

/** POST /waste-submissions/estimate — preview valuation, nothing persisted. */
const estimateValuation = asyncHandler(async (req, res) => {
  const category = await MaterialCategory.findById(req.body.materialCategory);
  if (!category || !category.active) throw ApiError.badRequest('Unsupported material category');

  const pricingConfig = await getActivePricing(category._id, req.body.materialType);
  if (!pricingConfig) {
    throw ApiError.badRequest('No pricing is configured for this material yet');
  }

  const valuation = computeValuation({
    pricingConfig,
    quantityKg: req.body.quantityKg,
    qualityGrade: req.body.qualityGrade,
    pickup: req.body.pickup,
  });

  return ok(res, { valuation, isProvisional: true });
});

module.exports = { createSubmission, mySubmissions, getSubmission, estimateValuation };
