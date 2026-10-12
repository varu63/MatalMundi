'use strict';

const {
  InventoryLot,
  InventoryMovement,
  MarketplaceListing,
  WasteSubmission,
} = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { generateReference } = require('../utils/idGenerator');
const { INVENTORY_LOT_STATUS, INVENTORY_MOVEMENT_TYPE, LISTING_STATUS } = require('../utils/constants');

/** Records an inventory movement row (best-effort; never blocks the caller). */
async function recordMovement({ lot, type, quantityKg, lotSnapshot, reason = '', order = null, actor = null }) {
  try {
    await InventoryMovement.create({
      lot: lot || (lotSnapshot && lotSnapshot._id),
      type,
      quantityKg,
      balanceAvailableKg: lotSnapshot?.availableQuantityKg ?? 0,
      balanceReservedKg: lotSnapshot?.reservedQuantityKg ?? 0,
      balanceSoldKg: lotSnapshot?.soldQuantityKg ?? 0,
      reason,
      order,
      actor,
    });
  } catch (err) {
    logger.warn(`Inventory movement log failed: ${err.message}`);
  }
}

/**
 * Creates an inventory lot from an accepted waste submission. The accepted
 * quantity (set by the admin at collection) becomes the sellable quantity.
 */
async function createLotFromSubmission({ submission, actor }) {
  const accepted = Number(submission.acceptedQuantityKg) > 0
    ? Number(submission.acceptedQuantityKg)
    : Number(submission.quantityKg);

  const lot = await InventoryLot.create({
    lotNumber: generateReference('LOT'),
    sourceSubmission: submission._id,
    seller: submission.seller,
    materialCategory: submission.materialCategory,
    materialType: submission.materialType,
    qualityGrade: submission.qualityGrade,
    condition: submission.condition,
    acceptedQuantityKg: accepted,
    availableQuantityKg: accepted,
    reservedQuantityKg: 0,
    soldQuantityKg: 0,
    location: { city: submission.pickup?.city || '', state: submission.pickup?.state || '' },
    lotStatus: INVENTORY_LOT_STATUS.ACCEPTED,
    receivedAt: new Date(),
  });

  await recordMovement({
    lot: lot._id,
    type: INVENTORY_MOVEMENT_TYPE.IN,
    quantityKg: accepted,
    lotSnapshot: lot,
    reason: 'Stock received from accepted submission',
    actor,
  });

  return lot;
}

/** Syncs the denormalised listing cache from the authoritative lot. */
async function refreshListingCache(lot) {
  if (!lot) return;
  await MarketplaceListing.updateOne(
    { inventoryLot: lot._id },
    {
      $set: {
        acceptedQuantityKg: lot.acceptedQuantityKg,
        availableQuantityKg: lot.availableQuantityKg,
        reservedQuantityKg: lot.reservedQuantityKg,
        soldQuantityKg: lot.soldQuantityKg,
      },
    },
  );
}

/** Recomputes lot status from its balances (published vs accepted vs depleted). */
function deriveLotStatus(lot, currentListingStatus) {
  if (lot.availableQuantityKg <= 0 && lot.reservedQuantityKg <= 0) {
    return INVENTORY_LOT_STATUS.DEPLETED;
  }
  if (currentListingStatus === LISTING_STATUS.PUBLISHED) return INVENTORY_LOT_STATUS.PUBLISHED;
  return INVENTORY_LOT_STATUS.ACCEPTED;
}

/**
 * Atomically reserves `quantityKg` from a lot. Concurrency-safe: the update is
 * a single conditional `$inc`, so two simultaneous orders can never reserve the
 * same stock (no transactions / replica set required).
 */
async function reserveLot({ lotId, quantityKg, orderId = null, actor = null }) {
  const qty = Number(quantityKg);
  if (!(qty > 0)) throw ApiError.badRequest('Reservation quantity must be positive');

  const lot = await InventoryLot.findOneAndUpdate(
    { _id: lotId, availableQuantityKg: { $gte: qty } },
    { $inc: { availableQuantityKg: -qty, reservedQuantityKg: qty } },
    { new: true },
  );

  if (!lot) {
    throw ApiError.conflict('Insufficient available stock to reserve the requested quantity');
  }

  await recordMovement({
    lot: lot._id,
    type: INVENTORY_MOVEMENT_TYPE.RESERVE,
    quantityKg: qty,
    lotSnapshot: lot,
    reason: 'Reserved for order',
    order: orderId,
    actor,
  });
  await refreshListingCache(lot);
  return lot;
}

