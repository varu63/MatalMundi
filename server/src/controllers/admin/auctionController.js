'use strict';

const auctionsRepo = require('../../repositories/auctions');
const auctionBidsRepo = require('../../repositories/auctionBids');
const auctionSettingsRepo = require('../../repositories/auctionSettings');
const submissionsRepo = require('../../repositories/submissions');
const ordersRepo = require('../../repositories/orders');
const pricingRepo = require('../../repositories/pricing');
const auctionService = require('../../services/auctionService');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const {
  serializeAuction,
  serializeAuctionBid,
  serializeAuctionSettings,
} = require('../../utils/serializers');
const { notifyAuction, notifyOrder } = require('../../services/notificationService');
const { recordAudit } = require('../../services/auditService');
const { emitAuctionEvent } = require('../../services/socketService');
const { parsePage } = require('../../utils/numbers');
const {
  AUCTION_STATUS,
  AUCTION_RESULT,
  SUBMISSION_STATUS,
  ORDER_STATUS,
  AUDIT_ACTION,
} = require('../../utils/constants');

const rupees = (paise) => `₹${(Number(paise) / 100).toFixed(2)}`;

async function loadRaw(id) {
  const auction = await auctionsRepo.findRawById(id);
  if (!auction) throw ApiError.notFound('Auction not found');
  return auction;
}

/** GET /admin/auctions — full queue and all states. */
const listAuctions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await auctionsRepo.list({
    status: req.query.status,
    categoryId: req.query.category,
    materialType: req.query.materialType,
    search: req.query.search,
    sellerId: req.query.seller,
    city: req.query.city,
    bidMin: req.query.bidMin,
    bidMax: req.query.bidMax,
    quantityMin: req.query.quantityMin,
    quantityMax: req.query.quantityMax,
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    variant: 'admin',
  });
  return paginated(
    res,
    rows.map((r) => serializeAuction(r, { variant: 'admin' })),
    { page, limit, total }
  );
});

/** GET /admin/auctions/:id — full detail (reserve, settlement, order, parties). */
const getAuction = asyncHandler(async (req, res) => {
  const auction = await auctionsRepo.findById(req.params.id, { variant: 'admin' });
  if (!auction) throw ApiError.notFound('Auction not found');
  return ok(res, { auction: serializeAuction(auction, { variant: 'admin' }) });
});

/** GET /admin/auctions/:id/bids — bid history with bidder identities. */
const getAuctionBids = asyncHandler(async (req, res) => {
  const raw = await loadRaw(req.params.id);
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await auctionBidsRepo.listByAuction(raw.id, {
    skip,
    take: limit,
    includeBidder: true,
  });
  return paginated(
    res,
    rows.map((b) => serializeAuctionBid(b, { isAdmin: true })),
    { page, limit, total }
  );
});

/**
 * POST /admin/auctions/:id/approve
 * Approves the auction (and its underlying submission). Optionally schedules a
 * future start and adjusts the starting price — both audited.
 */
const approveAuction = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);
  if (auction.status !== AUCTION_STATUS.PENDING_APPROVAL) {
    throw ApiError.conflict(`Auction is already ${auction.status}`);
  }

  const settings = await auctionSettingsRepo.get();
  let duration = auction.durationMinutes;
  if (req.body.durationMinutes != null) {
    duration = Number(req.body.durationMinutes);
    if (duration < settings.minDurationMinutes || duration > settings.maxDurationMinutes) {
      throw ApiError.badRequest(
        `Duration must be between ${settings.minDurationMinutes} and ${settings.maxDurationMinutes} minutes`
      );
    }
  }

  const startAt = req.body.startAt ? new Date(req.body.startAt) : new Date();
  if (Number.isNaN(startAt.getTime())) throw ApiError.badRequest('Invalid start time');
  const startsLater = startAt.getTime() > Date.now() + 5000;
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  const startingPricePerKgPaise =
    req.body.startingPricePerKgPaise != null
      ? Math.round(Number(req.body.startingPricePerKgPaise))
      : auction.startingPricePerKgPaise;

  const updated = await auctionsRepo.updateById(auction.id, {
    status: startsLater ? AUCTION_STATUS.SCHEDULED : AUCTION_STATUS.ACTIVE,
    startAt,
    endAt,
    durationMinutes: duration,
    startingPricePerKgPaise,
    approvedById: req.user.id,
    approvedAt: new Date(),
  });

  // The underlying submission moves to APPROVED together with the auction.
  await submissionsRepo.updateById(auction.submissionId, {
    status: SUBMISSION_STATUS.APPROVED,
    approvedById: req.user.id,
    approvedAt: new Date(),
    reviewedById: req.user.id,
    reviewedAt: new Date(),
  });

  await notifyAuction(
    auction.sellerId,
    startsLater ? 'Auction scheduled' : 'Your auction is live',
    startsLater
      ? `Auction ${auction.auctionNumber} is approved and starts at ${startAt.toISOString()}.`
      : `Auction ${auction.auctionNumber} is now live with a starting price of ${rupees(startingPricePerKgPaise)}/kg.`,
    auction.id
  );
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_APPROVE,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    before: { status: auction.status, startingPricePerKgPaise: auction.startingPricePerKgPaise },
    after: {
      status: updated.status,
      startingPricePerKgPaise,
      startAt,
      endAt,
      durationMinutes: duration,
    },
    meta: { note: req.body.note || '' },
    req,
  });

  emitAuctionEvent(auction.id, 'auction:state', auctionService.auctionPublicState(updated));
  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Auction approved');
});

