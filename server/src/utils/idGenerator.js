'use strict';

const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Primary-key generator. 12 random bytes render as a 24-char hex string —
 * the same shape Mongo ObjectIds had, so route params, validators and the
 * frontend keep working unchanged.
 */
function newId() {
  return randomToken(12);
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

module.exports = { randomToken, newId, generateReference };
