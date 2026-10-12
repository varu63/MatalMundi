'use strict';

/**
 * All monetary values are stored and computed as integer paise (1 INR = 100 paise)
 * to avoid floating point rounding errors. Only convert to rupees for display.
 */

function toPaise(rupees) {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function toRupees(paise) {
  const n = Number(paise);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

/** Multiply a paise amount by a decimal factor (e.g. 1.15), returning integer paise. */
function multiplyPaise(paise, factor) {
  return Math.round(Number(paise) * Number(factor));
}

/** Apply a percentage (e.g. 18 -> 18%) to a paise amount, returns integer paise. */
function percentOfPaise(paise, percent) {
  return Math.round((Number(paise) * Number(percent)) / 100);
}

function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toRupees(paise));
}

module.exports = { toPaise, toRupees, multiplyPaise, percentOfPaise, formatINR };