/** POST /admin/auctions/:id/reject — pending queue only. */
const rejectAuction = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);
  if (auction.status !== AUCTION_STATUS.PENDING_APPROVAL) {
    throw ApiError.conflict(`Auction is already ${auction.status}`);
  }

  const updated = await auctionsRepo.updateById(auction.id, {
    status: AUCTION_STATUS.CANCELLED,
    rejectionReason: req.body.reason,
    winnerSelectionReason: '',
    rejectedById: req.user.id,
    rejectedAt: new Date(),
  });

  await submissionsRepo.updateById(auction.submissionId, {
    status: SUBMISSION_STATUS.REJECTED,
    rejectionReason: req.body.reason,
    reviewedById: req.user.id,
    reviewedAt: new Date(),
  });

  await notifyAuction(
    auction.sellerId,
    'Auction rejected',
    `Auction ${auction.auctionNumber} was rejected. Reason: ${req.body.reason}`,
    auction.id
  );
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_REJECT,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    after: { status: updated.status, reason: req.body.reason },
    req,
  });

  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Auction rejected');
});

/**
 * PATCH /admin/auctions/:id — rule/price adjustments, allowed only while no
 * bids exist (pending or scheduled). An auction with bidders is never changed
 * silently to their disadvantage.
 */
const updateAuction = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);

  const OPEN_STATUSES = [
    AUCTION_STATUS.PENDING_APPROVAL,
    AUCTION_STATUS.SCHEDULED,
    AUCTION_STATUS.ACTIVE,
  ];
  if (!OPEN_STATUSES.includes(auction.status)) {
    throw ApiError.conflict('Only pending, scheduled or live auctions can be adjusted');
  }
  if (auction.bidCount > 0) {
    throw ApiError.conflict('This auction already has bids — rules cannot be changed');
  }

  const settings = await auctionSettingsRepo.get();
  const before = {
    startingPricePerKgPaise: auction.startingPricePerKgPaise,
    minIncrementType: auction.minIncrementType,
    minIncrementValue: auction.minIncrementValue,
    antiSnipingEnabled: auction.antiSnipingEnabled,
    antiSnipingWindowSeconds: auction.antiSnipingWindowSeconds,
    antiSnipingExtensionSeconds: auction.antiSnipingExtensionSeconds,
    durationMinutes: auction.durationMinutes,
    inspectionNotes: auction.inspectionNotes,
  };

  const data = {};
  const b = req.body;
  if (b.startingPricePerKgPaise != null)
    data.startingPricePerKgPaise = Math.round(Number(b.startingPricePerKgPaise));
  if (b.minIncrementType != null) data.minIncrementType = b.minIncrementType;
  if (b.minIncrementValue != null) data.minIncrementValue = Number(b.minIncrementValue);
  if (b.antiSnipingEnabled != null) data.antiSnipingEnabled = Boolean(b.antiSnipingEnabled);
  if (b.antiSnipingWindowSeconds != null)
    data.antiSnipingWindowSeconds = Number(b.antiSnipingWindowSeconds);
  if (b.antiSnipingExtensionSeconds != null)
    data.antiSnipingExtensionSeconds = Number(b.antiSnipingExtensionSeconds);
  if (b.inspectionNotes != null) data.inspectionNotes = b.inspectionNotes;

  if (b.durationMinutes != null) {
    const duration = Number(b.durationMinutes);
    if (duration < settings.minDurationMinutes || duration > settings.maxDurationMinutes) {
      throw ApiError.badRequest(
        `Duration must be between ${settings.minDurationMinutes} and ${settings.maxDurationMinutes} minutes`
      );
    }
    data.durationMinutes = duration;
    if (auction.startAt) {
      data.endAt = new Date(new Date(auction.startAt).getTime() + duration * 60_000);
    }
  }

  const updated = await auctionsRepo.updateById(auction.id, data);
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_UPDATE,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    before,
    after: data,
    req,
  });

  emitAuctionEvent(auction.id, 'auction:state', auctionService.auctionPublicState(updated));
  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Auction updated');
});

