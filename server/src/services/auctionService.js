'use strict';

const { prisma } = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { newId, generateReference } = require('../utils/idGenerator');
const { recordAudit } = require('./auditService');
const { notifyAuction, notifyOrder } = require('./notificationService');
const { emitAuctionEvent, emitToUser } = require('./socketService');
const { computePickupCostPaise } = require('./pricingService');
const auctionsRepo = require('../repositories/auctions');
const auctionBidsRepo = require('../repositories/auctionBids');
const { incrementPaise, minNextBidPaise } = require('../utils/auctionMath');
const {
  AUCTION_STATUS,
  BID_STATUS,
  AUCTION_RESULT,
  ORDER_STATUS,
  AUDIT_ACTION,
  ROLES,
} = require('../utils/constants');

/**
 * Auction engine.
 *
 * Concurrency contract:
 *  - Bids and finalization run inside interactive transactions that lock the
 *    auction row (`SELECT ... FOR UPDATE`). Two buyers can never both become
 *    the highest bidder, and a winner is decided exactly once.
 *  - Socket.IO broadcasts and notifications happen strictly AFTER commit.
 *  - The server clock is the only clock: endAt lives on the row and no client
 *    timer can extend or reset it.
 */

// ── Bid math (pure helpers live in utils/auctionMath) ───────────────────────

/** Public real-time snapshot — never includes bidder identities or reserve. */
function auctionPublicState(auction) {
  return {
    id: auction.id,
    _id: auction.id,
    auctionNumber: auction.auctionNumber,
    status: auction.status,
    startingPricePerKgPaise: auction.startingPricePerKgPaise,
    currentHighestBidPerKgPaise: auction.currentHighestBidPerKgPaise ?? null,
    bidCount: auction.bidCount,
    bidderCount: auction.bidderCount,
    startAt: auction.startAt,
    endAt: auction.endAt,
    extensionCount: auction.extensionCount,
  };
}

// ── Bidding ─────────────────────────────────────────────────────────────────

/**
 * Places a bid. Every rule is validated here against the locked row — the
 * client's idea of price, time or leader is never trusted.
 */
