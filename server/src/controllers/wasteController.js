'use strict';

const categoriesRepo = require('../repositories/categories');
const submissionsRepo = require('../repositories/submissions');
const auctionsRepo = require('../repositories/auctions');
const auctionSettingsRepo = require('../repositories/auctionSettings');
const { prisma } = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created, paginated } = require('../utils/apiResponse');
const { serializeSubmission, serializeAuction } = require('../utils/serializers');
const { uploadImage, deleteAssets } = require('../services/storageService');
const {
  getActivePricing,
  computeValuation,
  normalizeDemand,
} = require('../services/pricingService');
const { resolveDurationMinutes } = require('../services/auctionService');
const { notifySubmission } = require('../services/notificationService');
const { recordAudit } = require('../services/auditService');
const { generateReference } = require('../utils/idGenerator');
const { parsePage } = require('../utils/numbers');
const {
  SUBMISSION_STATUS,
  AUCTION_STATUS,
  SALE_MODE,
  AUDIT_ACTION,
  DEMAND_BASIS,
  ROLES,
} = require('../utils/constants');

const REQUIRED_SIDES = ['front', 'back', 'left', 'right'];

function fileFor(files, name) {
  return files && files[name] && files[name][0];
}

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

/** POST /waste-submissions  (multipart) */
const createSubmission = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const saleMode = req.body.saleMode || SALE_MODE.NORMAL;
  const isAuction = saleMode === SALE_MODE.AUCTION;

  // 1. All four required side photographs must be present. Auctions also
  //    require a weight-evidence photo.
  const missing = REQUIRED_SIDES.filter((side) => !fileFor(files, side));
  if (isAuction && !fileFor(files, 'weightEvidence')) missing.push('weightEvidence');
  if (missing.length) {
    throw ApiError.badRequest(
      `All four side photographs are required${isAuction ? ' plus weight evidence' : ''}. Missing: ${missing.join(', ')}`,
    );
  }

  // 2. Category must exist and be active (only supported categories allowed).
  const category = await categoriesRepo.findById(req.body.materialCategory);
  if (!category || !category.active) {
    throw ApiError.badRequest('Unsupported or inactive material category');
  }

  // 3. Server derives identity from the session — never from the client.
  const sellerId = req.user.id;

  // 4. Basic duplicate-submission guard (accidental double submit).
  const dupe = await submissionsRepo.findRecentDuplicate({
    sellerId,
    materialType: req.body.materialType,
    quantityKg: req.body.quantityKg,
    since: new Date(Date.now() - 8000),
  });
  if (dupe) {
    throw ApiError.conflict('A similar submission was just created. Please wait a moment.');
  }

  // 4b. Auction eligibility — admin-configured minimum lot size for auctions.
  let auctionSettings = null;
  let auctionDurationMinutes = null;
  if (isAuction) {
    auctionSettings = await auctionSettingsRepo.get();
    if (Number(req.body.quantityKg) < Number(auctionSettings.minAuctionQuantityKg)) {
      throw ApiError.badRequest(
        `Auctions require at least ${auctionSettings.minAuctionQuantityKg} kg (you entered ${req.body.quantityKg} kg). Use a normal sale for smaller lots.`,
      );
    }
    auctionDurationMinutes = resolveDurationMinutes(auctionSettings, req.body.durationMinutes);
  }

  // 5. Pricing must exist for the category/type (it drives auction fees too).
  const pricingConfig = await getActivePricing(category.id, req.body.materialType);
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

    if (isAuction) {
      const evidence = fileFor(files, 'weightEvidence');
      const asset = await uploadImage(evidence.buffer, {
        folder,
        mimetype: evidence.mimetype,
      });
      images.weightEvidence = asset;
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

    // 8. Submission (+ auction row in auction mode) are created atomically —
    //    an AUCTION-mode submission can never exist without its auction.
    const { submission, auction } = await prisma.$transaction(async (tx) => {
      const createdSubmission = await submissionsRepo.create({
        submissionNumber: generateReference('WS'),
        sellerId,
        materialCategoryId: category.id,
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
        saleMode,
      }, tx);

      let createdAuction = null;
      if (isAuction) {
        createdAuction = await auctionsRepo.create({
          auctionNumber: generateReference('AUC'),
          submissionId: createdSubmission.id,
          sellerId,
          materialCategoryId: category.id,
          materialType: req.body.materialType,
          quantityKg: req.body.quantityKg,
          condition: req.body.condition,
          qualityGrade: req.body.qualityGrade,
          images,
          location: {
            address: req.body.pickup.address,
            city: req.body.pickup.city,
            state: req.body.pickup.state,
          },
          inspectionNotes: req.body.inspectionNotes || '',
          startingPricePerKgPaise: moneyToPaise(req.body.startingPricePerKg),
          expectedPricePerKgPaise:
            req.body.expectedPricePerKg != null ? moneyToPaise(req.body.expectedPricePerKg) : 0,
          minAcceptableBidPerKgPaise:
            req.body.minAcceptablePerKg != null ? moneyToPaise(req.body.minAcceptablePerKg) : 0,
          reservePricePerKgPaise:
            req.body.reservePricePerKg != null ? moneyToPaise(req.body.reservePricePerKg) : null,
          minIncrementType: auctionSettings.minIncrementType,
          minIncrementValue: auctionSettings.minIncrementValue,
          antiSnipingEnabled: auctionSettings.antiSnipingEnabled,
          antiSnipingWindowSeconds: auctionSettings.antiSnipingWindowSeconds,
          antiSnipingExtensionSeconds: auctionSettings.antiSnipingExtensionSeconds,
          durationMinutes: auctionDurationMinutes,
          status: AUCTION_STATUS.PENDING_APPROVAL,
        }, tx);
      }

      return { submission: createdSubmission, auction: createdAuction };
    });

    await notifySubmission(
      sellerId,
      isAuction ? 'Auction submission received' : 'Waste submission received',
      isAuction
        ? `Your auction ${auction.auctionNumber} was received. It becomes public once our team approves it.`
        : `Your submission ${submission.submissionNumber} was received and is pending review.`,
      submission.id,
    );
    await recordAudit({
      action: AUDIT_ACTION.SUBMISSION_CREATE,
      resourceType: 'WasteSubmission',
      resourceId: submission.id,
      meta: { saleMode, auctionId: auction ? auction.id : null },
      req,
    });

    return created(
      res,
      {
        submission: serializeSubmission(submission),
        ...(auction ? { auction: serializeAuction(auction, { variant: 'owner' }) } : {}),
      },
      isAuction ? 'Auction submission created — pending approval' : 'Waste submission created',
    );
  } catch (err) {
    // 9. Roll back uploaded assets on any failure.
    await deleteAssets(uploaded);
    throw err;
  }
});