/** Atomically releases a reservation back to available stock. */
async function releaseLot({ lotId, quantityKg, orderId = null, actor = null, reason = 'Reservation released' }) {
  const qty = Number(quantityKg);
  if (!(qty > 0)) return null;

  const lot = await InventoryLot.findOneAndUpdate(
    { _id: lotId, reservedQuantityKg: { $gte: qty } },
    { $inc: { availableQuantityKg: qty, reservedQuantityKg: -qty } },
    { new: true },
  );
  if (!lot) {
    logger.warn(`Release skipped for lot ${lotId}: reserved balance too low`);
    return null;
  }

  await recordMovement({
    lot: lot._id,
    type: INVENTORY_MOVEMENT_TYPE.RELEASE,
    quantityKg: qty,
    lotSnapshot: lot,
    reason,
    order: orderId,
    actor,
  });
  await refreshListingCache(lot);
  return lot;
}

/** Atomically converts a reservation into sold stock. */
async function commitLot({ lotId, quantityKg, orderId = null, actor = null }) {
  const qty = Number(quantityKg);
  if (!(qty > 0)) return null;

  const lot = await InventoryLot.findOneAndUpdate(
    { _id: lotId, reservedQuantityKg: { $gte: qty } },
    { $inc: { reservedQuantityKg: -qty, soldQuantityKg: qty } },
    { new: true },
  );
  if (!lot) {
    logger.warn(`Commit skipped for lot ${lotId}: reserved balance too low`);
    return null;
  }

  await recordMovement({
    lot: lot._id,
    type: INVENTORY_MOVEMENT_TYPE.COMMIT,
    quantityKg: qty,
    lotSnapshot: lot,
    reason: 'Order fulfilled',
    order: orderId,
    actor,
  });
  await refreshListingCache(lot);
  return lot;
}

/**
 * Reserves every item of an order. If any reservation fails, all previously
 * reserved items in this batch are released so the order leaves no partial
 * reservations behind.
 */
async function reserveOrderItems(items, orderId, actor = null) {
  const reserved = [];
  try {
    for (const item of items) {
      // Sequential on purpose: deterministic rollback, and reservations are cheap.
      // eslint-disable-next-line no-await-in-loop
      await reserveLot({
        lotId: item.inventoryLot,
        quantityKg: item.weightKg,
        orderId,
        actor,
      });
      reserved.push(item);
    }
    return reserved;
  } catch (err) {
    for (const item of reserved) {
      // eslint-disable-next-line no-await-in-loop
      await releaseLot({
        lotId: item.inventoryLot,
        quantityKg: item.weightKg,
        orderId,
        actor,
        reason: 'Rollback of partially failed reservation',
      });
    }
    throw err;
  }
}

async function releaseOrderItems(items, orderId, actor = null, reason = 'Order reservation released') {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await releaseLot({ lotId: item.inventoryLot, quantityKg: item.weightKg, orderId, actor, reason });
  }
}

async function commitOrderItems(items, orderId, actor = null) {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await commitLot({ lotId: item.inventoryLot, quantityKg: item.weightKg, orderId, actor });
  }
}

/** Updates the lot status after a listing status change. */
async function syncLotStatusForListing(listing) {
  if (!listing || !listing.inventoryLot) return;
  const lot = await InventoryLot.findById(listing.inventoryLot);
  if (!lot) return;
  const next = deriveLotStatus(lot, listing.publicationStatus);
  if (lot.lotStatus !== next) {
    lot.lotStatus = next;
    await lot.save();
  }
  if (listing.publicationStatus === LISTING_STATUS.PUBLISHED) {
    await WasteSubmission.updateOne(
      { _id: lot.sourceSubmission },
      { $set: { status: 'PURCHASED' } },
    ).catch(() => {});
  }
}

module.exports = {
  createLotFromSubmission,
  refreshListingCache,
  reserveLot,
  releaseLot,
  commitLot,
  reserveOrderItems,
  releaseOrderItems,
  commitOrderItems,
  syncLotStatusForListing,
  recordMovement,
  deriveLotStatus,
};
