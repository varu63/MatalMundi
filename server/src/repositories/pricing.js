'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Versioned pricing rules. The latest active rule for a (category, type) wins. */

/** Active rule for a category + optional material type, falling back to the category-wide rule. */
async function getActive(categoryId, materialType = '') {
  if (materialType) {
    const specific = await prisma.pricingConfiguration.findFirst({
      where: { materialCategoryId: categoryId, materialType, active: true },
      orderBy: { version: 'desc' },
    });
    if (specific) return specific;
  }
  return prisma.pricingConfiguration.findFirst({
    where: { materialCategoryId: categoryId, materialType: '', active: true },
    orderBy: { version: 'desc' },
  });
}

/** All active rules touching any of the given categories (order tax lookup). */
function findActiveForCategories(categoryIds) {
  return prisma.pricingConfiguration.findMany({
    where: { materialCategoryId: { in: categoryIds }, active: true },
  });
}

function maxVersion(categoryId, materialType = '') {
  return prisma.pricingConfiguration.findFirst({
    where: { materialCategoryId: categoryId, materialType },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
}

function create(data) {
  return prisma.pricingConfiguration.create({ data: { id: newId(), ...data } });
}

function findById(id) {
  return prisma.pricingConfiguration.findUnique({ where: { id } });
}

async function updateById(id, data) {
  try {
    return await prisma.pricingConfiguration.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

/** Deactivates every other active rule for the same (category, materialType). */
function deactivateSameKey(categoryId, materialType = '', exceptId = null) {
  const where = { materialCategoryId: categoryId, materialType: materialType || '', active: true };
  if (exceptId) where.id = { not: exceptId };
  return prisma.pricingConfiguration.updateMany({ where, data: { active: false } });
}

async function list({ active, skip = 0, take = 12 } = {}) {
  const where = {};
  if (active !== undefined) where.active = active;
  const [rows, total] = await Promise.all([
    prisma.pricingConfiguration.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
      include: {
        materialCategory: { select: { id: true, name: true, slug: true } },
        updatedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.pricingConfiguration.count({ where }),
  ]);
  return { rows, total };
}

function count(where = {}) {
  return prisma.pricingConfiguration.count({ where });
}

module.exports = {
  getActive,
  findActiveForCategories,
  maxVersion,
  create,
  findById,
  updateById,
  deactivateSameKey,
  list,
  count,
};