async function placeBid({ auctionId, bidderId, bidPerKgPaise, idempotencyKey = null, req = null }) {
  const bidPaise = Math.round(Number(bidPerKgPaise));
  if (!Number.isFinite(bidPaise) || bidPaise <= 0) {
    throw ApiError.badRequest('Bid must be a positive amount');
  }
  if (bidPaise > 100_000_000) throw ApiError.badRequest('Bid amount looks unreasonable');

  // Fast replay path for retried requests (also re-checked inside the lock).
  if (idempotencyKey) {
    const existing = await auctionBidsRepo.findByAuctionAndIdempotencyKey(
      auctionId,
      idempotencyKey
    );
    if (existing) {
      const auction = await auctionsRepo.findRawById(auctionId);
      return { bid: existing, auction, replay: true };
    }
  }

  const outcome = await prisma.$transaction(
    async (tx) => {
      const locked =
        await tx.$queryRaw`SELECT * FROM waste_auctions WHERE id = ${auctionId} FOR UPDATE`;
      const auction = Array.isArray(locked) ? locked[0] : null;
      if (!auction) return { error: ApiError.notFound('Auction not found') };

      if (idempotencyKey) {
        const same = await tx.wasteAuctionBid.findFirst({ where: { auctionId, idempotencyKey } });
        if (same) return { bid: same, auction, replay: true };
      }

      if (String(auction.sellerId) === String(bidderId)) {
        return { error: ApiError.forbidden('You cannot bid on your own waste') };
      }
      if (auction.status !== AUCTION_STATUS.ACTIVE) {
        return { error: ApiError.conflict(`Auction is not active (status: ${auction.status})`) };
      }
      const now = Date.now();
      if (!auction.endAt || new Date(auction.endAt).getTime() <= now) {
        return { error: ApiError.conflict('This auction has ended') };
      }

      const minNext = minNextBidPaise(auction);
      if (bidPaise < minNext) {
        const basis =
          auction.currentHighestBidPerKgPaise == null
            ? 'the starting price'
            : 'the current highest bid plus the minimum increment';
        return {
          error: ApiError.conflict(
            `Bid too low: minimum acceptable bid is ${minNext} paise/kg (${basis})`
          ),
        };
      }

      const previousLeaderId = auction.currentHighestBidderId || null;
      const firstBidByBidder =
        (await tx.wasteAuctionBid.count({ where: { auctionId, bidderId } })) === 0;

      const bidId = newId();
      const bid = await tx.wasteAuctionBid.create({
        data: {
          id: bidId,
          auctionId,
          bidderId,
          bidPerKgPaise: bidPaise,
          totalBidValuePaise: Math.round(bidPaise * auction.quantityKg),
          status: BID_STATUS.LEADING,
          idempotencyKey: idempotencyKey || null,
        },
      });

      await tx.wasteAuctionBid.updateMany({
        where: { auctionId, status: BID_STATUS.LEADING, id: { not: bidId } },
        data: { status: BID_STATUS.OUTBID },
      });

      // Anti-sniping: a bid inside the configured window extends the deadline.
      // Evaluated against the server-stored endAt inside the row lock.
      let endAt = new Date(auction.endAt);
      let extensionCount = auction.extensionCount || 0;
      let extended = false;
      if (auction.antiSnipingEnabled) {
        const msLeft = endAt.getTime() - now;
        if (msLeft <= Number(auction.antiSnipingWindowSeconds) * 1000) {
          endAt = new Date(endAt.getTime() + Number(auction.antiSnipingExtensionSeconds) * 1000);
          extensionCount += 1;
          extended = true;
        }
      }

      const updatedAuction = await tx.wasteAuction.update({
        where: { id: auctionId },
        data: {
          currentHighestBidPerKgPaise: bidPaise,
          currentHighestBidId: bidId,
          currentHighestBidderId: bidderId,
          bidCount: { increment: 1 },
          ...(firstBidByBidder ? { bidderCount: { increment: 1 } } : {}),
          endAt,
          extensionCount,
        },
      });

      return {
        bid,
        auction: updatedAuction,
        previousLeaderId:
          previousLeaderId && String(previousLeaderId) !== String(bidderId)
            ? previousLeaderId
            : null,
        extended,
      };
    },
    { timeout: 15_000 }
  );

  if (outcome.error) throw outcome.error;

  const { bid, auction, previousLeaderId, extended, replay } = outcome;
  if (!replay) {
    if (previousLeaderId) {
      await notifyAuction(
        previousLeaderId,
        'You have been outbid',
        `A higher bid of ₹${(bid.bidPerKgPaise / 100).toFixed(2)}/kg was placed on ${auction.auctionNumber}.`,
        auction.id
      );
      emitToUser(previousLeaderId, 'auction:outbid', {
        auctionId: auction.id,
        currentHighestBidPerKgPaise: bid.bidPerKgPaise,
      });
    }
    await recordAudit({
      action: AUDIT_ACTION.AUCTION_BID,
      resourceType: 'WasteAuction',
      resourceId: auction.id,
      after: { bidPerKgPaise: bid.bidPerKgPaise, totalBidValuePaise: bid.totalBidValuePaise },
      req,
    });
    emitAuctionEvent(auction.id, 'auction:bid', auctionPublicState(auction));
    if (extended) {
      emitAuctionEvent(auction.id, 'auction:extended', {
        auctionId: auction.id,
        endAt: auction.endAt,
        extensionCount: auction.extensionCount,
      });
    }
  }

  return { bid, auction, replay: Boolean(replay) };
}

// ── Duration eligibility ────────────────────────────────────────────────────

/**
 * Resolves the seller's requested duration against admin settings:
 *  - when sellers may choose → must be one of the admin-allowed options;
 *  - otherwise → the admin default is forced.
 */
