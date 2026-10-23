'use strict';

const { prisma } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { generateReference, newId } = require('../utils/idGenerator');
const {
  ORDER_STATUS,
  INSPECTION_STATUS,
  DELIVERY_CHARGE_STATUS,
  INVENTORY_MOVEMENT_TYPE,
} = require('../utils/constants');

function normalizedIdempotencyKey(value) {
  const key = String(value || '').trim();
  return key || null;
}

async function findByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  return prisma.order.findUnique({ where: { idempotencyKey } });
}

async function createReservedOrder({
  buyerId,
  idempotencyKey,
  delivery,
  notes = '',
  items,
  materialSubtotalPaise,
  taxPercent,
  taxPaise,
  totalPaise,
}) {
  const key = normalizedIdempotencyKey(idempotencyKey);
  if (key) {
    const existing = await findByIdempotencyKey(key);
    if (existing) return { order: existing, duplicate: true };
  }

  const sellerIds = [...new Set(items.map((item) => String(item.lot.sellerId)))];
  if (sellerIds.length !== 1) {
    throw ApiError.badRequest('An order can only contain materials from one seller');
  }
  if (sellerIds[0] === String(buyerId)) {
    throw ApiError.badRequest('You cannot purchase your own material');
  }

  const orderId = newId();
  const orderNumber = generateReference('ORD');
  const now = new Date();
  const sellerId = items[0].lot.sellerId;

  const orderItems = items.map((item) => ({
    listing: item.listing.id,
    inventoryLot: item.lot.id,
    materialName: item.listing.title,
    materialType: item.listing.materialType,
    qualityGrade: item.listing.qualityGrade,
    condition: item.listing.condition,
    weightKg: item.weightKg,
    unitPricePaise: item.listing.pricePerKgPaise,
    subtotalPaise: Math.round(item.weightKg * item.listing.pricePerKgPaise),
    reservedWeightKg: item.weightKg,
    fulfilledWeightKg: 0,
  }));

  try {
    const order = await prisma.$transaction(async (tx) => {
      // The order row goes in first: inventory movements and the inspection
      // record both carry a foreign key to it, and Postgres checks those
      // immediately inside the transaction.
      const created = await tx.order.create({
        data: {
          id: orderId,
          orderNumber,
          buyerId,
          sellerId,
          idempotencyKey: key,
          delivery,
          items: orderItems,
          materialSubtotalPaise,
          taxPercent,
          taxPaise,
          transportationPaise: 0,
          otherFeesPaise: 0,
          totalPaise,
          quoteIsProvisional: true,
          status: ORDER_STATUS.PENDING_ADMIN_APPROVAL,
          statusHistory: [
            {
              status: ORDER_STATUS.PENDING_ADMIN_APPROVAL,
              at: now,
              by: buyerId,
              note: 'Purchase request submitted',
            },
          ],
          notes: notes || '',
          inventoryReserved: true,
          inventoryCommitted: false,
          inspectionStatus: INSPECTION_STATUS.PENDING,
          deliveryChargePaise: 0,
          deliveryChargeStatus: DELIVERY_CHARGE_STATUS.NOT_SET,
        },
      });

      await tx.inspection.create({
        data: {
          id: newId(),
          orderId: created.id,
          status: INSPECTION_STATUS.PENDING,
        },
      });

      for (const item of items) {
        const reserved = await tx.inventoryLot.updateMany({
          where: {
            id: item.lot.id,
            availableQuantityKg: { gte: item.weightKg },
          },
          data: {
            availableQuantityKg: { decrement: item.weightKg },
            reservedQuantityKg: { increment: item.weightKg },
          },
        });

        if (reserved.count === 0) {
          throw ApiError.conflict(
            `Only ${item.lot.availableQuantityKg} kg of "${item.listing.title}" is currently available`
          );
        }

        const lot = await tx.inventoryLot.findUnique({ where: { id: item.lot.id } });
        if (!lot) throw ApiError.conflict('Inventory for a selected material is unavailable');

        await tx.inventoryMovement.create({
          data: {
            id: newId(),
            lotId: lot.id,
            type: INVENTORY_MOVEMENT_TYPE.RESERVE,
            quantityKg: item.weightKg,
            balanceAvailableKg: lot.availableQuantityKg,
            balanceReservedKg: lot.reservedQuantityKg,
            balanceSoldKg: lot.soldQuantityKg,
            reason: 'Reserved for order',
            orderId,
            actorId: buyerId,
          },
        });

        await tx.marketplaceListing.updateMany({
          where: { inventoryLotId: lot.id },
          data: {
            acceptedQuantityKg: lot.acceptedQuantityKg,
            availableQuantityKg: lot.availableQuantityKg,
            reservedQuantityKg: lot.reservedQuantityKg,
            soldQuantityKg: lot.soldQuantityKg,
          },
        });
      }

      return created;
    });

    return { order, duplicate: false };
  } catch (err) {
    if (key && err.code === 'P2002') {
      const existing = await findByIdempotencyKey(key);
      if (existing) return { order: existing, duplicate: true };
    }
    throw err;
  }
}

module.exports = { createReservedOrder };
