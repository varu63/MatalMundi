'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');
const { normalizePoint } = require('./distanceService');

/**
 * Forward geocoding via Nominatim (OpenStreetMap). Requires GEOCODING_ENABLED
 * and an identifying GEOCODING_USER_AGENT; returns null when unconfigured or
 * the query cannot be resolved, so callers must handle a missing coordinate.
 */
async function searchPlace(query, { countrycodes = 'in', limit = 5 } = {}) {
  if (!env.geocoding.enabled || !query) return null;

  try {
    const url = new URL(env.geocoding.providerUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    if (countrycodes) url.searchParams.set('countrycodes', countrycodes);

    const response = await fetch(url, {
      headers: {
        'User-Agent': env.geocoding.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results)) return null;

    return results
      .map((r) => {
        const point = normalizePoint({ latitude: r.lat, longitude: r.lon });
        if (!point) return null;
        return {
          ...point,
          displayName: r.display_name || '',
          city: r.address?.city || r.address?.town || r.address?.village || r.address?.suburb || '',
          state: r.address?.state || '',
          postalCode: r.address?.postcode || '',
        };
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`Geocoding failed for "${query}": ${err.message}`);
    return null;
  }
}

async function geocodeLocality({ city = '', state = '', postalCode = '' } = {}) {
  if (!env.geocoding.enabled) return null;

  const query = [city, state, postalCode, 'India'].filter(Boolean).join(', ');
  if (!city && !postalCode) return null;

  const results = await searchPlace(query, { limit: 1 });
  const first = results?.[0];
  return first ? { latitude: first.latitude, longitude: first.longitude } : null;
}

module.exports = { geocodeLocality, searchPlace, geocodeEnabled: () => env.geocoding.enabled };