function resolveDurationMinutes(settings, requested) {
  const min = Number(settings.minDurationMinutes);
  const max = Number(settings.maxDurationMinutes);

  if (!settings.sellerCanChooseDuration) return Number(settings.defaultDurationMinutes);
  if (requested == null || requested === '') return Number(settings.defaultDurationMinutes);

  const duration = Math.round(Number(requested));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw ApiError.badRequest('Auction duration must be a positive number of minutes');
  }
  if (duration < min || duration > max) {
    throw ApiError.badRequest(`Auction duration must be between ${min} and ${max} minutes`);
  }
  const allowed = Array.isArray(settings.allowedDurationsMinutes)
    ? settings.allowedDurationsMinutes.map((v) => Number(v))
    : [];
  if (allowed.length && !allowed.includes(duration)) {
    throw ApiError.badRequest(`Auction duration must be one of: ${allowed.join(', ')} minutes`);
  }
  return duration;
}

// ── Settlement math ─────────────────────────────────────────────────────────

/**
 * One documented derivation — no component is subtracted twice:
 *   gross          = winning bid/kg × quantity kg
 *   buyer payable  = gross + tax%            (buyer side)
 *   seller payout  = gross − platform fee% − pickup cost   (seller side, floor 0)
 */
function buildSettlement({ auction, winningBidPerKgPaise, quantityKg, pricingConfig }) {
  const grossPaise = Math.round(winningBidPerKgPaise * quantityKg);
  const platformFeePercent = pricingConfig?.platformFeePercent ?? env.business.platformFeePercent;
  const platformFeePaise = Math.round((grossPaise * platformFeePercent) / 100);
  const pickup = computePickupCostPaise(pricingConfig, auction.location || {});
  const payoutBeforeClamp = grossPaise - platformFeePaise - pickup.pickupCostPaise;
  const taxPercent = pricingConfig?.taxPercent ?? env.business.taxPercent;
  const taxPaise = Math.round((grossPaise * taxPercent) / 100);

  return {
    currency: 'INR',
    winningBidPerKgPaise,
    quantityKg,
    quantitySource: 'LISTED',
    grossPaise,
    platformFeePercent,
    platformFeePaise,
    pickupCostPaise: pickup.pickupCostPaise,
    sellerPayoutPaise: Math.max(0, payoutBeforeClamp),
    payoutClampedToZero: payoutBeforeClamp < 0,
    taxPercent,
    taxPaise,
    buyerPayablePaise: grossPaise + taxPaise,
    computedAt: new Date(),
    formula: 'buyerPayable = gross + tax; sellerPayout = gross − platformFee − pickupCost',
  };
}

// ── Finalization ────────────────────────────────────────────────────────────

/**
 * Ends an ACTIVE auction exactly once (row lock + status guard). Decides the
 * winner, creates the linked order and settles the money snapshot.
 */
