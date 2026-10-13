'use strict';

/**
 * Pure bid-math helpers (integer paise only — money never touches floats).
 * Shared by the auction service and the response serializers.
 */

/** One minimum increment for a given current price, in paise. */
function incrementPaise(currentPaise, { minIncrementType, minIncrementValue }) {
  const value = Number(minIncrementValue) || 0;
  if (minIncrementType === 'PERCENT') {
    return Math.max(1, Math.ceil((currentPaise * value) / 100));
  }
  return Math.max(1, Math.round(value));
}

/**
 * Minimum acceptable next bid for an auction row:
 *  - no bids yet → the starting price;
 *  - otherwise  → current highest + one minimum increment.
 */
function minNextBidPaise(auction) {
  const current = auction.currentHighestBidPerKgPaise;
  if (current == null) return Math.round(auction.startingPricePerKgPaise);
  return Math.round(current) + incrementPaise(Math.round(current), auction);
}

module.exports = { incrementPaise, minNextBidPaise };
