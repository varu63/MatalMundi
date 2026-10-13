'use strict';

const { audit: auditRepo } = require('../../repositories');
const asyncHandler = require('../../middleware/asyncHandler');
const { paginated } = require('../../utils/apiResponse');
const { serializeAuditLog } = require('../../utils/serializers');
const { parsePage } = require('../../utils/numbers');

/** GET /admin/audit-logs */
const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);

  const { rows, total } = await auditRepo.list({
    action: req.query.action,
    resourceType: req.query.resourceType,
    skip,
    take: limit,
  });

  return paginated(res, rows.map(serializeAuditLog), { page, limit, total });
});

module.exports = { listAuditLogs };
