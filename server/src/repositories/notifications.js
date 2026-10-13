'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');

/** In-app notifications (best-effort; never blocks the triggering action). */

function create({ userId, title, message, type = 'SYSTEM', relatedType = '', relatedId = null }) {
  return prisma.notification.create({
    data: { id: newId(), userId, title, message, type, relatedType, relatedId },
  });
}

async function list({ userId, unreadOnly = false, skip = 0, take = 12 }) {
  const where = { userId };
  if (unreadOnly) where.read = false;
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return { rows, total, unread };
}

function unreadCount(userId) {
  return prisma.notification.count({ where: { userId, read: false } });
}

/** Marks one notification read; only the owner can do so. Null if not found. */
async function markRead(id, userId) {
  const result = await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
  if (result.count === 0) return null;
  return prisma.notification.findUnique({ where: { id } });
}

function markAllRead(userId) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

module.exports = { create, list, unreadCount, markRead, markAllRead };
