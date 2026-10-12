'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const CSRF_COOKIE = 'mm.csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Double-submit-cookie CSRF protection. A non-HttpOnly token cookie is issued
 * on the first request; the SPA reads it and echoes it back in the
 * `x-csrf-token` header for every unsafe request. An attacker site cannot read
 * the cookie (same-origin policy) and therefore cannot forge the header.
 */
function issueCsrfToken(req, res, next) {
  if (!req.cookies || !req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: env.isProd ? 'none' : 'lax',
      secure: env.isProd,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE];
  }
  next();
}

function verifyCsrf(req, _res, next) {
  if (env.isTest || process.env.DISABLE_CSRF === 'true') return next();
  if (SAFE_METHODS.includes(req.method)) return next();

  const cookieToken = req.cookies ? req.cookies[CSRF_COOKIE] : undefined;
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
    return next(ApiError.forbidden('Invalid or missing CSRF token'));
  }
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  if (!crypto.timingSafeEqual(a, b)) {
    return next(ApiError.forbidden('Invalid CSRF token'));
  }
  return next();
}

function getCsrfToken(req, res) {
  const token = req.csrfToken || req.cookies[CSRF_COOKIE];
  res.json({ success: true, message: 'OK', data: { csrfToken: token } });
}

module.exports = { issueCsrfToken, verifyCsrf, getCsrfToken, CSRF_COOKIE, CSRF_HEADER };