async function finalizeAuction(auctionId, { req = null, trigger = 'system' } = {}) {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const locked =
        await tx.$queryRaw`SELECT * FROM waste_auctions WHERE id = ${auctionId} FOR UPDATE`;
      const auction = Array.isArray(locked) ? locked[0] : null;
      if (!auction) return { skipped: 'not_found' };
      if (auction.status !== AUCTION_STATUS.ACTIVE) return { skipped: 'not_active' };
      if (!auction.endAt || new Date(auction.endAt).getTime() > Date.now()) {
        return { skipped: 'not_due' };
      }

      const topBid = await tx.wasteAuctionBid.findFirst({
        where: { auctionId },
        orderBy: [{ bidPerKgPaise: 'desc' }, { createdAt: 'asc' }],
      });

      // 1. No bids → NO_BIDS.
      if (!topBid) {
        const updated = await tx.wasteAuction.update({
          where: { id: auctionId },
          data: {
            status: AUCTION_STATUS.NO_BIDS,
            winnerSelectionReason: AUCTION_RESULT.NO_BIDS,
            finalizedAt: new Date(),
          },
        });
        return { result: AUCTION_RESULT.NO_BIDS, auction: updated };
      }

      // 2. Reserve not met → end without a winner. Never auto-award below reserve.
      const reserve = auction.reservePricePerKgPaise;
      if (reserve != null && Number(topBid.bidPerKgPaise) < Number(reserve)) {
        await tx.wasteAuctionBid.updateMany({
          where: { auctionId },
          data: { status: BID_STATUS.LOST },
        });
        const updated = await tx.wasteAuction.update({
          where: { id: auctionId },
          data: {
            status: AUCTION_STATUS.ENDED,
            winnerSelectionReason: AUCTION_RESULT.RESERVE_NOT_MET,
            finalizedAt: new Date(),
          },
        });
        return { result: AUCTION_RESULT.RESERVE_NOT_MET, auction: updated, topBid };
      }

      // 3. Winner decided → settle, create the linked order, await payment.
      const pricingConfig = await tx.pricingConfiguration.findFirst({
        where: { materialCategoryId: auction.materialCategoryId, active: true },
        orderBy: [{ version: 'desc' }],
      });
      const settlement = buildSettlement({
        auction,
        winningBidPerKgPaise: topBid.bidPerKgPaise,
        quantityKg: auction.quantityKg,
        pricingConfig,
      });

      const buyer = await tx.user.findUnique({ where: { id: topBid.bidderId } });
      const buyerAddress = (buyer && typeof buyer.address === 'object' && buyer.address) || {};

      await tx.wasteAuctionBid.update({
        where: { id: topBid.id },
        data: { status: BID_STATUS.WON },
      });
      await tx.wasteAuctionBid.updateMany({
        where: { auctionId, id: { not: topBid.id } },
        data: { status: BID_STATUS.LOST },
      });

      const order = await tx.order.create({
        data: {
          id: newId(),
          orderNumber: generateReference('ORD'),
          buyerId: topBid.bidderId,
          auctionId: auction.id,
          delivery: {
            address: buyerAddress.line1 || buyerAddress.address || '',
            city: buyerAddress.city || (auction.location && auction.location.city) || '',
            state: buyerAddress.state || (auction.location && auction.location.state) || '',
            postalCode: buyerAddress.postalCode || '',
            contactName: (buyer && buyer.name) || '',
            contactPhone: (buyer && buyer.phone) || '',
          },
          items: [
            {
              materialName: `${auction.materialType} — auction ${auction.auctionNumber}`,
              materialType: auction.materialType,
              qualityGrade: auction.qualityGrade,
              condition: auction.condition,
              weightKg: auction.quantityKg,
              unitPricePaise: topBid.bidPerKgPaise,
              subtotalPaise: settlement.grossPaise,
              reservedWeightKg: 0,
              fulfilledWeightKg: 0,
              sourceAuctionId: auction.id,
              sourceSubmissionId: auction.submissionId,
            },
          ],
          materialSubtotalPaise: settlement.grossPaise,
          taxPercent: settlement.taxPercent,
          taxPaise: settlement.taxPaise,
          transportationPaise: 0,
          otherFeesPaise: 0,
          totalPaise: settlement.buyerPayablePaise,
          quoteIsProvisional: false,
          status: ORDER_STATUS.ACCEPTED,
          statusHistory: [
            {
              status: ORDER_STATUS.ACCEPTED,
              at: new Date(),
              by: null,
              note: `Created from won auction ${auction.auctionNumber}`,
            },
          ],
          notes: `Auction win — winning bid ₹${(topBid.bidPerKgPaise / 100).toFixed(2)}/kg`,
          inventoryReserved: false,
          inventoryCommitted: false,
        },
      });

      const updated = await tx.wasteAuction.update({
        where: { id: auctionId },
        data: {
          status: AUCTION_STATUS.AWAITING_PAYMENT,
          winnerId: topBid.bidderId,
          winningBidId: topBid.id,
          winningBidPerKgPaise: topBid.bidPerKgPaise,
          winningTotalPaise: settlement.grossPaise,
          winnerSelectionReason: AUCTION_RESULT.WINNER,
          settlement,
          finalizedAt: new Date(),
        },
      });

      return { result: AUCTION_RESULT.WINNER, auction: updated, topBid, order, settlement };
    },
    { timeout: 15_000 }
  );

  if (outcome.skipped) return outcome;

  const { result, auction, topBid, order } = outcome;

  // Post-commit side effects: notifications, broadcasts, audit.
  if (result === AUCTION_RESULT.WINNER) {
    await notifyAuction(
      auction.sellerId,
      'Your auction ended — winner decided',
      `Auction ${auction.auctionNumber} ended with a winning bid of ₹${(topBid.bidPerKgPaise / 100).toFixed(2)}/kg.`,
      auction.id
    );
    await notifyOrder(
      topBid.bidderId,
      'You won the auction!',
      `You won auction ${auction.auctionNumber} at ₹${(topBid.bidPerKgPaise / 100).toFixed(2)}/kg. Order ${order.orderNumber} is awaiting payment.`,
      order.id
    );
  } else if (result === AUCTION_RESULT.NO_BIDS) {
    await notifyAuction(
      auction.sellerId,
      'Your auction ended with no bids',
      `Auction ${auction.auctionNumber} ended without any bids.`,
      auction.id
    );
  } else if (result === AUCTION_RESULT.RESERVE_NOT_MET) {
    await notifyAuction(
      auction.sellerId,
      'Your auction ended — reserve price not met',
      `Auction ${auction.auctionNumber} ended but the best bid did not reach your reserve price. The material was not awarded.`,
      auction.id
    );
  }

  try {
    const admins = await prisma.user.findMany({
      where: { role: ROLES.ADMIN },
      select: { id: true },
    });
    for (const admin of admins) {
      await notifyAuction(
        admin.id,
        'Auction finalized',
        `Auction ${auction.auctionNumber} ended (${result}).`,
        auction.id
      );
    }
  } catch (err) {
    logger.warn(`Admin auction notification failed: ${err.message}`);
  }

  emitAuctionEvent(auction.id, 'auction:ended', {
    ...auctionPublicState(auction),
    result,
    winningBidPerKgPaise: auction.winningBidPerKgPaise ?? null,
  });
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_FINALIZE,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    after: { result, status: auction.status, orderId: order ? order.id : null },
    meta: { trigger },
    req,
  });

  return outcome;
}

