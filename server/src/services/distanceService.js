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

function toCoordinate(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePoint({ latitude, longitude, lat, lng } = {}) {
  const latValue = toCoordinate(latitude ?? lat);
  const lngValue = toCoordinate(longitude ?? lng);
  if (latValue === null || lngValue === null) return null;
  if (latValue < -90 || latValue > 90 || lngValue < -180 || lngValue > 180) return null;
  return { latitude: latValue, longitude: lngValue };
}

function haversineDistanceKm(from, to) {
  const a = normalizePoint(from);
  const b = normalizePoint(to);
  if (!a || !b) return null;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function radiusKm(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, env.business.maxRadiusKm);
}

module.exports = {
  estimateDistanceKm,
  haversineDistanceKm,
  normalizePoint,
  radiusKm,
};
