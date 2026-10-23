'use strict';

/**
 * Backfill pickup coordinates for inventory lots and marketplace listings that
 * have a city/state but no latitude/longitude. Nearby-radius search only
 * matches rows with coordinates, so an un-geocoded catalogue is invisible to it.
 *
 *   npm run backfill:coords
 *
 * Requires GEOCODING_ENABLED=true and GEOCODING_USER_AGENT in server/.env —
 * Nominatim's usage policy asks for an identifying User-Agent and rate-limits
 * to roughly one request per second, which this script respects.
 *
 * Existing coordinates are never overwritten. Add --dry-run to report what
 * would change without writing.
 */

const path = require('path');
const { createRequire } = require('module');
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const dotenv = serverRequire('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const { prisma } = require('../server/src/config/db');
const { geocodeLocality } = require('../server/src/services/geocodingService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DRY_RUN = process.argv.includes('--dry-run');

async function collectTargets() {
  const where = { latitude: null, city: { not: '' } };
  const [lots, listings] = await Promise.all([
    prisma.inventoryLot.findMany({ where, select: { id: true, city: true, state: true } }),
    prisma.marketplaceListing.findMany({ where, select: { id: true, city: true, state: true } }),
  ]);
  return { lots, listings };
}

async function main() {
  const { lots, listings } = await collectTargets();
  const total = lots.length + listings.length;

  if (!total) {
    console.log('Nothing to geocode: every lot and listing already has coordinates or no city.');
    return;
  }

  console.log(`Geocoding ${lots.length} lot(s) and ${listings.length} listing(s)…`);

  // One lookup per distinct locality, reused across rows in the same city.
  const cache = new Map();
  let resolved = 0;
  let failed = 0;

  for (const row of [...lots, ...listings]) {
    const key = `${row.city}|${row.state}`;
    if (!cache.has(key)) {
      cache.set(key, await geocodeLocality({ city: row.city, state: row.state }));
      await sleep(1100); // Nominatim usage policy: max ~1 req/s
    }
    const coordinates = cache.get(key);

    if (!coordinates) {
      failed += 1;
      console.warn(`  could not resolve "${key}" for ${row.id}`);
      continue;
    }

    resolved += 1;
    console.log(`  "${key}" -> ${coordinates.latitude}, ${coordinates.longitude}`);
    if (DRY_RUN) continue;

    const data = { latitude: coordinates.latitude, longitude: coordinates.longitude };
    if (lots.some((lot) => lot.id === row.id)) {
      await prisma.inventoryLot.update({ where: { id: row.id }, data });
    } else {
      await prisma.marketplaceListing.update({ where: { id: row.id }, data });
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run: ${resolved} resolvable, ${failed} unresolved. No rows written.`);
    return;
  }
  console.log(`Done. Coordinates set on ${resolved} row(s); ${failed} unresolved.`);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
