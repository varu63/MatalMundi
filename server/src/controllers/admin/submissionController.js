'use strict';

const submissionsRepo = require('../../repositories/submissions');
const lotsRepo = require('../../repositories/lots');
const listingsRepo = require('../../repositories/listings');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { serializeSubmission, serializeLot, serializeListing } = require('../../utils/serializers');
const { recordAudit } = require('../../services/auditService');
const { notifySubmission } = require('../../services/notificationService');
const { storageUploadForListing } = require('./listingHelpers');
const {
  createLotFromSubmission,
  syncLotStatusForListing,
} = require('../../services/inventoryService');
const { parsePage } = require('../../utils/numbers');
const {
  SUBMISSION_STATUS,
  SUBMISSION_TRANSITIONS,
  SALE_MODE,
  AUDIT_ACTION,
} = require('../../utils/constants');

function assertTransition(submission, nextStatus, label) {
  const allowed = SUBMISSION_TRANSITIONS[submission.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(
      `Cannot move submission from ${submission.status} to ${nextStatus} (${label})`
    );
  }
}

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

function appendNote(row, note, actorId) {
  const notes = Array.isArray(row.adminNotes) ? row.adminNotes : [];
  if (!note) return notes;
  return [...notes, { note, by: actorId, at: new Date() }];
}

/** GET /admin/waste-submissions */
const listSubmissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await submissionsRepo.list({
    status: req.query.status,
    categoryId: req.query.category,
    search: req.query.search,
    saleMode: SALE_MODE.NORMAL, // auction submissions are handled in Auction Management
    skip,
    take: limit,
    variant: 'admin',
  });
  return paginated(res, rows.map(serializeSubmission), { page, limit, total });
});

/** GET /admin/waste-submissions/:id */
const getSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id, { variant: 'admin' });
  if (!submission) throw ApiError.notFound('Submission not found');
  return ok(res, { submission: serializeSubmission(submission) });
});

/** PATCH /admin/waste-submissions/:id/review  (under review / schedule pickup / back to queue) */
const reviewSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  const nextStatus = req.body.status;
  const data = {};
  if (nextStatus && nextStatus !== submission.status) {
    assertTransition(submission, nextStatus, 'review');
    data.status = nextStatus;
  }
  if (req.body.note) {
    data.adminNotes = appendNote(submission, req.body.note, req.user.id);
  }
  if (req.body.pickupDate && nextStatus === SUBMISSION_STATUS.PICKUP_SCHEDULED) {
    data.pickupDate = req.body.pickupDate;
  }
  data.reviewedById = req.user.id;
  data.reviewedAt = new Date();
  const updated = await submissionsRepo.updateById(submission.id, data);

  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_REVIEW,
    resourceType: 'WasteSubmission',
    resourceId: submission.id,
    after: { status: updated.status },
    req,
  });

  return ok(
    res,
    { submission: serializeSubmission(updated) },
    `Submission moved to ${updated.status}`
  );
});

/** POST /admin/waste-submissions/:id/approve */
const approveSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.APPROVED, 'approve');

  // Proposed purchase price: admin override (per kg) or the auto-valuation payout.
  let proposedPaise;
  if (req.body.proposedPricePerKg !== undefined && req.body.proposedPricePerKg !== null) {
    proposedPaise = moneyToPaise(req.body.proposedPricePerKg * submission.quantityKg);
  } else {
    proposedPaise = Math.max(
      0,
      (submission.valuation && submission.valuation.estimatedPayoutPaise) || 0
    );
  }

  const updated = await submissionsRepo.updateById(submission.id, {
    proposedPurchasePricePaise: proposedPaise,
    proposedPurchasePriceSetById: req.user.id,
    proposedPurchasePriceSetAt: new Date(),
    status: SUBMISSION_STATUS.APPROVED,
    approvedById: req.user.id,
    approvedAt: new Date(),
    reviewedById: req.user.id,
    reviewedAt: new Date(),
    adminNotes: appendNote(submission, req.body.note, req.user.id),
  });

  await notifySubmission(
    submission.sellerId,
    'Submission approved',
    `Your submission ${submission.submissionNumber} was approved. We will arrange pickup of ${submission.quantityKg} kg of ${submission.materialType}.`,
    submission.id
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_APPROVE,
    resourceType: 'WasteSubmission',
    resourceId: submission.id,
    after: { status: updated.status, proposedPurchasePricePaise: proposedPaise },
    req,
  });

  return ok(res, { submission: serializeSubmission(updated) }, 'Submission approved');
});

