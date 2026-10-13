'use strict';

const listingsRepo = require('../../repositories/listings');
const lotsRepo = require('../../repositories/lots');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { serializeListing } = require('../../utils/serializers');
const { recordAudit } = require('../../services/auditService');
const { syncLotStatusForListing } = require('../../services/inventoryService');
const { parsePage } = require('../../utils/numbers');
const { LISTING_STATUS, AUDIT_ACTION } = require('../../utils/constants');

/**
 * Pausing/unpublishing a listing is NOT allowed while it holds active
 * reservations, otherwise released stock would be invisible to new buyers.
 */
async function guardNoActiveReservations(listing) {
  const lot = await lotsRepo.findById(listing.inventoryLotId);
  if (lot && lot.reservedQuantityKg > 0) {
    throw ApiError.conflict(
      `Cannot change status while ${lot.reservedQuantityKg} kg is reserved by active orders`,
    );
  }
  return lot;
}

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

/** GET /admin/listings */
const listListings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await listingsRepo.list({
    publicationStatus: req.query.status,
    active: req.query.active === 'true' ? true : undefined,
    search: req.query.search,
    skip,
    take: limit,
  });
  return paginated(res, rows.map(serializeListing), { page, limit, total });
});

/** GET /admin/listings/:id */
const getListing = asyncHandler(async (req, res) => {
  const listing = await listingsRepo.findById(req.params.id, { detail: true });
  if (!listing) throw ApiError.notFound('Listing not found');
  return ok(res, { listing: serializeListing(listing) });
});

/** PATCH /admin/listings/:id — edit price, description, quantity, min purchase, terms. */
const updateListing = asyncHandler(async (req, res) => {
  const listing = await listingsRepo.findById(req.params.id);
  if (!listing) throw ApiError.notFound('Listing not found');

  const before = {
    title: listing.title,
    pricePerKgPaise: listing.pricePerKgPaise,
    minPurchaseKg: listing.minPurchaseKg,
    active: listing.active,
    publicationStatus: listing.publicationStatus,
  };

  const data = {};
  if (req.body.title !== undefined) data.title = req.body.title;
  if (req.body.description !== undefined) data.description = req.body.description;
  if (req.body.pricePerKg !== undefined) data.pricePerKgPaise = moneyToPaise(req.body.pricePerKg);
  if (req.body.minPurchaseKg !== undefined) data.minPurchaseKg = req.body.minPurchaseKg;
  if (req.body.deliveryTerms !== undefined) data.deliveryTerms = req.body.deliveryTerms;
  if (req.body.qualityGrade !== undefined) data.qualityGrade = req.body.qualityGrade;
  if (req.body.condition !== undefined) data.condition = req.body.condition;

  // Admin override of available quantity (still bounded by the lot's stock).
  if (req.body.availableQuantityKg !== undefined) {
    const lot = await lotsRepo.findById(listing.inventoryLotId);
    if (!lot) throw ApiError.conflict('Inventory lot missing');
    const target = Number(req.body.availableQuantityKg);
    const maxAllowed = lot.availableQuantityKg;
    if (target > maxAllowed) {
      throw ApiError.badRequest(`Available quantity cannot exceed lot stock (${maxAllowed} kg)`);
    }
    data.availableQuantityKg = target;
  }

  const updated = await listingsRepo.updateById(listing.id, data);
  await recordAudit({
    action: AUDIT_ACTION.LISTING_UPDATE,
    resourceType: 'MarketplaceListing',
    resourceId: listing.id,
    before,
    after: { title: updated.title, pricePerKgPaise: updated.pricePerKgPaise, minPurchaseKg: updated.minPurchaseKg },
    req,
  });

  return ok(res, { listing: serializeListing(updated) }, 'Listing updated');
});

/** PATCH /admin/listings/:id/status — publish / pause / unpublish / sold out. */
const updateListingStatus = asyncHandler(async (req, res) => {
  const listing = await listingsRepo.findById(req.params.id);
  if (!listing) throw ApiError.notFound('Listing not found');

  const target = req.body.status;
  if (target === listing.publicationStatus && target !== LISTING_STATUS.PUBLISHED) {
    throw ApiError.badRequest(`Listing is already ${target}`);
  }

  const data = { publicationStatus: target };

  if (target === LISTING_STATUS.PAUSED || target === LISTING_STATUS.DRAFT) {
    await guardNoActiveReservations(listing);
  }

  if (target === LISTING_STATUS.PUBLISHED) {
    const lot = await lotsRepo.findById(listing.inventoryLotId);
    if (!lot || lot.availableQuantityKg <= 0) {
      throw ApiError.conflict('Cannot publish: this lot has no available stock');
    }
    data.active = true;
    data.publishedById = req.user.id;
    data.publishedAt = new Date();
    // Sync cache from the authoritative lot before going live.
    data.availableQuantityKg = lot.availableQuantityKg;
    data.reservedQuantityKg = lot.reservedQuantityKg;
    data.soldQuantityKg = lot.soldQuantityKg;
    data.acceptedQuantityKg = lot.acceptedQuantityKg;
  } else {
    data.active = false;
  }

  const updated = await listingsRepo.updateById(listing.id, data);
  await syncLotStatusForListing(updated);

  await recordAudit({
    action: AUDIT_ACTION.LISTING_STATUS,
    resourceType: 'MarketplaceListing',
    resourceId: listing.id,
    after: { publicationStatus: target, active: updated.active },
    req,
  });

  return ok(res, { listing: serializeListing(updated) }, `Listing is now ${target}`);
});

module.exports = { listListings, getListing, updateListing, updateListingStatus };