const CANCELLABLE_STATUSES = [
  AUCTION_STATUS.PENDING_APPROVAL,
  AUCTION_STATUS.SCHEDULED,
  AUCTION_STATUS.ACTIVE,
  AUCTION_STATUS.AWAITING_PAYMENT,
  AUCTION_STATUS.AWAITING_PICKUP,
];

/**
 * POST /admin/auctions/:id/cancel — authorized cancellation with a mandatory
 * reason. If a winner already exists, their order is cancelled too (payment
 * failure flow — the runner-up is never auto-awarded; re-listing is a manual
 * admin decision).
 */
const cancelAuction = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);
  if (!CANCELLABLE_STATUSES.includes(auction.status)) {
    throw ApiError.conflict(`Auction cannot be cancelled from status ${auction.status}`);
  }

  const reason = req.body.reason;
  const hadWinner = Boolean(auction.winnerId);

  const updated = await auctionsRepo.updateById(auction.id, {
    status: AUCTION_STATUS.CANCELLED,
    cancellationReason: reason,
    winnerSelectionReason: hadWinner ? AUCTION_RESULT.PAYMENT_FAILED : AUCTION_RESULT.CANCELLED,
    cancelledById: req.user.id,
    cancelledAt: new Date(),
  });

  // Any live bids are void; a linked order (winner existed) is cancelled.
  await auctionBidsRepo.markAllOpenAsLost(auction.id);

  if (
    auction.status === AUCTION_STATUS.AWAITING_PAYMENT ||
    auction.status === AUCTION_STATUS.AWAITING_PICKUP
  ) {
    const full = await auctionsRepo.findById(auction.id, { variant: 'admin' });
    const orderId = full.order ? full.order.id : null;
    const order = orderId ? await ordersRepo.findById(orderId) : null;
    if (order && !['CANCELLED', 'DELIVERED'].includes(order.status)) {
      await ordersRepo.updateById(order.id, {
        status: ORDER_STATUS.CANCELLED,
        rejectionReason: `Auction cancelled: ${reason}`,
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          {
            status: ORDER_STATUS.CANCELLED,
            at: new Date(),
            by: req.user.id,
            note: `Auction cancelled: ${reason}`,
          },
        ],
      });
      await notifyOrder(
        order.buyerId,
        'Auction order cancelled',
        `Order ${order.orderNumber} was cancelled. Reason: ${reason}`,
        order.id
      );
    }
  }

  const bidderIds = await auctionBidsRepo.distinctBidders(auction.id);
  for (const bidderId of bidderIds) {
    if (String(bidderId) === String(auction.sellerId)) continue;

    await notifyAuction(
      bidderId,
      'Auction cancelled',
      `Auction ${auction.auctionNumber} was cancelled by the platform. Reason: ${reason}`,
      auction.id
    );
  }
  await notifyAuction(
    auction.sellerId,
    'Your auction was cancelled',
    `Auction ${auction.auctionNumber} was cancelled. Reason: ${reason}`,
    auction.id
  );

  await recordAudit({
    action: AUDIT_ACTION.AUCTION_CANCEL,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    before: { status: auction.status },
    after: { status: updated.status, reason, hadWinner },
    req,
  });

  emitAuctionEvent(auction.id, 'auction:ended', {
    ...auctionService.auctionPublicState(updated),
    result: AUCTION_RESULT.CANCELLED,
  });
  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Auction cancelled');
});

