'use strict';

const { MarketplaceListing, InventoryLot } = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { recordAudit } = require('../../services/auditService');
const { syncLotStatusForListing } = require('../../services/inventoryService');
const { parsePage } = require('../../utils/numbers');
const { LISTING_STATUS, AUDIT_ACTION } = require('../../utils/constants');

/**
 * Pausing/unpublishing a listing is NOT allowed while it holds active
 * reservations, otherwise released stock would be invisible to new buyers.
 */
async function guardNoActiveReservations(listing) {
  const lot = await InventoryLot.findById(listing.inventoryLot);
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
  const filter = {};
  if (req.query.status) filter.publicationStatus = req.query.status;
  if (req.query.active === 'true') filter.active = true;
  if (req.query.search) {
    const term = String(req.query.search).trim();
    filter.$or = [{ title: { $regex: term, $options: 'i' } }, { materialType: { $regex: term, $options: 'i' } }];
  }

  const [items, total] = await Promise.all([
    MarketplaceListing.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('materialCategory', 'name')
      .populate('inventoryLot', 'lotNumber lotStatus soldQuantityKg reservedQuantityKg')
      .lean(),
    MarketplaceListing.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

/** GET /admin/listings/:id */
const getListing = asyncHandler(async (req, res) => {
  const listing = await MarketplaceListing.findById(req.params.id)
    .populate('materialCategory', 'name slug')
    .populate('inventoryLot')
    .populate('sourceSubmission', 'submissionNumber');
  if (!listing) throw ApiError.notFound('Listing not found');
  return ok(res, { listing });
});

/** PATCH /admin/listings/:id — edit price, description, quantity, min purchase, terms. */
const updateListing = asyncHandler(async (req, res) => {
  const listing = await MarketplaceListing.findById(req.params.id);
  if (!listing) throw ApiError.notFound('Listing not found');

  const before = {
    title: listing.title,
    pricePerKgPaise: listing.pricePerKgPaise,
    minPurchaseKg: listing.minPurchaseKg,
    active: listing.active,
    publicationStatus: listing.publicationStatus,
  };

  if (req.body.title !== undefined) listing.title = req.body.title;
  if (req.body.description !== undefined) listing.description = req.body.description;
  if (req.body.pricePerKg !== undefined) listing.pricePerKgPaise = moneyToPaise(req.body.pricePerKg);
  if (req.body.minPurchaseKg !== undefined) listing.minPurchaseKg = req.body.minPurchaseKg;
  if (req.body.deliveryTerms !== undefined) listing.deliveryTerms = req.body.deliveryTerms;
  if (req.body.qualityGrade !== undefined) listing.qualityGrade = req.body.qualityGrade;
  if (req.body.condition !== undefined) listing.condition = req.body.condition;

  // Admin override of available quantity (still bounded by the lot's stock).
  if (req.body.availableQuantityKg !== undefined) {
    const lot = await InventoryLot.findById(listing.inventoryLot);
    if (!lot) throw ApiError.conflict('Inventory lot missing');
    const target = Number(req.body.availableQuantityKg);
    const maxAllowed = lot.availableQuantityKg;
    if (target > maxAllowed) {
      throw ApiError.badRequest(`Available quantity cannot exceed lot stock (${maxAllowed} kg)`);
    }
    listing.availableQuantityKg = target;
  }

  await listing.save();
  await recordAudit({
    action: AUDIT_ACTION.LISTING_UPDATE,
    resourceType: 'MarketplaceListing',
    resourceId: listing._id,
    before,
    after: { title: listing.title, pricePerKgPaise: listing.pricePerKgPaise, minPurchaseKg: listing.minPurchaseKg },
    req,
  });

  return ok(res, { listing }, 'Listing updated');
});

/** PATCH /admin/listings/:id/status — publish / pause / unpublish / sold out. */
const updateListingStatus = asyncHandler(async (req, res) => {
  const listing = await MarketplaceListing.findById(req.params.id);
  if (!listing) throw ApiError.notFound('Listing not found');

  const target = req.body.status;
  if (target === listing.publicationStatus && target !== LISTING_STATUS.PUBLISHED) {
    throw ApiError.badRequest(`Listing is already ${target}`);
  }

  if (target === LISTING_STATUS.PAUSED || target === LISTING_STATUS.DRAFT) {
    await guardNoActiveReservations(listing);
  }

  if (target === LISTING_STATUS.PUBLISHED) {
    const lot = await InventoryLot.findById(listing.inventoryLot);
    if (!lot || lot.availableQuantityKg <= 0) {
      throw ApiError.conflict('Cannot publish: this lot has no available stock');
    }
    listing.active = true;
    listing.publishedBy = req.user._id;
    listing.publishedAt = new Date();
    // Sync cache from the authoritative lot before going live.
    listing.availableQuantityKg = lot.availableQuantityKg;
    listing.reservedQuantityKg = lot.reservedQuantityKg;
    listing.soldQuantityKg = lot.soldQuantityKg;
    listing.acceptedQuantityKg = lot.acceptedQuantityKg;
  } else {
    listing.active = false;
  }

  listing.publicationStatus = target;
  await listing.save();
  await syncLotStatusForListing(listing);

  await recordAudit({
    action: AUDIT_ACTION.LISTING_STATUS,
    resourceType: 'MarketplaceListing',
    resourceId: listing._id,
    after: { publicationStatus: target, active: listing.active },
    req,
  });

  return ok(res, { listing }, `Listing is now ${target}`);
});

module.exports = { listListings, getListing, updateListing, updateListingStatus };