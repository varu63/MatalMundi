'use strict';

const { Notification } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');
const { parsePage } = require('../utils/numbers');

/** GET /notifications/my */
const listMine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.read = false;

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);

  return ok(res, items, 'OK', 200, {
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
  const count = await Notification.countDocuments({ user: req.user._id, read: false });
  return ok(res, { unread: count });
});

/** PATCH /notifications/:id/read */
const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { read: true } },
    { new: true },
  );
  if (!notification) throw ApiError.notFound('Notification not found');
  return ok(res, { notification }, 'Marked as read');
});

/** PATCH /notifications/read-all */
const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  return ok(res, null, 'All notifications marked as read');
});

module.exports = { listMine, unreadCount, markRead, markAllRead };
