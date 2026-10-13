'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Orders (buyers' purchase requests + admin fulfilment lifecycle). */

function create(data) {
  return prisma.order.create({ data: { id: newId(), ...data } });
}

const BUYER_SELECT_BASIC = { select: { id: true, name: true, email: true, phone: true } };
const BUYER_SELECT_FULL = {
  select: { id: true, name: true, email: true, phone: true, address: true },
};

function findById(id) {
  return prisma.order.findUnique({ where: { id } });
}

/**
 * Detail view with the buyer and the per-item listing/lot summaries attached
 * (`_listingMap` / `_lotMap`) — the Prisma equivalent of
 * `populate('items.listing')` / `populate('items.inventoryLot')`, which no
 * longer works now that order items live in a JSON column.
 */
async function findDetail(id, { buyerFull = false } = {}) {
  const row = await prisma.order.findUnique({
    where: { id },
    include: { buyer: buyerFull ? BUYER_SELECT_FULL : BUYER_SELECT_BASIC },
  });
  if (!row) return null;

  const items = Array.isArray(row.items) ? row.items : [];
  const listingIds = [...new Set(items.map((i) => i.listing).filter(Boolean))];
  const lotIds = [...new Set(items.map((i) => i.inventoryLot).filter(Boolean))];

  const [listingRows, lotRows] = await Promise.all([
    listingIds.length
      ? prisma.marketplaceListing.findMany({
          where: { id: { in: listingIds } },
          include: { materialCategory: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    lotIds.length
      ? prisma.inventoryLot.findMany({ where: { id: { in: lotIds } } })
      : [],
  ]);

  row._listingMap = Object.fromEntries(listingRows.map((l) => [l.id, l]));
  row._lotMap = Object.fromEntries(lotRows.map((l) => [l.id, l]));
  return row;
}

async function list({ buyerId, status, search, skip = 0, take = 12, populateBuyer = false } = {}) {
  const where = {};
  if (buyerId) where.buyerId = buyerId;
  if (status) where.status = status;
  if (search) where.orderNumber = { contains: search, mode: 'insensitive' };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      ...(populateBuyer ? { include: { buyer: BUYER_SELECT_BASIC } } : {}),
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total };
}

function findRecent(take = 5) {
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: { buyer: { select: { id: true, name: true } } },
  });
}

async function updateById(id, data) {
  try {
    return await prisma.order.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

async function sumTotalsForBuyer(buyerId) {
  const agg = await prisma.order.aggregate({
    where: { buyerId },
    _sum: { totalPaise: true },
  });
  return agg._sum.totalPaise || 0;
}

function count(where = {}) {
  return prisma.order.count({ where });
}

module.exports = {
  create,
  findById,
  findDetail,
  list,
  findRecent,
  updateById,
  sumTotalsForBuyer,
  count,
};
