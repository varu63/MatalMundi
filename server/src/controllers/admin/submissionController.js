'use strict';

const {
  WasteSubmission,
  InventoryLot,
  MarketplaceListing,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { recordAudit } = require('../../services/auditService');
const { notifySubmission } = require('../../services/notificationService');
const { storageUploadForListing } = require('./listingHelpers');
const { createLotFromSubmission, syncLotStatusForListing } = require('../../services/inventoryService');
const { parsePage } = require('../../utils/numbers');
const {
  SUBMISSION_STATUS,
  SUBMISSION_TRANSITIONS,
  AUDIT_ACTION,
} = require('../../utils/constants');

function fullPopulate() {
  return [
    { path: 'seller', select: 'name email phone address' },
    { path: 'materialCategory', select: 'name slug' },
    { path: 'inventoryLot', select: 'lotNumber acceptedQuantityKg availableQuantityKg reservedQuantityKg soldQuantityKg lotStatus' },
    { path: 'listing', select: 'title pricePerKgPaise publicationStatus active availableQuantityKg' },
  ];
}

function assertTransition(submission, nextStatus, label) {
  const allowed = SUBMISSION_TRANSITIONS[submission.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(
      `Cannot move submission from ${submission.status} to ${nextStatus} (${label})`,
    );
  }
}

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

/** GET /admin/waste-submissions */
const listSubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.materialCategory = req.query.category;
  if (req.query.search) {
    const term = String(req.query.search).trim();
    filter.$or = [
      { submissionNumber: { $regex: term, $options: 'i' } },
      { materialType: { $regex: term, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    WasteSubmission.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('seller', 'name email')
      .populate('materialCategory', 'name')
      .lean(),
    WasteSubmission.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

/** GET /admin/waste-submissions/:id */
const getSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id).populate(fullPopulate());
  if (!submission) throw ApiError.notFound('Submission not found');
  return ok(res, { submission });
});

/** PATCH /admin/waste-submissions/:id/review  (under review / schedule pickup / back to queue) */
const reviewSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  const nextStatus = req.body.status;
  if (nextStatus && nextStatus !== submission.status) {
    assertTransition(submission, nextStatus, 'review');
    submission.status = nextStatus;
  }
  if (req.body.note) {
    submission.adminNotes.push({ note: req.body.note, by: req.user._id, at: new Date() });
  }
  if (req.body.pickupDate && nextStatus === SUBMISSION_STATUS.PICKUP_SCHEDULED) {
    submission.pickupDate = req.body.pickupDate;
  }
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  await submission.save();

  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_REVIEW,
    resourceType: 'WasteSubmission',
    resourceId: submission._id,
    after: { status: submission.status },
    req,
  });

  return ok(res, { submission }, `Submission moved to ${submission.status}`);
});

/** POST /admin/waste-submissions/:id/approve */
const approveSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.APPROVED, 'approve');

  // Proposed purchase price: admin override (per kg) or the auto-valuation payout.
  let proposedPaise;
  if (req.body.proposedPricePerKg !== undefined && req.body.proposedPricePerKg !== null) {
    proposedPaise = moneyToPaise(req.body.proposedPricePerKg * submission.quantityKg);
  } else {
    proposedPaise = Math.max(0, submission.valuation.estimatedPayoutPaise || 0);
  }
  submission.proposedPurchasePricePaise = proposedPaise;
  submission.proposedPurchasePriceSetBy = req.user._id;
  submission.proposedPurchasePriceSetAt = new Date();
  submission.status = SUBMISSION_STATUS.APPROVED;
  submission.approvedBy = req.user._id;
  submission.approvedAt = new Date();
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  if (req.body.note) {
    submission.adminNotes.push({ note: req.body.note, by: req.user._id, at: new Date() });
  }
  await submission.save();

  await notifySubmission(
    submission.seller,
    'Submission approved',
    `Your submission ${submission.submissionNumber} was approved. We will arrange pickup of ${submission.quantityKg} kg of ${submission.materialType}.`,
    submission._id,
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_APPROVE,
    resourceType: 'WasteSubmission',
    resourceId: submission._id,
    after: { status: submission.status, proposedPurchasePricePaise: proposedPaise },
    req,
  });

  return ok(res, { submission }, 'Submission approved');
});

/** POST /admin/waste-submissions/:id/reject */
const rejectSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.REJECTED, 'reject');

  submission.status = SUBMISSION_STATUS.REJECTED;
  submission.rejectionReason = req.body.reason;
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  await submission.save();

  await notifySubmission(
    submission.seller,
    'Submission rejected',
    `Your submission ${submission.submissionNumber} was rejected. Reason: ${req.body.reason}`,
    submission._id,
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_REJECT,
    resourceType: 'WasteSubmission',
    resourceId: submission._id,
    after: { status: submission.status, reason: req.body.reason },
    req,
  });

  return ok(res, { submission }, 'Submission rejected');
});

