'use strict';

const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Human-readable, mostly-unique reference numbers.
 * e.g. WS-2026-1A2B3C / ORD-2026-9F8E7D
 */
function generateReference(prefix) {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${year}-${rand}`;
}

module.exports = { randomToken, generateReference };