/** POST /admin/waste-submissions/:id/reject */
const rejectSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.REJECTED, 'reject');

  const updated = await submissionsRepo.updateById(submission.id, {
    status: SUBMISSION_STATUS.REJECTED,
    rejectionReason: req.body.reason,
    reviewedById: req.user.id,
    reviewedAt: new Date(),
  });

  await notifySubmission(
    submission.sellerId,
    'Submission rejected',
    `Your submission ${submission.submissionNumber} was rejected. Reason: ${req.body.reason}`,
    submission.id
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_REJECT,
    resourceType: 'WasteSubmission',
    resourceId: submission.id,
    after: { status: updated.status, reason: req.body.reason },
    req,
  });

  return ok(res, { submission: serializeSubmission(updated) }, 'Submission rejected');
});

/** POST /admin/waste-submissions/:id/collect */
const collectSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  assertTransition(submission, SUBMISSION_STATUS.COLLECTED, 'collect');

  const acceptedKg = Number(req.body.acceptedQuantityKg);
  if (!(acceptedKg >= 100)) throw ApiError.badRequest('Accepted quantity must be at least 100 kg');

  // Create the inventory lot exactly once.
  let lot = await lotsRepo.findBySourceSubmission(submission.id);
  if (!lot) {
    lot = await createLotFromSubmission({ submission, actor: req.user.id });
  } else if (lot.reservedQuantityKg === 0 && lot.soldQuantityKg === 0) {
    // Refreshing a re-collect (only safe while nothing has been touched).
    lot = await lotsRepo.updateById(lot.id, {
      acceptedQuantityKg: acceptedKg,
      availableQuantityKg: acceptedKg,
    });
  }

  const updated = await submissionsRepo.updateById(submission.id, {
    acceptedQuantityKg: acceptedKg,
    status: SUBMISSION_STATUS.COLLECTED,
    collectedById: req.user.id,
    collectedAt: new Date(),
    adminNotes: appendNote(submission, req.body.note, req.user.id),
  });

  await notifySubmission(
    submission.sellerId,
    'Material collected',
    `Your ${submission.quantityKg} kg of ${submission.materialType} was received. Accepted quantity: ${acceptedKg} kg.`,
    submission.id
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_COLLECT,
    resourceType: 'WasteSubmission',
    resourceId: submission.id,
    after: { status: updated.status, acceptedQuantityKg: acceptedKg, lotId: lot.id },
    req,
  });

  return ok(
    res,
    { submission: serializeSubmission(updated), lot: serializeLot(lot) },
    'Material collected and stocked'
  );
});

/**
 * POST /admin/waste-submissions/:id/publish
 * Explicit, separate step from approval: only collected, verified stock can be
 * listed. Uses the admin's listing images when supplied, else the submission's.
 */
const publishSubmission = asyncHandler(async (req, res) => {
  const submission = await submissionsRepo.findById(req.params.id);
  if (!submission) throw ApiError.notFound('Submission not found');

  if (submission.status !== SUBMISSION_STATUS.COLLECTED) {
    throw ApiError.conflict('Only collected materials can be published to the marketplace');
  }
  const existingListing = await listingsRepo.findBySourceSubmission(submission.id);
  if (existingListing) {
    throw ApiError.conflict(
      'This submission already has a listing. Use listing management to edit it.'
    );
  }

  const lot = await lotsRepo.findBySourceSubmission(submission.id);
  if (!lot) throw ApiError.conflict('No inventory lot exists. Collect the material first.');
  if (lot.availableQuantityKg <= 0) {
    throw ApiError.conflict('This lot has no sellable stock');
  }

  const images = await storageUploadForListing(req, submission);

  const listing = await listingsRepo.create({
    title: req.body.title,
    materialCategoryId: submission.materialCategoryId,
    materialType: submission.materialType,
    description: req.body.description,
    images,
    inventoryLotId: lot.id,
    sourceSubmissionId: submission.id,
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
    publishedById: req.user.id,
    publishedAt: new Date(),
  });

  await syncLotStatusForListing(listing);

  const updated = await submissionsRepo.updateById(submission.id, {
    status: SUBMISSION_STATUS.PURCHASED,
  });
  // Re-fetch with the lot/listing relations so the response carries their ids.
  const fresh = (await submissionsRepo.findById(submission.id)) || updated;

  await notifySubmission(
    submission.sellerId,
    'Listed on marketplace',
    `Your material is now listed on the marketplace as "${listing.title}".`,
    submission.id
  );
  await recordAudit({
    action: AUDIT_ACTION.SUBMISSION_PUBLISH,
    resourceType: 'WasteSubmission',
    resourceId: submission.id,
    after: {
      listingId: listing.id,
      title: listing.title,
      pricePerKgPaise: listing.pricePerKgPaise,
    },
    req,
  });

  return ok(
    res,
    { submission: serializeSubmission(fresh), listing: serializeListing(listing) },
    'Listing published to marketplace'
  );
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
