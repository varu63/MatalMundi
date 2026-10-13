'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function disabledInTest() {
  // Never let rate limiting interfere with the automated test suite.
  return env.isTest;
}

const jsonHandler = (_req, res) => {
  res.status(429).json({ success: false, message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' });
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

// Bids are validated server-side anyway; this only stops scripted spam while
// leaving room for genuine rapid counter-bidding.
const bidLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: disabledInTest,
  handler: jsonHandler,
});

module.exports = { apiLimiter, authLimiter, writeLimiter, bidLimiter };
