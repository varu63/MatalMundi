'use strict';

const notificationsRepo = require('../repositories/notifications');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');
const { serializeNotification } = require('../utils/serializers');
const { parsePage } = require('../utils/numbers');

/** GET /notifications/my */
const listMine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total, unread } = await notificationsRepo.list({
    userId: req.user.id,
    unreadOnly: req.query.unread === 'true',
    skip,
    take: limit,
  });

  return ok(res, rows.map(serializeNotification), 'OK', 200, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page < Math.ceil(total / limit),
    hasPrevPage: page > 1,
    unread,
  });
});

/** GET /notifications/unread-count */
const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationsRepo.unreadCount(req.user.id);
  return ok(res, { unread: count });
});

/** PATCH /notifications/:id/read */
const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationsRepo.markRead(req.params.id, req.user.id);
  if (!notification) throw ApiError.notFound('Notification not found');
  return ok(res, { notification: serializeNotification(notification) }, 'Marked as read');
});

/** PATCH /notifications/read-all */
const markAllRead = asyncHandler(async (req, res) => {
  await notificationsRepo.markAllRead(req.user.id);
  return ok(res, null, 'All notifications marked as read');
});

module.exports = { listMine, unreadCount, markRead, markAllRead };
