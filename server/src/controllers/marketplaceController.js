'use strict';

const { MarketplaceListing } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, paginated } = require('../utils/apiResponse');
const { parsePage } = require('../utils/numbers');
const { LISTING_STATUS } = require('../utils/constants');

// Only these listings are ever visible publicly.
function publicVisibilityFilter() {
  return {
    active: true,
    publicationStatus: LISTING_STATUS.PUBLISHED,
    availableQuantityKg: { $gt: 0 },
  };
}

const PUBLIC_FIELDS = [
  'title', 'materialType', 'qualityGrade', 'condition', 'description', 'images',
  'pricePerKgPaise', 'minPurchaseKg', 'acceptedQuantityKg', 'availableQuantityKg',
  'location', 'deliveryTerms', 'publicationStatus', 'createdAt', 'updatedAt',
].join(' ');

/** GET /marketplace — public catalogue with search, filter, sort, pagination. */
const listListings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = publicVisibilityFilter();

  if (req.query.category) filter.materialCategory = req.query.category;
  if (req.query.materialType) filter.materialType = req.query.materialType;

  // Price filters are given in whole rupees by the UI.
  if (req.query.minPrice || req.query.maxPrice) {
    filter.pricePerKgPaise = {};
    if (req.query.minPrice) filter.pricePerKgPaise.$gte = Math.round(Number(req.query.minPrice) * 100);
    if (req.query.maxPrice) filter.pricePerKgPaise.$lte = Math.round(Number(req.query.maxPrice) * 100);
  }
  if (req.query.minQuantity) {
    filter.availableQuantityKg.$gte = Number(req.query.minQuantity);
  }

  if (req.query.search) {
    const term = String(req.query.search).trim();
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { materialType: { $regex: term, $options: 'i' } },
    ];
  }

  const sortMap = {
    price_asc: { pricePerKgPaise: 1 },
    price_desc: { pricePerKgPaise: -1 },
    newest: { createdAt: -1 },
    quantity_desc: { availableQuantityKg: -1 },
  };
  const sort = sortMap[req.query.sort] || { createdAt: -1 };

  const [docs, total] = await Promise.all([
    MarketplaceListing.find(filter)
      .select(PUBLIC_FIELDS)
      .populate('materialCategory', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    MarketplaceListing.countDocuments(filter),
  ]);

  // Lean docs expose `_id`; present a stable `id` field for API consumers.
  const items = docs.map((doc) => ({ ...doc, id: doc._id }));

  return paginated(res, items, { page, limit, total });
});

/** GET /marketplace/:id — public listing details. */
const getListing = asyncHandler(async (req, res) => {
  const listing = await MarketplaceListing.findOne({ _id: req.params.id, ...publicVisibilityFilter() })
    .select(PUBLIC_FIELDS)
    .populate('materialCategory', 'name slug');
  if (!listing) throw ApiError.notFound('Listing not found or no longer available');
  return ok(res, { listing });
});

module.exports = { listListings, getListing };
