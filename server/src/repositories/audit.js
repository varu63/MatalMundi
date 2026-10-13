'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** Audit trail for important (mostly admin) actions. */

function create({
  actorId = null,
  actorRole = '',
  action,
  resourceType,
  resourceId = null,
  before = undefined,
  after = undefined,
  meta = undefined,
  ip = '',
  userAgent = '',
}) {
  return prisma.auditLog.create({
    data: {
      id: newId(),
      actorId,
      actorRole,
      action,
      resourceType,
      resourceId,
      before,
      after,
      meta,
      ip,
      userAgent,
    },
  });
}

async function list({ action, resourceType, skip = 0, take = 12 } = {}) {
  const where = {};
  if (action) where.action = action;
  if (resourceType) where.resourceType = resourceType;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}

module.exports = { create, list };
