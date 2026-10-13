'use strict';

const notificationsRepo = require('../repositories/notifications');
const logger = require('../utils/logger');
const { emitToUser } = require('./socketService');
const { NOTIFICATION_TYPE } = require('../utils/constants');

/**
 * Creates a single notification. Never throws into the caller — a failed
 * notification must not roll back the business action that triggered it.
 */
async function createNotification({
  user,
  title,
  message,
  type = NOTIFICATION_TYPE.SYSTEM,
  relatedType = '',
  relatedId = null,
}) {
  try {
    const created = await notificationsRepo.create({
      userId: user,
      title,
      message,
      type,
      relatedType,
      relatedId,
    });
    // Best-effort realtime push to the user's personal room (no-op without
    // Socket.IO, e.g. in tests).
    if (created) {
      emitToUser(user, 'notification:new', {
        id: created.id,
        _id: created.id,
        title: created.title,
        message: created.message,
        type: created.type,
        relatedType: created.relatedType,
        relatedId: created.relatedId ?? undefined,
        read: created.read,
        createdAt: created.createdAt,
      });
    }
    return created;
  } catch (err) {
    logger.warn(`Notification create failed: ${err.message}`);
    return null;
  }
}

async function notifySubmission(user, title, message, relatedId) {
  return createNotification({
    user,
    title,
    message,
    type: NOTIFICATION_TYPE.SUBMISSION,
    relatedType: 'WasteSubmission',
    relatedId,
  });
}

async function notifyOrder(user, title, message, relatedId) {
  return createNotification({
    user,
    title,
    message,
    type: NOTIFICATION_TYPE.ORDER,
    relatedType: 'Order',
    relatedId,
  });
}

async function notifyAuction(user, title, message, relatedId) {
  return createNotification({
    user,
    title,
    message,
    type: NOTIFICATION_TYPE.AUCTION,
    relatedType: 'WasteAuction',
    relatedId,
  });
}

module.exports = { createNotification, notifySubmission, notifyOrder, notifyAuction };