/** POST /admin/auctions/:id/payment-received — winner paid. */
const paymentReceived = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);
  if (auction.status !== AUCTION_STATUS.AWAITING_PAYMENT) {
    throw ApiError.conflict(
      `Payment can only be recorded while awaiting payment (status: ${auction.status})`
    );
  }

  const updated = await auctionsRepo.updateById(auction.id, {
    status: AUCTION_STATUS.AWAITING_PICKUP,
  });

  const full = await auctionsRepo.findById(auction.id, { variant: 'admin' });
  const orderId = full.order ? full.order.id : null;
  if (orderId) {
    const order = await ordersRepo.findById(orderId);
    if (order) {
      await ordersRepo.updateById(order.id, {
        paymentStatus: 'PAID',
        paymentProvider: req.body.provider || 'MANUAL',
        paymentReference: req.body.reference || '',
        paymentPaidAt: new Date(),
        status: ORDER_STATUS.PROCESSING,
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          {
            status: ORDER_STATUS.PROCESSING,
            at: new Date(),
            by: req.user.id,
            note: `Payment received for auction ${auction.auctionNumber}`,
          },
        ],
      });
      await notifyOrder(
        order.buyerId,
        'Payment recorded',
        `Payment for auction ${auction.auctionNumber} (order ${order.orderNumber}) was recorded. We will arrange pickup.`,
        order.id
      );
    }
  }

  await notifyAuction(
    auction.sellerId,
    'Auction payment received',
    `The buyer of auction ${auction.auctionNumber} has paid. Pickup can now be arranged.`,
    auction.id
  );
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_PAYMENT,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    after: {
      status: updated.status,
      provider: req.body.provider || 'MANUAL',
      reference: req.body.reference || '',
    },
    req,
  });

  emitAuctionEvent(auction.id, 'auction:state', auctionService.auctionPublicState(updated));
  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Payment recorded');
});

/**
 * POST /admin/auctions/:id/complete — pickup verified.
 * If the verified quantity differs from the listed quantity, the settlement is
 * recomputed and the adjustment recorded on the auction and the order.
 */
const completeAuction = asyncHandler(async (req, res) => {
  const auction = await loadRaw(req.params.id);
  if (auction.status !== AUCTION_STATUS.AWAITING_PICKUP) {
    throw ApiError.conflict(
      `Auction can only be completed while awaiting pickup (status: ${auction.status})`
    );
  }

  const verifiedKg =
    req.body.verifiedQuantityKg != null
      ? Number(req.body.verifiedQuantityKg)
      : Number(auction.quantityKg);
  const adjustments = Array.isArray(auction.adjustments) ? [...auction.adjustments] : [];
  let settlement = auction.settlement || {};
  let winningTotalPaise = auction.winningTotalPaise;

  if (verifiedKg !== Number(auction.quantityKg) && auction.winningBidPerKgPaise != null) {
    const pricingConfig = await pricingRepo.getActive(auction.materialCategoryId);
    const previous = settlement;
    const recomputed = auctionService.buildSettlement({
      auction,
      winningBidPerKgPaise: auction.winningBidPerKgPaise,
      quantityKg: verifiedKg,
      pricingConfig,
    });
    recomputed.quantitySource = 'VERIFIED';
    settlement = recomputed;
    winningTotalPaise = recomputed.grossPaise;
    adjustments.push({
      at: new Date(),
      by: req.user.id,
      fromQuantityKg: auction.quantityKg,
      toQuantityKg: verifiedKg,
      note: req.body.note || 'Verified at pickup',
      previous: {
        grossPaise: previous.grossPaise ?? null,
        taxPaise: previous.taxPaise ?? null,
        buyerPayablePaise: previous.buyerPayablePaise ?? null,
        sellerPayoutPaise: previous.sellerPayoutPaise ?? null,
      },
      updated: {
        grossPaise: recomputed.grossPaise,
        taxPaise: recomputed.taxPaise,
        buyerPayablePaise: recomputed.buyerPayablePaise,
        sellerPayoutPaise: recomputed.sellerPayoutPaise,
      },
    });
  }

  const updated = await auctionsRepo.updateById(auction.id, {
    status: AUCTION_STATUS.COMPLETED,
    completedAt: new Date(),
    settlement,
    adjustments,
    winningTotalPaise,
  });

  // Order → delivered; quantities reflect the verified weight.
  const full = await auctionsRepo.findById(auction.id, { variant: 'admin' });
  const orderId = full.order ? full.order.id : null;
  if (orderId) {
    const order = await ordersRepo.findById(orderId);
    if (order) {
      const items = Array.isArray(order.items) ? [...order.items] : [];
      if (items[0]) {
        items[0] = {
          ...items[0],
          weightKg: verifiedKg,
          subtotalPaise: settlement.grossPaise ?? items[0].subtotalPaise,
          fulfilledWeightKg: verifiedKg,
        };
      }
      await ordersRepo.updateById(order.id, {
        items,
        materialSubtotalPaise: settlement.grossPaise ?? order.materialSubtotalPaise,
        taxPaise: settlement.taxPaise ?? order.taxPaise,
        totalPaise: settlement.buyerPayablePaise ?? order.totalPaise,
        status: ORDER_STATUS.DELIVERED,
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          {
            status: ORDER_STATUS.DELIVERED,
            at: new Date(),
            by: req.user.id,
            note: `Auction completed — verified ${verifiedKg} kg`,
          },
        ],
        notes:
          `${order.notes}\nAdjustment: verified quantity ${verifiedKg} kg (listed ${auction.quantityKg} kg).`.trim(),
      });
    }
  }

  // The material record is now fully sold.
  await submissionsRepo.updateById(auction.submissionId, {
    status: SUBMISSION_STATUS.PURCHASED,
    acceptedQuantityKg: verifiedKg,
  });

  await notifyAuction(
    auction.sellerId,
    'Auction completed',
    `Auction ${auction.auctionNumber} is complete. Final quantity ${verifiedKg} kg. Payout: ${rupees(settlement.sellerPayoutPaise ?? 0)}.`,
    auction.id
  );
  if (auction.winnerId) {
    await notifyAuction(
      auction.winnerId,
      'Your auction order is complete',
      `Auction ${auction.auctionNumber} is complete. Final amount: ${rupees(settlement.buyerPayablePaise ?? 0)}.`,
      auction.id
    );
  }
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_COMPLETE,
    resourceType: 'WasteAuction',
    resourceId: auction.id,
    after: { status: updated.status, verifiedQuantityKg: verifiedKg, settlement },
    req,
  });

  emitAuctionEvent(auction.id, 'auction:state', auctionService.auctionPublicState(updated));
  return ok(res, { auction: serializeAuction(updated, { variant: 'admin' }) }, 'Auction completed');
});

