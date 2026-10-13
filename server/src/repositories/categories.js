'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function create({ name, slug, description = '', icon = 'recycle', sortOrder = 0, active = true }) {
  return prisma.materialCategory.create({
    data: {
      id: newId(),
      name,
      slug: slug || slugify(name),
      description,
      icon,
      sortOrder,
      active,
    },
  });
}

function listActive() {
  return prisma.materialCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

function listAll() {
  return prisma.materialCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

function findById(id) {
  return prisma.materialCategory.findUnique({ where: { id } });
}

function findBySlug(slug, { activeOnly = false } = {}) {
  return prisma.materialCategory.findFirst({
    where: activeOnly ? { slug, active: true } : { slug },
  });
}

/** Used for the create-time uniqueness pre-check (name OR slug). */
function findByNameOrSlug(name, slug) {
  return prisma.materialCategory.findFirst({ where: { OR: [{ name }, { slug }] } });
}

async function updateById(id, data) {
  try {
    return await prisma.materialCategory.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

function count(where = {}) {
  return prisma.materialCategory.count({ where });
}

module.exports = {
  slugify,
  create,
  listActive,
  listAll,
  findById,
  findBySlug,
  findByNameOrSlug,
  updateById,
  count,
};
