'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/**
 * Inventory lots — the authoritative stock record.
 *
 * Reserve/release/commit are implemented as single conditional `updateMany`
 * statements (like the old atomic `findOneAndUpdate`), so two simultaneous
 * orders can never reserve the same stock. `count === 0` means the guard
 * failed and the lot was NOT touched.
 */

function create(data) {
  return prisma.inventoryLot.create({ data: { id: newId(), ...data } });
}

const LIST_INCLUDE = {
  materialCategory: { select: { id: true, name: true } },
  seller: { select: { id: true, name: true, email: true } },
  sourceSubmission: { select: { id: true, submissionNumber: true, status: true } },
};

const DETAIL_INCLUDE = {
  materialCategory: { select: { id: true, name: true } },
  seller: { select: { id: true, name: true, email: true } },
  sourceSubmission: { select: { id: true, submissionNumber: true, status: true } },
};

function findById(id, { populate = false } = {}) {
  return prisma.inventoryLot.findUnique({
    where: { id },
    ...(populate ? { include: DETAIL_INCLUDE } : {}),
  });
}

function findBySourceSubmission(submissionId) {
  return prisma.inventoryLot.findUnique({ where: { sourceSubmissionId: submissionId } });
}

async function updateById(id, data) {
  try {
    return await prisma.inventoryLot.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

async function tryReserve(lotId, quantityKg) {
  const result = await prisma.inventoryLot.updateMany({
    where: { id: lotId, availableQuantityKg: { gte: quantityKg } },
    data: {
      availableQuantityKg: { decrement: quantityKg },
      reservedQuantityKg: { increment: quantityKg },
    },
  });
  if (result.count === 0) return null;
  return prisma.inventoryLot.findUnique({ where: { id: lotId } });
}

async function tryRelease(lotId, quantityKg) {
  const result = await prisma.inventoryLot.updateMany({
    where: { id: lotId, reservedQuantityKg: { gte: quantityKg } },
    data: {
      availableQuantityKg: { increment: quantityKg },
      reservedQuantityKg: { decrement: quantityKg },
    },
  });
  if (result.count === 0) return null;
  return prisma.inventoryLot.findUnique({ where: { id: lotId } });
}

async function tryCommit(lotId, quantityKg) {
  const result = await prisma.inventoryLot.updateMany({
    where: { id: lotId, reservedQuantityKg: { gte: quantityKg } },
    data: {
      reservedQuantityKg: { decrement: quantityKg },
      soldQuantityKg: { increment: quantityKg },
    },
  });
  if (result.count === 0) return null;
  return prisma.inventoryLot.findUnique({ where: { id: lotId } });
}

async function list({ lotStatus, materialType, skip = 0, take = 12 } = {}) {
  const where = {};
  if (lotStatus) where.lotStatus = lotStatus;
  if (materialType) where.materialType = materialType;
  const [rows, total] = await Promise.all([
    prisma.inventoryLot.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      include: LIST_INCLUDE,
    }),
    prisma.inventoryLot.count({ where }),
  ]);
  return { rows, total };
}

/** Dashboard totals across all stock. */
async function aggregateTotals() {
  const agg = await prisma.inventoryLot.aggregate({
    _sum: {
      acceptedQuantityKg: true,
      availableQuantityKg: true,
      reservedQuantityKg: true,
      soldQuantityKg: true,
    },
  });
  return {
    totalCollectedKg: agg._sum.acceptedQuantityKg || 0,
    activeInventoryKg: agg._sum.availableQuantityKg || 0,
    reservedKg: agg._sum.reservedQuantityKg || 0,
    totalSoldKg: agg._sum.soldQuantityKg || 0,
  };
}

function count(where = {}) {
  return prisma.inventoryLot.count({ where });
}

module.exports = {
  create,
  findById,
  findBySourceSubmission,
  updateById,
  tryReserve,
  tryRelease,
  tryCommit,
  list,
  aggregateTotals,
  count,
};