function sanitizeSubmission(serialized, isAdmin) {
  if (!isAdmin) {
    delete serialized.adminNotes;
    delete serialized.proposedPurchasePriceSetBy;
  }
  return serialized;
}

/** GET /waste-submissions/my */
const mySubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await submissionsRepo.list({
    sellerId: req.user.id,
    status: req.query.status,
    skip,
    take: limit,
    variant: 'owner',
  });

  const sanitized = rows.map((s) => sanitizeSubmission(serializeSubmission(s), false));
  return paginated(res, sanitized, { page, limit, total });
});

/** GET /waste-submissions/:id — owner or admin only. */
const getSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id, { variant: 'owner' });
  if (!submission) throw ApiError.notFound('Submission not found');

  const isAdmin = req.user.role === ROLES.ADMIN;
  const isOwner = String(submission.sellerId) === String(req.user.id);
  if (!isAdmin && !isOwner) throw ApiError.forbidden('You cannot view this submission');

  return ok(res, { submission: sanitizeSubmission(serializeSubmission(submission), isAdmin) });
});

/** POST /waste-submissions/estimate — preview valuation, nothing persisted. */
const estimateValuation = asyncHandler(async (req, res) => {
  const category = await categoriesRepo.findById(req.body.materialCategory);
  if (!category || !category.active) throw ApiError.badRequest('Unsupported material category');

  const pricingConfig = await getActivePricing(category.id, req.body.materialType);
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
