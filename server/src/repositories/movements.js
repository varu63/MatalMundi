'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Stock movement log for lots (IN / RESERVE / RELEASE / COMMIT / ADJUST). */

function create({
  lotId,
  type,
  quantityKg,
  balanceAvailableKg = 0,
  balanceReservedKg = 0,
  balanceSoldKg = 0,
  reason = '',
  orderId = null,
  actorId = null,
}) {
  return prisma.inventoryMovement.create({
    data: {
      id: newId(),
      lotId,
      type,
      quantityKg,
      balanceAvailableKg,
      balanceReservedKg,
      balanceSoldKg,
      reason,
      orderId,
      actorId,
    },
  });
}

function findByLot(lotId, { take = 100 } = {}) {
  return prisma.inventoryMovement.findMany({
    where: { lotId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

module.exports = { create, findByLot };
