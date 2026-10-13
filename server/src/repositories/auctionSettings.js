'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/**
 * Single-row auction configuration. `get()` lazily creates the defaults row on
 * first access so existing deployments pick up the feature without a seed.
 */
async function get() {
  const existing = await prisma.auctionSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return prisma.auctionSettings.create({ data: { id: newId() } });
}

async function update(id, data) {
  try {
    return await prisma.auctionSettings.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

module.exports = { get, update };