/** GET /admin/auction-settings */
const getSettings = asyncHandler(async (_req, res) => {
  const settings = await auctionSettingsRepo.get();
  return ok(res, { settings: serializeAuctionSettings(settings) });
});

/** PATCH /admin/auction-settings */
const updateSettings = asyncHandler(async (req, res) => {
  const current = await auctionSettingsRepo.get();

  const merged = {
    minAuctionQuantityKg: req.body.minAuctionQuantityKg ?? current.minAuctionQuantityKg,
    sellerCanChooseDuration: req.body.sellerCanChooseDuration ?? current.sellerCanChooseDuration,
    defaultDurationMinutes: req.body.defaultDurationMinutes ?? current.defaultDurationMinutes,
    minDurationMinutes: req.body.minDurationMinutes ?? current.minDurationMinutes,
    maxDurationMinutes: req.body.maxDurationMinutes ?? current.maxDurationMinutes,
    allowedDurationsMinutes: req.body.allowedDurationsMinutes ?? current.allowedDurationsMinutes,
    minIncrementType: req.body.minIncrementType ?? current.minIncrementType,
    minIncrementValue: req.body.minIncrementValue ?? current.minIncrementValue,
    antiSnipingEnabled: req.body.antiSnipingEnabled ?? current.antiSnipingEnabled,
    antiSnipingWindowSeconds: req.body.antiSnipingWindowSeconds ?? current.antiSnipingWindowSeconds,
    antiSnipingExtensionSeconds:
      req.body.antiSnipingExtensionSeconds ?? current.antiSnipingExtensionSeconds,
  };

  if (merged.minDurationMinutes > merged.defaultDurationMinutes) {
    throw ApiError.badRequest('Default duration cannot be below the minimum duration');
  }
  if (merged.defaultDurationMinutes > merged.maxDurationMinutes) {
    throw ApiError.badRequest('Default duration cannot exceed the maximum duration');
  }
  const allowed = Array.isArray(merged.allowedDurationsMinutes)
    ? merged.allowedDurationsMinutes.map(Number)
    : [];
  if (allowed.some((d) => d < merged.minDurationMinutes || d > merged.maxDurationMinutes)) {
    throw ApiError.badRequest('Allowed durations must fall within the min/max duration bounds');
  }

  const data = {};
  for (const key of Object.keys(merged)) {
    if (req.body[key] === undefined) continue;
    data[key] = key === 'allowedDurationsMinutes' ? allowed : req.body[key];
  }
  data.updatedById = req.user.id;

  const updated = await auctionSettingsRepo.update(current.id, data);
  await recordAudit({
    action: AUDIT_ACTION.AUCTION_SETTINGS_UPDATE,
    resourceType: 'AuctionSettings',
    resourceId: current.id,
    before: serializeAuctionSettings(current),
    after: serializeAuctionSettings(updated),
    req,
  });

  return ok(res, { settings: serializeAuctionSettings(updated) }, 'Auction settings updated');
});

module.exports = {
  listAuctions,
  getAuction,
  getAuctionBids,
  approveAuction,
  rejectAuction,
  updateAuction,
  cancelAuction,
  paymentReceived,
  completeAuction,
  getSettings,
  updateSettings,
};
