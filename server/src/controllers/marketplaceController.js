'use strict';

const listingsRepo = require('../repositories/listings');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, paginated } = require('../utils/apiResponse');
const { serializeListingPublic } = require('../utils/serializers');
const { parsePage } = require('../utils/numbers');
const { LISTING_STATUS } = require('../utils/constants');
const {
  haversineDistanceKm,
  normalizePoint,
  radiusKm,
} = require('../services/distanceService');
const { searchPlace, geocodeEnabled } = require('../services/geocodingService');
const env = require('../config/env');

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
  // Distance ordering is applied after the radius filter; this is the fallback
  // ordering when the buyer has no location selected.
  nearby: { createdAt: 'desc' },
};

/** GET /marketplace — public catalogue with search, filter, sort, pagination. */
const listListings = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = publicVisibilityFilter();

  if (req.query.category) where.materialCategoryId = req.query.category;
  if (req.query.materialType) where.materialType = req.query.materialType;
  if (req.query.city) {
    // A typed place is usually "City, District, State" — the city segment is
    // what listings store, so match on that rather than the whole string.
    const city = String(req.query.city).split(',')[0].trim();
    where.city = { contains: city, mode: 'insensitive' };
  }
  if (req.query.state) {
    where.state = { equals: String(req.query.state).trim(), mode: 'insensitive' };
  }

  // Price filters are given in whole rupees by the UI.
  if (req.query.minPrice || req.query.maxPrice) {
    where.pricePerKgPaise = {};
    if (req.query.minPrice)
      where.pricePerKgPaise.gte = Math.round(Number(req.query.minPrice) * 100);
    if (req.query.maxPrice)
      where.pricePerKgPaise.lte = Math.round(Number(req.query.maxPrice) * 100);
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

  const origin = normalizePoint({
    latitude: req.query.lat ?? req.query.latitude,
    longitude: req.query.lng ?? req.query.longitude,
  });
  const selectedRadius = origin
    ? radiusKm(req.query.radiusKm ?? req.query.radius ?? env.business.defaultRadiusKm)
    : null;
  const orderBy = SORT_MAP[req.query.sort] || { createdAt: 'desc' };

  if (origin && selectedRadius) {
    where.latitude = { not: null };
    where.longitude = { not: null };
    const rows = await listingsRepo.listPublicAll({ where, orderBy });
    const nearby = rows
      .map((row) => ({
        row,
        distanceKm: haversineDistanceKm(origin, {
          latitude: row.latitude,
          longitude: row.longitude,
        }),
      }))
      .filter((entry) => entry.distanceKm !== null && entry.distanceKm <= selectedRadius)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const total = nearby.length;
    const items = nearby.slice(skip, skip + limit).map(({ row, distanceKm }) => {
      row._distanceKm = Math.round(distanceKm * 10) / 10;
      return serializeListingPublic(row);
    });

    return paginated(res, items, {
      page,
      limit,
      total,
      origin,
      radiusKm: selectedRadius,
      // Set when the buyer's location is known but nothing falls inside the
      // circle, so the UI can offer a wider radius instead of a blank page.
      noResultsWithinRadius: total === 0,
    });
  }

  const { rows, total } = await listingsRepo.listPublic({ where, orderBy, skip, take: limit });
  const items = rows.map(serializeListingPublic);

  return paginated(res, items, { page, limit, total });
});

/**
 * GET /marketplace/geocode?q= — resolve a typed place into coordinates so a
 * manual location search can be distance-sorted. Returns an empty result set
 * (not an error) when the provider is not configured; the UI then falls back
 * to filtering by city.
 */
const geocodePlace = asyncHandler(async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) throw ApiError.badRequest('Enter at least two characters to search a place');

  if (!geocodeEnabled()) {
    return ok(res, { enabled: false, results: [] }, 'Geocoding is not configured');
  }

  const results = (await searchPlace(query, { limit: 6 })) || [];
  return ok(res, { enabled: true, results });
});

/** GET /marketplace/:id — public listing details. */
const getListing = asyncHandler(async (req, res) => {
  const listing = await listingsRepo.findPublicById(req.params.id, publicVisibilityFilter());
  if (!listing) throw ApiError.notFound('Listing not found or no longer available');

  const origin = normalizePoint({
    latitude: req.query.lat ?? req.query.latitude,
    longitude: req.query.lng ?? req.query.longitude,
  });
  if (origin) {
    const distanceKm = haversineDistanceKm(origin, {
      latitude: listing.latitude,
      longitude: listing.longitude,
    });
    if (distanceKm !== null) listing._distanceKm = Math.round(distanceKm * 10) / 10;
  }

  return ok(res, { listing: serializeListingPublic(listing) });
});

module.exports = { listListings, getListing, geocodePlace };
