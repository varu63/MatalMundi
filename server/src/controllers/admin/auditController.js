'use strict';

const { AuditLog, User } = require('../../models');
const asyncHandler = require('../../middleware/asyncHandler');
const { paginated } = require('../../utils/apiResponse');
const { parsePage } = require('../../utils/numbers');

/** GET /admin/audit-logs */
const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.resourceType) filter.resourceType = req.query.resourceType;

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actor', 'name email role')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

module.exports = { listAuditLogs };