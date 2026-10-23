'use strict';

/**
 * Load-test fixture seeder — writes ONLY to the dedicated load database.
 *
 *   node scripts/seed-load.js --database postgresql://user:pass@host:5432/metalmundi_load
 *
 * The load harness needs deterministic, throwaway data: a batch of published
 * listings with enormous stock (so write tests measure throughput instead of
 * contention on the 409 path), plus pre-minted session cookies so the load
 * never spends time on bcrypt. Nothing here touches `metalmundi` or
 * `metalmundi_test`.
 */

const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const dotenv = serverRequire('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const { PrismaClient } = serverRequire('@prisma/client');

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {
    database: process.env.LOAD_DATABASE_URL,
    listings: 40,
    buyers: 60,
    stockKg: 5_000_000,
    out: path.resolve(__dirname, 'load-fixtures.json'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--database') args.database = argv[++i];
    else if (argv[i] === '--listings') args.listings = Number(argv[++i]);
    else if (argv[i] === '--buyers') args.buyers = Number(argv[++i]);
    else if (argv[i] === '--stock') args.stockKg = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  if (!args.database) {
    throw new Error(
      'Refusing to seed without --database <url>. Point it at a dedicated load database.'
    );
  }
  if (/metalmundi_test|\/metalmundi(\?|$)/i.test(args.database)) {
    throw new Error('Refusing to seed the development or test database. Use a load-only database.');
  }
  return args;
}

const CATEGORIES = [
  { name: 'Ferrous Scrap', slug: 'ferrous-scrap', icon: 'recycle', types: ['MS Scrap', 'CI Scrap'] },
  { name: 'Copper', slug: 'copper', icon: 'cable', types: 'Copper Wire' },
  { name: 'Aluminium', slug: 'aluminium', icon: 'can', types: ['Aluminium Extrusion', 'UTP'] },
  { name: 'Brass', slug: 'brass', icon: 'bolt', types: 'Brass Turnings' },
  { name: 'Stainless Steel', slug: 'stainless-steel', icon: 'utensils', types: ['SS 304 Scrap'] },
  { name: 'E-Waste', slug: 'e-waste', icon: 'monitor', types: ['Mixed E-Waste'] },
];

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient({ datasources: { db: { url: args.database } } });

  // Idempotent re-seed: the fixture tables are owned by this script only.
  await prisma.inventoryMovement.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.order.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.marketplaceListing.deleteMany();
  await prisma.inventoryLot.deleteMany();
  await prisma.wasteSubmission.deleteMany();
  await prisma.pricingConfiguration.deleteMany();
  await prisma.materialCategory.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@load.test' } } });

  const { randomBytes, createHash } = serverRequire('crypto');
  const bcrypt = serverRequire('bcryptjs');
  const jwt = serverRequire('jsonwebtoken');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to mint load-test sessions.');

  const passwordHash = await bcrypt.hash('LoadTest@123', 4);
  const hexId = () => randomBytes(12).toString('hex');
  const token = (user) => `mm.token=${jwt.sign({ sub: String(user.id), role: user.role }, secret, { expiresIn: '7d' })}`;

  const mkUser = (name, email, role) =>
    prisma.user.create({
      data: { id: hexId(), name, email, phone: '9876500000', passwordHash, role, accountStatus: 'ACTIVE', emailVerificationVerified: true },
    });

  const admin = await mkUser('Load Admin', 'load-admin@load.test', 'ADMIN');
  const seller = await mkUser('Load Seller', 'load-seller@load.test', 'USER');
  const buyers = [];
  for (let i = 0; i < args.buyers; i += 1) {
    buyers.push(await mkUser(`Load Buyer ${i}`, `load-buyer-${i}@load.test`, 'USER'));
  }

  const categories = [];
  for (const spec of CATEGORIES) {
    const category = await prisma.materialCategory.create({
      data: { id: hexId(), name: spec.name, slug: spec.slug, description: `${spec.name} for load tests`, icon: spec.icon, active: true },
    });
    const types = Array.isArray(spec.types) ? spec.types : [spec.types];
    await prisma.pricingConfiguration.create({
      data: {
        id: hexId(),
        materialCategoryId: category.id,
        materialType: '',
        ratePerKgPaise: 1800,
        qualityMultipliers: { A: 1.1, B: 1.0, C: 0.9, D: 0.75 },
        basePickupChargePaise: 50000,
        perKmChargePaise: 1200,
        platformFeePercent: 5,
        taxPercent: 18,
        version: 1,
        active: true,
      },
    });
    categories.push({ category, types });
  }

  const listings = [];
  for (let i = 0; i < args.listings; i += 1) {
    const { category, types } = categories[i % categories.length];
    const materialType = types[i % types.length];
    // Pune grid so the radius/Haversine path has real distances to rank.
    const lat = 18.5204 + (i % 10) * 0.01;
    const lng = 73.8567 + Math.floor(i / 10) * 0.012;
    const lot = await prisma.inventoryLot.create({
      data: {
        id: hexId(),
        lotNumber: `LOT-LOAD-${String(i).padStart(4, '0')}`,
        sellerId: seller.id,
        materialCategoryId: category.id,
        materialType,
        qualityGrade: 'B',
        condition: 'LOOSE',
        acceptedQuantityKg: args.stockKg,
        availableQuantityKg: args.stockKg,
        reservedQuantityKg: 0,
        soldQuantityKg: 0,
        city: 'Pune',
        state: 'Maharashtra',
        latitude: lat,
        longitude: lng,
        location: { city: 'Pune', state: 'Maharashtra' },
        lotStatus: 'PUBLISHED',
      },
    });
    const listing = await prisma.marketplaceListing.create({
      data: {
        id: hexId(),
        title: `Load test ${materialType} ${i}`,
        materialCategoryId: category.id,
        materialType,
        description: 'Deterministic fixture row created by scripts/seed-load.js.',
        images: [],
        inventoryLotId: lot.id,
        qualityGrade: 'B',
        condition: 'LOOSE',
        pricePerKgPaise: 2000 + (i % 7) * 250,
        minPurchaseKg: 0,
        acceptedQuantityKg: args.stockKg,
        availableQuantityKg: args.stockKg,
        reservedQuantityKg: 0,
        soldQuantityKg: 0,
        location: { city: 'Pune', state: 'Maharashtra' },
        city: 'Pune',
        state: 'Maharashtra',
        latitude: lat,
        longitude: lng,
        publicationStatus: 'PUBLISHED',
        active: true,
        publishedAt: new Date(),
      },
    });
    listings.push({
      id: listing.id,
      lotId: lot.id,
      title: listing.title,
      pricePerKgPaise: listing.pricePerKgPaise,
      stockKg: args.stockKg,
    });
  }

  const fixtures = {
    seededAt: new Date().toISOString(),
    database: args.database.replace(/:[^:@/]*@/, ':***@'),
    password: 'LoadTest@123',
    emailPrefixes: ['load-admin', 'load-seller', 'load-buyer-0'],
    adminCookie: token(admin),
    sellerCookie: token(seller),
    buyerCookies: buyers.map(token),
    categories: categories.map((c) => ({ id: c.category.id, slug: c.category.slug, types: c.types })),
    listings,
    writeListingIds: listings.slice(0, 20).map((l) => l.id),
    readListingIds: listings.slice(20).map((l) => l.id),
  };
  fs.writeFileSync(args.out, JSON.stringify(fixtures, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${listings.length} listings, ${buyers.length} buyers into the load database.\n` +
      `Fixtures written to ${args.out}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err.message || err);
  process.exit(1);
});
