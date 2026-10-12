'use strict';

const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('./asyncHandler');
const { verifyToken, AUTH_COOKIE } = require('../services/tokenService');
const { ROLES, ACCOUNT_STATUS } = require('../utils/constants');

function extractToken(req) {
  if (req.cookies && req.cookies[AUTH_COOKIE]) return req.cookies[AUTH_COOKIE];
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Attaches req.user when a valid token is present; never rejects. */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.sub);
    if (user && user.accountStatus === ACCOUNT_STATUS.ACTIVE) req.user = user;
  } catch (_e) {
    // ignore invalid token for optional auth
  }
  return next();
});

/** Requires a valid, active session. */
const protect = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (_e) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const user = await User.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw ApiError.forbidden('Account suspended');
  }
  if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
    throw ApiError.forbidden('Account is not active');
  }

  req.user = user;
  return next();
});

/** Restricts a route to one or more roles. Must run after `protect`. */
function authorize(...roles) {
  return function authorizeMiddleware(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (roles.length && !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    return next();
  };
}

const requireAdmin = [protect, authorize(ROLES.ADMIN)];

module.exports = { protect, optionalAuth, authorize, requireAdmin, extractToken };
