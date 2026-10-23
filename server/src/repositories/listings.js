'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Marketplace listings (public catalogue + admin management). */

function create(data) {
  return prisma.marketplaceListing.create({ data: { id: newId(), ...data } });
}

const PUBLIC_INCLUDE = {
  materialCategory: { select: { id: true, name: true, slug: true } },
};

const ADMIN_LIST_INCLUDE = {
  materialCategory: { select: { id: true, name: true } },
  inventoryLot: {
    select: {
      id: true,
      lotNumber: true,
      lotStatus: true,
      soldQuantityKg: true,
      reservedQuantityKg: true,
    },
  },
};

const ADMIN_DETAIL_INCLUDE = {
  materialCategory: { select: { id: true, name: true, slug: true } },
  inventoryLot: true,
  sourceSubmission: { select: { id: true, submissionNumber: true } },
};

/** Listings visible on the public marketplace (caller builds the full filter). */
async function listPublic({ where, orderBy, skip = 0, take = 12 }) {
  const [rows, total] = await Promise.all([
    prisma.marketplaceListing.findMany({
      where,
      orderBy,
      skip,
      take,
      include: PUBLIC_INCLUDE,
    }),
    prisma.marketplaceListing.count({ where }),
  ]);
  return { rows, total };
}

function listPublicAll({ where, orderBy }) {
  return prisma.marketplaceListing.findMany({
    where,
    orderBy,
    include: PUBLIC_INCLUDE,
  });
}

function findPublicById(id, visibilityWhere = {}) {
  return prisma.marketplaceListing.findFirst({
    where: { id, ...visibilityWhere },
    include: PUBLIC_INCLUDE,
  });
}

/** Sellable listing row used by order creation. */
function findSellableById(id) {
  return prisma.marketplaceListing.findFirst({
    where: { id, active: true, publicationStatus: 'PUBLISHED' },
  });
}

function findById(id, { detail = false } = {}) {
  return prisma.marketplaceListing.findUnique({
    where: { id },
    ...(detail ? { include: ADMIN_DETAIL_INCLUDE } : {}),
  });
}

function findByInventoryLotId(inventoryLotId) {
  return prisma.marketplaceListing.findUnique({ where: { inventoryLotId } });
}

function findBySourceSubmission(submissionId) {
  return prisma.marketplaceListing.findUnique({ where: { sourceSubmissionId: submissionId } });
}

async function updateById(id, data) {
  try {
    return await prisma.marketplaceListing.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

async function updateByInventoryLotId(inventoryLotId, data) {
  const result = await prisma.marketplaceListing.updateMany({
    where: { inventoryLotId },
    data,
  });
  return result.count;
}

async function list({ publicationStatus, active, search, aiFlagged, skip = 0, take = 12 } = {}) {
  const where = {};
  if (publicationStatus) where.publicationStatus = publicationStatus;
  if (active !== undefined) where.active = active;
  if (aiFlagged !== undefined) where.imageCheckFlagged = aiFlagged;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { materialType: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.marketplaceListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: ADMIN_LIST_INCLUDE,
    }),
    prisma.marketplaceListing.count({ where }),
  ]);
  return { rows, total };
}

function count(where = {}) {
  return prisma.marketplaceListing.count({ where });
}

module.exports = {
  create,
  listPublic,
  listPublicAll,
  findPublicById,
  findSellableById,
  findById,
  findByInventoryLotId,
  findBySourceSubmission,
  updateById,
  updateByInventoryLotId,
  list,
  count,
};
