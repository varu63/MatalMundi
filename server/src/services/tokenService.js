'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

const AUTH_COOKIE = 'mm.token';

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id || user.id), role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'none' : 'lax',
    path: '/',
  });
}

module.exports = {
  AUTH_COOKIE,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  authCookieOptions,
};
