'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Waste submissions (seller → admin pipeline). */

function create(data, client = prisma) {
  return client.wasteSubmission.create({ data: { id: newId(), ...data } });
}

/**
 * Detail lookups. `include` variants mirror the original populate chains:
 *  - 'owner'  → category {name,slug}, seller {name,email,phone}, lot + listing summaries
 *  - 'admin'  → seller {name,email,phone,address}, category {name,slug}, lot + listing summaries
 *  - 'minimal' (default) → lot + listing ids only (lean-equivalent lists)
 */
const DETAIL_INCLUDE = {
  materialCategory: { select: { id: true, name: true, slug: true } },
  seller: { select: { id: true, name: true, email: true, phone: true } },
  inventoryLot: {
    select: {
      id: true,
      lotNumber: true,
      acceptedQuantityKg: true,
      availableQuantityKg: true,
      lotStatus: true,
    },
  },
  listing: {
    select: {
      id: true,
      title: true,
      pricePerKgPaise: true,
      publicationStatus: true,
      active: true,
      availableQuantityKg: true,
    },
  },
  auction: {
    select: {
      id: true,
      auctionNumber: true,
      status: true,
      startAt: true,
      endAt: true,
      startingPricePerKgPaise: true,
      currentHighestBidPerKgPaise: true,
    },
  },
};

const ADMIN_INCLUDE = {
  ...DETAIL_INCLUDE,
  seller: { select: { id: true, name: true, email: true, phone: true, address: true } },
  inventoryLot: {
    select: {
      id: true,
      lotNumber: true,
      acceptedQuantityKg: true,
      availableQuantityKg: true,
      reservedQuantityKg: true,
      soldQuantityKg: true,
      lotStatus: true,
    },
  },
};

const MINIMAL_INCLUDE = {
  inventoryLot: { select: { id: true } },
  listing: { select: { id: true } },
  auction: { select: { id: true, auctionNumber: true, status: true } },
};

function includeFor(variant) {
  if (variant === 'owner') return DETAIL_INCLUDE;
  if (variant === 'admin') return ADMIN_INCLUDE;
  return MINIMAL_INCLUDE;
}

async function findById(id, { variant = 'minimal' } = {}) {
  return prisma.wasteSubmission.findUnique({ where: { id }, include: includeFor(variant) });
}

async function list({ status, categoryId, sellerId, search, saleMode, skip = 0, take = 12, variant = 'minimal' } = {}) {
  const where = {};
  if (status) where.status = status;
  if (categoryId) where.materialCategoryId = categoryId;
  if (sellerId) where.sellerId = sellerId;
  if (saleMode) where.saleMode = saleMode;
  if (search) {
    where.OR = [
      { submissionNumber: { contains: search, mode: 'insensitive' } },
      { materialType: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.wasteSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: includeFor(variant),
    }),
    prisma.wasteSubmission.count({ where }),
  ]);
  return { rows, total };
}

/** Duplicate-submission guard (accidental double submit within seconds). */
function findRecentDuplicate({ sellerId, materialType, quantityKg, since }) {
  return prisma.wasteSubmission.findFirst({
    where: { sellerId, materialType, quantityKg, createdAt: { gte: since } },
  });
}

function findRecent(take = 5) {
  return prisma.wasteSubmission.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      seller: { select: { id: true, name: true } },
      materialCategory: { select: { id: true, name: true } },
    },
  });
}

async function updateById(id, data) {
  try {
    return await prisma.wasteSubmission.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

function count(where = {}) {
  return prisma.wasteSubmission.count({ where });
}

module.exports = {
  create,
  findById,
  list,
  findRecentDuplicate,
  findRecent,
  updateById,
  count,
};
