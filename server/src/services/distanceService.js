'use strict';

const env = require('../config/env');

/**
 * Distance estimation.
 *
 * There is no real geocoding/distance provider configured, so we cannot report
 * an exact pickup distance. We return a deterministic, clearly-provisional
 * figure derived from a stable hash of the pickup locality plus a configured
 * base distance. The result is ALWAYS flagged `provisional: true` so the UI and
 * stored snapshot never present it as an exact logistics quote.
 */
function hashToRange(str, min, max) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 1000003;
  }
  const span = max - min;
  return min + (span === 0 ? 0 : h % (span + 1));
}

function estimateDistanceKm({ city = '', state = '', postalCode = '' } = {}) {
  const key = `${city}|${state}|${postalCode}`.toLowerCase();
  const base = env.business.defaultDistanceKm;
  if (!key.replace(/\|/g, '').trim()) {
    return { distanceKm: base, provisional: true, source: 'default' };
  }
  // ±60% around the configured base, deterministic per locality.
  const min = Math.max(1, Math.round(base * 0.4));
  const max = Math.round(base * 1.6);
  const distanceKm = hashToRange(key, min, max);
  return { distanceKm, provisional: true, source: 'hash-estimate' };
}

module.exports = { estimateDistanceKm };
