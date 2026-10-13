'use strict';

const auctionsRepo = require('../repositories/auctions');
const auctionBidsRepo = require('../repositories/auctionBids');
const auctionSettingsRepo = require('../repositories/auctionSettings');
const auctionService = require('../services/auctionService');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, paginated } = require('../utils/apiResponse');
const { serializeAuction, serializeAuctionBid } = require('../utils/serializers');
const { parsePage } = require('../utils/numbers');
const { ROLES, AUCTION_STATUS, AUCTION_PUBLIC_STATUSES } = require('../utils/constants');

function roleOf(req) {
  return req.user ? req.user.role : null;
}

function isOwnerOf(req, auction) {
  return req.user && auction && String(auction.sellerId) === String(req.user.id);
}

function variantFor(req, auction) {
  if (roleOf(req) === ROLES.ADMIN) return 'admin';
  if (isOwnerOf(req, auction)) return 'owner';
  return 'public';
}

/** Pending-approval auctions are private to the seller and admins. */
function assertVisible(variant, auction) {
  if (variant === 'public' && auction.status === AUCTION_STATUS.PENDING_APPROVAL) {
    throw ApiError.notFound('Auction not found');
  }
}

const CONCLUDED_STATUSES = [
  AUCTION_STATUS.ENDED,
  AUCTION_STATUS.AWAITING_PAYMENT,
  AUCTION_STATUS.AWAITING_PICKUP,
  AUCTION_STATUS.COMPLETED,
];

/** Public: Waste Auctions marketplace list (only approved + active auctions). */
const listAuctions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const requested = req.query.status;
  const statuses =
    requested && AUCTION_PUBLIC_STATUSES.includes(requested)
      ? [requested]
      : AUCTION_PUBLIC_STATUSES;

  const { rows, total } = await auctionsRepo.list({
    statuses,
    categoryId: req.query.category,
    materialType: req.query.materialType,
    search: req.query.search,
    city: req.query.city,
    bidMin: req.query.bidMin,
    bidMax: req.query.bidMax,
    quantityMin: req.query.quantityMin,
    quantityMax: req.query.quantityMax,
    skip,
    take: limit,
    // Active auctions first (soonest to end), then scheduled ones.
    orderBy: [{ status: 'asc' }, { endAt: 'asc' }],
    variant: 'public',
  });

  return paginated(
    res,
    rows.map((r) => serializeAuction(r, { variant: 'public' })),
    { page, limit, total }
  );
});

/** Public detail (seller/admin get their extended variants). Expired auctions
 *  are finalized lazily so a refresh can never show a stale ACTIVE state. */
const getAuction = asyncHandler(async (req, res) => {
  const raw = await auctionsRepo.findRawById(req.params.id);
  if (!raw) throw ApiError.notFound('Auction not found');

  const variant = variantFor(req, raw);
  assertVisible(variant, raw);

  if (
    raw.status === AUCTION_STATUS.ACTIVE &&
    raw.endAt &&
    new Date(raw.endAt).getTime() <= Date.now()
  ) {
    await auctionService.finalizeAuction(raw.id, { trigger: 'read' }).catch(() => {});
  }

  const auction = await auctionsRepo.findById(req.params.id, { variant });
  return ok(res, { auction: serializeAuction(auction, { variant }) });
});

/** Bid history. Public history is anonymized; the seller learns identities
 *  only after the auction concluded; admins always see them. */
const listAuctionBids = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const raw = await auctionsRepo.findRawById(req.params.id);
  if (!raw) throw ApiError.notFound('Auction not found');

  const variant = variantFor(req, raw);
  assertVisible(variant, raw);

  const isAdmin = roleOf(req) === ROLES.ADMIN;
  const ownerReveal = variant === 'owner' && CONCLUDED_STATUSES.includes(raw.status);
  const includeBidder = isAdmin || ownerReveal;

  const { rows, total } = await auctionBidsRepo.listByAuction(raw.id, {
    skip,
    take: limit,
    includeBidder,
  });

  const serialized = rows.map((b) =>
    serializeAuctionBid(b, {
      viewerId: req.user ? req.user.id : null,
      isAdmin,
      revealIdentities: ownerReveal,
    })
  );
  return paginated(res, serialized, { page, limit, total });
});

/** POST /auctions/:id/bids — authenticated buyers only, backend-validated. */
const placeBid = asyncHandler(async (req, res) => {
  const result = await auctionService.placeBid({
    auctionId: req.params.id,
    bidderId: req.user.id,
    bidPerKgPaise: req.body.bidPerKgPaise,
    idempotencyKey: req.body.idempotencyKey || null,
    req,
  });

  return ok(
    res,
    {
      bid: serializeAuctionBid(result.bid, { viewerId: req.user.id }),
      auction: serializeAuction(result.auction, { variant: 'public' }),
    },
    result.replay ? 'Bid already recorded' : 'Bid placed successfully'
  );
});

/** Seller: my auctions (all statuses, owner variant). */
const myAuctions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await auctionsRepo.list({
    sellerId: req.user.id,
    status: req.query.status,
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    variant: 'owner',
  });
  return paginated(
    res,
    rows.map((r) => serializeAuction(r, { variant: 'owner' })),
    { page, limit, total }
  );
});

function auctionSummary(a) {
  if (!a) return undefined;
  return {
    id: a.id,
    _id: a.id,
    auctionNumber: a.auctionNumber,
    materialType: a.materialType,
    quantityKg: a.quantityKg,
    images: a.images || {},
    status: a.status,
    endAt: a.endAt ?? undefined,
    startingPricePerKgPaise: a.startingPricePerKgPaise,
    currentHighestBidPerKgPaise: a.currentHighestBidPerKgPaise ?? null,
  };
}

/** Buyer: my bids (active / outbid / won / lost) with auction context. */
const myBids = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const statuses = req.query.status ? [req.query.status] : undefined;
  const { rows, total } = await auctionBidsRepo.listByBidder(req.user.id, {
    skip,
    take: limit,
    statuses,
  });
  const serialized = rows.map((row) => ({
    ...serializeAuctionBid(row, { viewerId: req.user.id }),
    auction: auctionSummary(row.auction),
  }));
  return paginated(res, serialized, { page, limit, total });
});

/** Public auction rules for the seller form + live pages (no secrets). */
const getPublicSettings = asyncHandler(async (_req, res) => {
  const settings = await auctionSettingsRepo.get();
  return ok(res, {
    settings: {
      minAuctionQuantityKg: settings.minAuctionQuantityKg,
      sellerCanChooseDuration: settings.sellerCanChooseDuration,
      defaultDurationMinutes: settings.defaultDurationMinutes,
      minDurationMinutes: settings.minDurationMinutes,
      maxDurationMinutes: settings.maxDurationMinutes,
      allowedDurationsMinutes: Array.isArray(settings.allowedDurationsMinutes)
        ? settings.allowedDurationsMinutes
        : [],
      minIncrementType: settings.minIncrementType,
      minIncrementValue: settings.minIncrementValue,
    },
  });
});

module.exports = {
  listAuctions,
  getAuction,
  listAuctionBids,
  placeBid,
  myAuctions,
  myBids,
  getPublicSettings,
};