// ── Scheduled activation + worker ───────────────────────────────────────────

/** SCHEDULED → ACTIVE; the conditional update makes this fire exactly once. */
async function activateAuction(auctionId) {
  const claimed = await auctionsRepo.claimForActivation(auctionId);
  if (!claimed || claimed.count === 0) return null;

  const auction = await auctionsRepo.findById(auctionId);
  emitAuctionEvent(auctionId, 'auction:state', auctionPublicState(auction));
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_UPDATE,
    resourceType: 'WasteAuction',
    resourceId: auctionId,
    after: { status: AUCTION_STATUS.ACTIVE },
    meta: { trigger: 'schedule' },
  });
  return auction;
}

let ticking = false;

/**
 * One maintenance pass: start scheduled auctions, finalize expired ones.
 * Idempotent and safe to run from several instances thanks to the conditional
 * claims inside activateAuction/finalizeAuction.
 */
async function tickAuctions() {
  if (ticking) return;
  ticking = true;
  try {
    const dueToStart = await auctionsRepo.findDueForActivation();
    for (const { id } of dueToStart) {
      await activateAuction(id);
    }
    const dueToEnd = await auctionsRepo.findDueForFinalization();
    for (const { id } of dueToEnd) {
      await finalizeAuction(id, { trigger: 'worker' });
    }
  } finally {
    ticking = false;
  }
}

const WORKER_INTERVAL_MS = 5000;

function startAuctionWorker() {
  const timer = setInterval(() => {
    tickAuctions().catch((err) => logger.error(`Auction worker tick failed: ${err.message}`));
  }, WORKER_INTERVAL_MS);
  timer.unref();
  return timer;
}

/** Startup recovery: catches up on anything that expired while down. */
function recoverAuctions() {
  return tickAuctions();
}

module.exports = {
  incrementPaise,
  minNextBidPaise,
  auctionPublicState,
  placeBid,
  finalizeAuction,
  activateAuction,
  buildSettlement,
  resolveDurationMinutes,
  tickAuctions,
  startAuctionWorker,
  recoverAuctions,
};
