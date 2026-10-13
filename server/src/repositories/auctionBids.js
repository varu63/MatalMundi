'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');
const { BID_STATUS } = require('../utils/constants');

/** Auction bids. Public views must anonymize bidder identity. */

function create(data) {
  return prisma.wasteAuctionBid.create({ data: { id: newId(), ...data } });
}

function findById(id) {
  return prisma.wasteAuctionBid.findUnique({ where: { id } });
}

function findByAuctionAndIdempotencyKey(auctionId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return prisma.wasteAuctionBid.findFirst({ where: { auctionId, idempotencyKey } });
}

const WITH_BIDDER = {
  bidder: { select: { id: true, name: true, email: true } },
};

async function listByAuction(auctionId, { skip = 0, take = 50, includeBidder = false } = {}) {
  const where = { auctionId };
  const [rows, total] = await Promise.all([
    prisma.wasteAuctionBid.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: includeBidder ? WITH_BIDDER : undefined,
    }),
    prisma.wasteAuctionBid.count({ where }),
  ]);
  return { rows, total };
}

async function countByAuction(auctionId) {
  return prisma.wasteAuctionBid.count({ where: { auctionId } });
}

/** Distinct bidder ids for an auction (used for broadcast cancellation). */
async function distinctBidders(auctionId) {
  const rows = await prisma.wasteAuctionBid.findMany({
    where: { auctionId },
    select: { bidderId: true },
    distinct: ['bidderId'],
  });
  return rows.map((r) => r.bidderId);
}

/** Highest valid bid: by price desc, then earliest (ties cannot happen in-app). */
function findHighest(auctionId) {
  return prisma.wasteAuctionBid.findFirst({
    where: { auctionId },
    orderBy: [{ bidPerKgPaise: 'desc' }, { createdAt: 'asc' }],
  });
}

/** The holding bidder's completed bids, with auction context (buyer dashboard). */
async function listByBidder(bidderId, { skip = 0, take = 12, statuses } = {}) {
  const where = { bidderId };
  if (statuses && statuses.length) where.status = { in: statuses };
  const [rows, total] = await Promise.all([
    prisma.wasteAuctionBid.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        auction: {
          select: {
            id: true,
            auctionNumber: true,
            materialType: true,
            quantityKg: true,
            images: true,
            status: true,
            endAt: true,
            currentHighestBidPerKgPaise: true,
            startingPricePerKgPaise: true,
          },
        },
      },
    }),
    prisma.wasteAuctionBid.count({ where }),
  ]);
  return { rows, total };
}

/** Voids every still-open bid (cancelled auctions). */
function markAllOpenAsLost(auctionId) {
  return prisma.wasteAuctionBid.updateMany({
    where: { auctionId, status: { in: [BID_STATUS.LEADING, BID_STATUS.OUTBID] } },
    data: { status: BID_STATUS.LOST },
  });
}

function count(where = {}) {
  return prisma.wasteAuctionBid.count({ where });
}

module.exports = {
  create,
  findById,
  findByAuctionAndIdempotencyKey,
  listByAuction,
  countByAuction,
  distinctBidders,
  findHighest,
  listByBidder,
  markAllOpenAsLost,
  count,
  BID_STATUS,
};
