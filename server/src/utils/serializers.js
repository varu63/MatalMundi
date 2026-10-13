'use strict';

/**
 * Response shapers for every model.
 *
 * The API used to be backed by Mongoose, where documents serialized with an
 * `id` virtual (toJSON) while `.lean()` rows exposed `_id`. To stay a strict
 * superset of both shapes — and keep every existing frontend/tests consumer
 * working — each object is serialized with BOTH `id` and `_id` (same 24-char
 * hex value).
 *
 * Populated relations (Prisma `include`) render as nested objects; plain
 * foreign keys render as id strings, exactly like Mongoose populate/lean.
 */

const ADDRESS_DEFAULTS = Object.freeze({
  line1: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
});

const { minNextBidPaise } = require('./auctionMath');

function normalizeAddress(address) {
  if (!address || typeof address !== 'object') return { ...ADDRESS_DEFAULTS };
  return { ...ADDRESS_DEFAULTS, ...address };
}

/** Drops `undefined` values so responses mirror Mongoose's omitted fields. */
function defined(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    ...defined({
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      address: normalizeAddress(row.address),
      accountStatus: row.accountStatus,
      emailVerified: Boolean(row.emailVerificationVerified),
      lastLoginAt: row.lastLoginAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
  };
}

/** Subset of a user embedded inside another document (populate equivalent). */
function userRef(row) {
  return {
    id: row.id,
    _id: row.id,
    ...defined({
      name: row.name,
      email: row.email,
      phone: row.phone,
      address: row.address !== undefined ? normalizeAddress(row.address) : undefined,
      role: row.role,
      accountStatus: row.accountStatus,
    }),
  };
}

/** `row[key]` is an included relation object (or null), else fall back to FK. */
function relation(row, key, refSerializer) {
  const included = row[key];
  if (included && typeof included === 'object') return refSerializer(included);
  return row[`${key}Id`] ?? undefined;
}

function serializeCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function categoryRef(row) {
  return {
    id: row.id,
    _id: row.id,
    ...defined({ name: row.name, slug: row.slug }),
  };
}

function serializePricing(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    ratePerKgPaise: row.ratePerKgPaise,
    qualityMultipliers: row.qualityMultipliers || {},
    basePickupChargePaise: row.basePickupChargePaise,
    perKmChargePaise: row.perKmChargePaise,
    platformFeePercent: row.platformFeePercent,
    taxPercent: row.taxPercent,
    version: row.version,
    active: row.active,
    notes: row.notes,
    updatedBy: relation(row, 'updatedBy', userRef),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSubmission(row) {
  if (!row) return null;
  const images = row.images && typeof row.images === 'object' ? row.images : {};
  return {
    id: row.id,
    _id: row.id,
    submissionNumber: row.submissionNumber,
    seller: relation(row, 'seller', userRef),
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    quantityKg: row.quantityKg,
    condition: row.condition,
    qualityGrade: row.qualityGrade,
    description: row.description,
    images: {
      front: images.front,
      back: images.back,
      left: images.left,
      right: images.right,
      weightEvidence: images.weightEvidence,
      additional: images.additional || [],
    },
    pickup: row.pickup || {},
    demandBasis: row.demandBasis,
    demandedTotalPaise: row.demandedTotalPaise,
    demandedPerKgPaise: row.demandedPerKgPaise,
    valuation: row.valuation || {},
    proposedPurchasePricePaise: row.proposedPurchasePricePaise,
    proposedPurchasePriceSetBy: relation(row, 'proposedPurchasePriceSetBy', userRef),
    proposedPurchasePriceSetAt: row.proposedPurchasePriceSetAt ?? undefined,
    acceptedQuantityKg: row.acceptedQuantityKg,
    status: row.status,
    saleMode: row.saleMode || 'NORMAL',
    rejectionReason: row.rejectionReason,
    adminNotes: row.adminNotes || [],
    reviewedBy: relation(row, 'reviewedBy', userRef),
    reviewedAt: row.reviewedAt ?? undefined,
    approvedBy: relation(row, 'approvedBy', userRef),
    approvedAt: row.approvedAt ?? undefined,
    collectedBy: relation(row, 'collectedBy', userRef),
    collectedAt: row.collectedAt ?? undefined,
    pickupDate: row.pickupDate ?? undefined,
    inventoryLot: relation(row, 'inventoryLot', lotRefByIdOnly),
    listing: relation(row, 'listing', listingRefByIdOnly),
    auction: relation(row, 'auction', auctionRef),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// A submission's lot/listing relation is an id-shaped string when serialized
// inside lists (lean equivalent) and a full object in detail views.
function lotRefByIdOnly(row) {
  if (Object.keys(row).length <= 1 && row.id) return row.id;
  return serializeLot(row);
}

function listingRefByIdOnly(row) {
  if (Object.keys(row).length <= 1 && row.id) return row.id;
  return serializeListing(row);
}

function serializeLot(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    lotNumber: row.lotNumber,
    sourceSubmission: relation(row, 'sourceSubmission', submissionRef),
    seller: relation(row, 'seller', userRef),
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    qualityGrade: row.qualityGrade,
    condition: row.condition,
    acceptedQuantityKg: row.acceptedQuantityKg,
    availableQuantityKg: row.availableQuantityKg,
    reservedQuantityKg: row.reservedQuantityKg,
    soldQuantityKg: row.soldQuantityKg,
    location: row.location || {},
    lotStatus: row.lotStatus,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function submissionRef(row) {
  return {
    id: row.id,
    _id: row.id,
    ...defined({
      submissionNumber: row.submissionNumber,
      seller: row.seller !== undefined ? relation(row, 'seller', userRef) : undefined,
      status: row.status,
    }),
  };
}

function serializeListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    title: row.title,
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    description: row.description,
    images: row.images || [],
    inventoryLot: relation(row, 'inventoryLot', lotRefByIdOnly),
    sourceSubmission: relation(row, 'sourceSubmission', submissionRef),
    qualityGrade: row.qualityGrade,
    condition: row.condition,
    pricePerKgPaise: row.pricePerKgPaise,
    minPurchaseKg: row.minPurchaseKg,
    acceptedQuantityKg: row.acceptedQuantityKg,
    availableQuantityKg: row.availableQuantityKg,
    reservedQuantityKg: row.reservedQuantityKg,
    soldQuantityKg: row.soldQuantityKg,
    location: row.location || {},
    deliveryTerms: row.deliveryTerms,
    publicationStatus: row.publicationStatus,
    active: row.active,
    publishedBy: relation(row, 'publishedBy', userRef),
    publishedAt: row.publishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Public marketplace projection. Never exposes the seller, pickup address or
 * any stock-lot internals — only the fields the original `select(PUBLIC_FIELDS)`
 * allowed, plus the populated category.
 */
function serializeListingPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    title: row.title,
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    qualityGrade: row.qualityGrade,
    condition: row.condition,
    description: row.description,
    images: row.images || [],
    pricePerKgPaise: row.pricePerKgPaise,
    minPurchaseKg: row.minPurchaseKg,
    acceptedQuantityKg: row.acceptedQuantityKg,
    availableQuantityKg: row.availableQuantityKg,
    location: row.location || {},
    deliveryTerms: row.deliveryTerms,
    publicationStatus: row.publicationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeOrder(row) {
  if (!row) return null;
  const listingMap = row._listingMap || {};
  const lotMap = row._lotMap || {};
  return {
    id: row.id,
    _id: row.id,
    orderNumber: row.orderNumber,
    buyer: relation(row, 'buyer', userRef),
    delivery: row.delivery || {},
    items: (Array.isArray(row.items) ? row.items : []).map((item) => ({
      listing:
        item.listing && listingMap[item.listing]
          ? serializeListing(listingMap[item.listing])
          : item.listing,
      inventoryLot:
        item.inventoryLot && lotMap[item.inventoryLot]
          ? serializeLot(lotMap[item.inventoryLot])
          : item.inventoryLot,
      materialName: item.materialName,
      materialType: item.materialType,
      qualityGrade: item.qualityGrade,
      condition: item.condition,
      weightKg: item.weightKg,
      unitPricePaise: item.unitPricePaise,
      subtotalPaise: item.subtotalPaise,
      reservedWeightKg: item.reservedWeightKg,
      fulfilledWeightKg: item.fulfilledWeightKg,
      sourceAuctionId: item.sourceAuctionId ?? undefined,
    })),
    materialSubtotalPaise: row.materialSubtotalPaise,
    taxPercent: row.taxPercent,
    taxPaise: row.taxPaise,
    transportationPaise: row.transportationPaise,
    otherFeesPaise: row.otherFeesPaise,
    totalPaise: row.totalPaise,
    quoteIsProvisional: row.quoteIsProvisional,
    status: row.status,
    statusHistory: row.statusHistory || [],
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    adminNotes: row.adminNotes,
    inventoryReserved: row.inventoryReserved,
    inventoryCommitted: row.inventoryCommitted,
    // Present only on orders created by winning an auction.
    auction: row.auctionId ?? undefined,
    payment: defined({
      status: row.paymentStatus,
      provider: row.paymentProvider,
      reference: row.paymentReference,
      paidAt: row.paymentPaidAt ?? undefined,
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Auctions ────────────────────────────────────────────────────────────────

function auctionImages(images) {
  const src = images && typeof images === 'object' ? images : {};
  return {
    front: src.front,
    back: src.back,
    left: src.left,
    right: src.right,
    weightEvidence: src.weightEvidence,
    additional: src.additional || [],
  };
}

/** Compact auction reference embedded in other documents (e.g. submissions). */
function auctionRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    ...defined({
      auctionNumber: row.auctionNumber,
      status: row.status,
      startAt: row.startAt ?? undefined,
      endAt: row.endAt ?? undefined,
      currentHighestBidPerKgPaise: row.currentHighestBidPerKgPaise ?? undefined,
      startingPricePerKgPaise: row.startingPricePerKgPaise,
    }),
  };
}

/**
 * Auction response shaper.
 *
 * Privacy rules (mirrors the spec):
 *  - 'public'  → no reserve price, no seller's expected/minimum prices, no
 *    seller identity, no settlement, no bidder data.
 *  - 'owner'   → the seller's own view: price signals + settlement + winner.
 *  - 'admin'   → everything, including seller, decisions and current order.
 */
function serializeAuction(row, { variant = 'public' } = {}) {
  if (!row) return null;
  const isOwner = variant === 'owner';
  const isAdmin = variant === 'admin';
  const sensitive = isOwner || isAdmin;

  const base = {
    id: row.id,
    _id: row.id,
    auctionNumber: row.auctionNumber,
    materialCategory: relation(row, 'materialCategory', categoryRef),
    materialType: row.materialType,
    quantityKg: row.quantityKg,
    condition: row.condition,
    qualityGrade: row.qualityGrade,
    images: auctionImages(row.images),
    location: row.location || {},
    inspectionNotes: row.inspectionNotes,
    startingPricePerKgPaise: row.startingPricePerKgPaise,
    currentHighestBidPerKgPaise: row.currentHighestBidPerKgPaise ?? null,
    minNextBidPaise: minNextBidPaise(row),
    minIncrementType: row.minIncrementType,
    minIncrementValue: row.minIncrementValue,
    durationMinutes: row.durationMinutes,
    status: row.status,
    startAt: row.startAt ?? undefined,
    endAt: row.endAt ?? undefined,
    extensionCount: row.extensionCount,
    antiSnipingEnabled: row.antiSnipingEnabled,
    bidCount: row.bidCount,
    bidderCount: row.bidderCount,
    winnerSelectionReason: row.winnerSelectionReason || undefined,
    winningBidPerKgPaise: row.winningBidPerKgPaise ?? undefined,
    winningTotalPaise: row.winningTotalPaise ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canBid:
      row.status === 'ACTIVE' && row.endAt != null && new Date(row.endAt).getTime() > Date.now(),
  };

  if (sensitive) {
    base.sellerId = row.sellerId; // owner/admin views only — never public
    base.expectedPricePerKgPaise = row.expectedPricePerKgPaise;
    base.minAcceptableBidPerKgPaise = row.minAcceptableBidPerKgPaise;
    base.reservePricePerKgPaise = row.reservePricePerKgPaise ?? null;
    base.settlement = row.settlement || {};
    base.adjustments = row.adjustments || [];
    base.rejectionReason = row.rejectionReason || undefined;
    base.cancellationReason = row.cancellationReason || undefined;
    base.finalizedAt = row.finalizedAt ?? undefined;
    base.completedAt = row.completedAt ?? undefined;
    base.winner = relation(row, 'winner', userRef);
    base.order = row.order
      ? {
          id: row.order.id,
          _id: row.order.id,
          orderNumber: row.order.orderNumber,
          status: row.order.status,
          paymentStatus: row.order.paymentStatus,
          totalPaise: row.order.totalPaise,
        }
      : undefined;
  }

  if (isOwner || isAdmin) {
    base.submission = relation(row, 'submission', submissionRef);
  }

  if (isAdmin) {
    base.seller = relation(row, 'seller', userRef);
    base.approvedBy = relation(row, 'approvedBy', userRef);
    base.approvedAt = row.approvedAt ?? undefined;
    base.rejectedBy = relation(row, 'rejectedBy', userRef);
    base.rejectedAt = row.rejectedAt ?? undefined;
    base.cancelledBy = relation(row, 'cancelledBy', userRef);
    base.cancelledAt = row.cancelledAt ?? undefined;
  }

  return base;
}

/**
 * Bid response shaper. Bidder identity is revealed only to the bidder themself
 * (`isOwn`), to admins, and to the seller after the auction has concluded
 * (`revealIdentities` — the seller needs the winner for logistics).
 */
function serializeAuctionBid(
  row,
  { viewerId = null, isAdmin = false, revealIdentities = false } = {}
) {
  if (!row) return null;
  const isOwn = viewerId != null && String(row.bidderId) === String(viewerId);
  const reveal = isAdmin || isOwn || revealIdentities;
  return {
    id: row.id,
    _id: row.id,
    auction: row.auctionId,
    ...defined({
      bidder: row.bidder ? userRef(row.bidder) : reveal ? row.bidderId : undefined,
      bidderId: reveal ? row.bidderId : undefined,
    }),
    bidPerKgPaise: row.bidPerKgPaise,
    totalBidValuePaise: row.totalBidValuePaise,
    status: row.status,
    isOwn,
    anonymous: !reveal,
    createdAt: row.createdAt,
  };
}

function serializeAuctionSettings(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    minAuctionQuantityKg: row.minAuctionQuantityKg,
    sellerCanChooseDuration: row.sellerCanChooseDuration,
    defaultDurationMinutes: row.defaultDurationMinutes,
    minDurationMinutes: row.minDurationMinutes,
    maxDurationMinutes: row.maxDurationMinutes,
    allowedDurationsMinutes: Array.isArray(row.allowedDurationsMinutes)
      ? row.allowedDurationsMinutes
      : [],
    minIncrementType: row.minIncrementType,
    minIncrementValue: row.minIncrementValue,
    antiSnipingEnabled: row.antiSnipingEnabled,
    antiSnipingWindowSeconds: row.antiSnipingWindowSeconds,
    antiSnipingExtensionSeconds: row.antiSnipingExtensionSeconds,
    updatedBy: relation(row, 'updatedBy', userRef),
    updatedAt: row.updatedAt,
  };
}

function serializeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    user: row.userId,
    title: row.title,
    message: row.message,
    type: row.type,
    relatedType: row.relatedType,
    relatedId: row.relatedId ?? undefined,
    read: row.read,
    createdAt: row.createdAt,
  };
}

function serializeAuditLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    actor: relation(row, 'actor', userRef),
    actorRole: row.actorRole,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? undefined,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    meta: row.meta ?? undefined,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

function serializeMovement(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    lot: row.lotId,
    type: row.type,
    quantityKg: row.quantityKg,
    balanceAvailableKg: row.balanceAvailableKg,
    balanceReservedKg: row.balanceReservedKg,
    balanceSoldKg: row.balanceSoldKg,
    reason: row.reason,
    order: row.orderId ?? undefined,
    actor: row.actorId ?? undefined,
    createdAt: row.createdAt,
  };
}

module.exports = {
  ADDRESS_DEFAULTS,
  normalizeAddress,
  serializeUser,
  userRef,
  serializeCategory,
  categoryRef,
  serializePricing,
  serializeSubmission,
  serializeLot,
  serializeListing,
  serializeListingPublic,
  serializeOrder,
  serializeNotification,
  serializeAuditLog,
  serializeMovement,
  auctionRef,
  serializeAuction,
  serializeAuctionBid,
  serializeAuctionSettings,
};
