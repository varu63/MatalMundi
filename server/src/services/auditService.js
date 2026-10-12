'use strict';

const { AuditLog } = require('../models');
const logger = require('../utils/logger');

/**
 * Writes an audit-log entry for an important (usually admin) action.
 * Failures are logged but never break the request.
 */
async function recordAudit({
  actor,
  actorRole = '',
  action,
  resourceType,
  resourceId = null,
  before = undefined,
  after = undefined,
  meta = undefined,
  req = undefined,
}) {
  try {
    await AuditLog.create({
      actor: actor || (req && req.user && req.user._id) || null,
      actorRole: actorRole || (req && req.user && req.user.role) || '',
      action,
      resourceType,
      resourceId,
      before,
      after,
      meta,
      ip: req ? req.ip : '',
      userAgent: req ? req.get('user-agent') : '',
    });
  } catch (err) {
    logger.warn(`Audit log failed: ${err.message}`);
  }
}

module.exports = { recordAudit };
