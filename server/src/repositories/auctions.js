'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');
const { AUCTION_STATUS } = require('../utils/constants');

/** Waste auctions: the source of truth for timer, highest bid and winner. */

function create(data, client = prisma) {
  return client.wasteAuction.create({ data: { id: newId(), ...data } });
}

const PUBLIC_INCLUDE = {
  materialCategory: { select: { id: true, name: true, slug: true } },
};

const OWNER_INCLUDE = {
  ...PUBLIC_INCLUDE,
  submission: { select: { id: true, submissionNumber: true, status: true } },
};

const ADMIN_INCLUDE = {
  ...PUBLIC_INCLUDE,
  submission: {
    select: {
      id: true,
      submissionNumber: true,
      status: true,
      demandedTotalPaise: true,
      demandedPerKgPaise: true,
    },
  },
  seller: { select: { id: true, name: true, email: true, phone: true, address: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  winner: { select: { id: true, name: true, email: true, phone: true } },
  order: {
    select: { id: true, orderNumber: true, status: true, paymentStatus: true, totalPaise: true },
  },
};

function includeFor(variant) {
  if (variant === 'owner') return OWNER_INCLUDE;
  if (variant === 'admin') return ADMIN_INCLUDE;
  return PUBLIC_INCLUDE; // 'public'
}

function findById(id, { variant = 'public' } = {}) {
  return prisma.wasteAuction.findUnique({ where: { id }, include: includeFor(variant) });
}

/** Raw row without relations — used by transactional logic. */
function findRawById(id) {
  return prisma.wasteAuction.findUnique({ where: { id } });
}

function findBySubmissionId(submissionId) {
  return prisma.wasteAuction.findUnique({ where: { submissionId } });
}

function findByOrderId(orderId) {
  return prisma.wasteAuction.findFirst({ where: { order: { id: orderId } } });
}

function buildWhere({
  status,
  statuses,
  categoryId,
  materialType,
  search,
  sellerId,
  city,
  bidMin,
  bidMax,
  quantityMin,
  quantityMax,
} = {}) {
  const where = {};
  if (status) where.status = status;
  if (statuses && statuses.length) where.status = { in: statuses };
  if (categoryId) where.materialCategoryId = categoryId;
  if (materialType) where.materialType = { contains: materialType, mode: 'insensitive' };
  if (sellerId) where.sellerId = sellerId;
  if (search) {
    where.OR = [
      { auctionNumber: { contains: search, mode: 'insensitive' } },
      { materialType: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (city) where.location = { path: ['city'], string_contains: city };
  if (bidMin != null || bidMax != null) {
    where.currentHighestBidPerKgPaise = {};
    if (bidMin != null) where.currentHighestBidPerKgPaise.gte = bidMin;
    if (bidMax != null) where.currentHighestBidPerKgPaise.lte = bidMax;
  }
  if (quantityMin != null || quantityMax != null) {
    where.quantityKg = {};
    if (quantityMin != null) where.quantityKg.gte = quantityMin;
    if (quantityMax != null) where.quantityKg.lte = quantityMax;
  }
  return where;
}

async function list({
  skip = 0,
  take = 12,
  orderBy = { createdAt: 'desc' },
  variant = 'public',
  ...filters
} = {}) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.wasteAuction.findMany({ where, orderBy, skip, take, include: includeFor(variant) }),
    prisma.wasteAuction.count({ where }),
  ]);
  return { rows, total };
}

async function updateById(id, data) {
  try {
    return await prisma.wasteAuction.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

/**
 * Claims a scheduled auction for activation. The conditional update makes the
 * SCHEDULED → ACTIVE transition fire exactly once even with several workers.
 */
function claimForActivation(id) {
  return prisma.wasteAuction.updateMany({
    where: { id, status: AUCTION_STATUS.SCHEDULED, startAt: { lte: new Date() } },
    data: { status: AUCTION_STATUS.ACTIVE },
  });
}

function findDueForActivation(now = new Date()) {
  return prisma.wasteAuction.findMany({
    where: { status: AUCTION_STATUS.SCHEDULED, startAt: { lte: now } },
    select: { id: true },
  });
}

function findDueForFinalization(now = new Date()) {
  return prisma.wasteAuction.findMany({
    where: { status: AUCTION_STATUS.ACTIVE, endAt: { lte: now } },
    select: { id: true },
  });
}

function count(where = {}) {
  return prisma.wasteAuction.count({ where });
}

module.exports = {
  create,
  findById,
  findRawById,
  findBySubmissionId,
  findByOrderId,
  list,
  updateById,
  claimForActivation,
  findDueForActivation,
  findDueForFinalization,
  count,
};
