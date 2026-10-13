'use strict';

const listingsRepo = require('../repositories/listings');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, paginated } = require('../utils/apiResponse');
const { serializeListingPublic } = require('../utils/serializers');
const { parsePage } = require('../utils/numbers');
const { LISTING_STATUS } = require('../utils/constants');

// Only these listings are ever visible publicly.
function publicVisibilityFilter() {
  return {
    active: true,
    publicationStatus: LISTING_STATUS.PUBLISHED,
    availableQuantityKg: { gt: 0 },
  };
}

const SORT_MAP = {
  price_asc: { pricePerKgPaise: 'asc' },
  price_desc: { pricePerKgPaise: 'desc' },
  newest: { createdAt: 'desc' },
  quantity_desc: { availableQuantityKg: 'desc' },
};

/** GET /marketplace — public catalogue with search, filter, sort, pagination. */
const listListings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = publicVisibilityFilter();

  if (req.query.category) where.materialCategoryId = req.query.category;
  if (req.query.materialType) where.materialType = req.query.materialType;

  // Price filters are given in whole rupees by the UI.
  if (req.query.minPrice || req.query.maxPrice) {
    where.pricePerKgPaise = {};
    if (req.query.minPrice) where.pricePerKgPaise.gte = Math.round(Number(req.query.minPrice) * 100);
    if (req.query.maxPrice) where.pricePerKgPaise.lte = Math.round(Number(req.query.maxPrice) * 100);
  }
  if (req.query.minQuantity) {
    where.availableQuantityKg.gte = Number(req.query.minQuantity);
  }

  if (req.query.search) {
    const term = String(req.query.search).trim();
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { materialType: { contains: term, mode: 'insensitive' } },
    ];
  }

  const orderBy = SORT_MAP[req.query.sort] || { createdAt: 'desc' };

  const { rows, total } = await listingsRepo.listPublic({ where, orderBy, skip, take: limit });
  const items = rows.map(serializeListingPublic);

  return paginated(res, items, { page, limit, total });
});

/** GET /marketplace/:id — public listing details. */
const getListing = asyncHandler(async (req, res) => {
  const listing = await listingsRepo.findPublicById(req.params.id, publicVisibilityFilter());
  if (!listing) throw ApiError.notFound('Listing not found or no longer available');
  return ok(res, { listing: serializeListingPublic(listing) });
});

module.exports = { listListings, getListing };
