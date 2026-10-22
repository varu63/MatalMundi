'use strict';

const net = require('net');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function disabledInTest() {
  // Never let rate limiting interfere with the automated test suite — unless a
  // test explicitly opts in (process.env.ENFORCE_RATE_LIMIT = 'true').
  return env.isTest && process.env.ENFORCE_RATE_LIMIT !== 'true';
}

const jsonHandler = (_req, res) => {
  res.status(429).json({
    success: false,
    message: 'Too many requests, please try again later.',
    code: 'RATE_LIMITED',
  });
};

// Collapse an IPv6 address to its /64 prefix: a single subscriber is handed a
// whole /64, so counting individual addresses would let one client rotate
// through billions of them to bypass a per-IP limit.
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (net.isIP(ip) !== 6) return ip;
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...new Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function requestEmail(req) {
  const raw = req.body && typeof req.body.email === 'string' ? req.body.email : '';
  return raw.trim().toLowerCase();
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => env.rateLimits.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

// Per-IP cap for the auth router. Kept loose on purpose: on a shared NAT
// (CGNAT, campus, office) every user shares one bucket, and a tight cap turns
// into "other people cannot sign up" instead of a security control.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => env.rateLimits.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

// Per-account cap: one client may not hammer a single account. Keyed by IP *and*
// e-mail so it cannot be used to lock a victim out from another network, while
// still stopping credential stuffing / password spraying from one host.
// Successful logins decrement the counter, so a legitimate user who mistypes
// once is not punished.
const authAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => env.rateLimits.authAccountMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  keyGenerator: (req) => {
    const email = requestEmail(req);
    return email ? `acct:${normalizeIp(req.ip)}:${email}` : `acct:${normalizeIp(req.ip)}:-`;
  },
  skipSuccessfulRequests: true,
  handler: jsonHandler,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => env.rateLimits.writeMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

// Bids are validated server-side anyway; this only stops scripted spam while
// leaving room for genuine rapid counter-bidding.
const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => env.rateLimits.bidMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

module.exports = {
  apiLimiter,
  authLimiter,
  authAccountLimiter,
  writeLimiter,
  bidLimiter,
  normalizeIp,
};