/** POST /admin/waste-submissions/:id/collect */
const collectSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.COLLECTED, 'collect');

  const acceptedKg = Number(req.body.acceptedQuantityKg);
  if (!(acceptedKg >= 100)) throw ApiError.badRequest('Accepted quantity must be at least 100 kg');

  submission.acceptedQuantityKg = acceptedKg;
  submission.status = SUBMISSION_STATUS.COLLECTED;
  submission.collectedBy = req.user._id;
  submission.collectedAt = new Date();
  if (req.body.note) {
    submission.adminNotes.push({ note: req.body.note, by: req.user._id, at: new Date() });
  }

  // Create the inventory lot exactly once.
  let lot = null;
  if (submission.inventoryLot) {
    lot = await InventoryLot.findById(submission.inventoryLot);
  }
  if (!lot) {
    lot = await createLotFromSubmission({ submission, actor: req.user._id });
    submission.inventoryLot = lot._id;
  } else {
    // Refreshing a re-collect (only safe while nothing has been touched).
    if (lot.reservedQuantityKg === 0 && lot.soldQuantityKg === 0) {
      lot.acceptedQuantityKg = acceptedKg;
      lot.availableQuantityKg = acceptedKg;
      await lot.save();
    }
  }
  await submission.save();

  await notifySubmission(
    submission.seller,
    'Material collected',
    `Your ${submission.quantityKg} kg of ${submission.materialType} was received. Accepted quantity: ${acceptedKg} kg.`,
    submission._id,
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_COLLECT,
    resourceType: 'WasteSubmission',
    resourceId: submission._id,
    after: { status: submission.status, acceptedQuantityKg: acceptedKg, lotId: lot._id },
    req,
  });

  return ok(res, { submission, lot }, 'Material collected and stocked');
});

/**
 * POST /admin/waste-submissions/:id/publish
 * Explicit, separate step from approval: only collected, verified stock can be
 * listed. Uses the admin's listing images when supplied, else the submission's.
 */
const publishSubmission = asyncHandler(async (req, res) => {
  const submission = await WasteSubmission.findById(req.params.id).populate('materialCategory');
  if (!submission) throw ApiError.notFound('Submission not found');

  if (submission.status !== SUBMISSION_STATUS.COLLECTED) {
    throw ApiError.conflict('Only collected materials can be published to the marketplace');
  }
  if (submission.listing) {
    throw ApiError.conflict('This submission already has a listing. Use listing management to edit it.');
  }
  if (!submission.inventoryLot) {
    throw ApiError.conflict('No inventory lot exists. Collect the material first.');
  }

  const lot = await InventoryLot.findById(submission.inventoryLot);
  if (!lot) throw ApiError.conflict('Inventory lot not found');
  if (lot.availableQuantityKg <= 0) {
    throw ApiError.conflict('This lot has no sellable stock');
  }

  const images = await storageUploadForListing(req, submission);

  const listing = await MarketplaceListing.create({
    title: req.body.title,
    materialCategory: submission.materialCategory,
    materialType: submission.materialType,
    description: req.body.description,
    images,
    inventoryLot: lot._id,
    sourceSubmission: submission._id,
    qualityGrade: req.body.qualityGrade || submission.qualityGrade,
    condition: req.body.condition || submission.condition,
    pricePerKgPaise: moneyToPaise(req.body.pricePerKg),
    minPurchaseKg: req.body.minPurchaseKg || 0,
    acceptedQuantityKg: lot.acceptedQuantityKg,
    availableQuantityKg: lot.availableQuantityKg,
    reservedQuantityKg: lot.reservedQuantityKg,
    soldQuantityKg: lot.soldQuantityKg,
    location: lot.location || {},
    deliveryTerms: req.body.deliveryTerms || 'Pickup from MetalMundi facility',
    publicationStatus: 'PUBLISHED',
    active: true,
    publishedBy: req.user._id,
    publishedAt: new Date(),
  });

  await syncLotStatusForListing(listing);

  submission.listing = listing._id;
  submission.status = SUBMISSION_STATUS.PURCHASED;
  await submission.save();

  await notifySubmission(
    submission.seller,
    'Listed on marketplace',
    `Your material is now listed on the marketplace as "${listing.title}".`,
    submission._id,
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_PUBLISH,
    resourceType: 'WasteSubmission',
    resourceId: submission._id,
    after: { listingId: listing._id, title: listing.title, pricePerKgPaise: listing.pricePerKgPaise },
    req,
  });

  return ok(res, { submission, listing }, 'Listing published to marketplace');
});

module.exports = {
  listSubmissions,
  getSubmission,
  reviewSubmission,
  approveSubmission,
  rejectSubmission,
  collectSubmission,
  publishSubmission,
};