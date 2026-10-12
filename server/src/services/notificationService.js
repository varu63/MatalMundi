'use strict';

const { Notification } = require('../models');
const logger = require('../utils/logger');
const { NOTIFICATION_TYPE } = require('../utils/constants');

/**
 * Creates a single notification. Never throws into the caller — a failed
 * notification must not roll back the business action that triggered it.
 */
async function createNotification({ user, title, message, type = NOTIFICATION_TYPE.SYSTEM, relatedType = '', relatedId = null }) {
  try {
    return await Notification.create({ user, title, message, type, relatedType, relatedId });
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

module.exports = { createNotification, notifySubmission, notifyOrder };
