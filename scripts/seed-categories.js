'use strict';

/**
 * Idempotent category seed — safe to run repeatedly.
 *
 *   npm run seed:categories
 *
 * Upserts the 10 material categories (by slug) into the MaterialCategory
 * table. Reads DATABASE_URL from server/.env like seed:admin.
 */

const path = require('path');
const { createRequire } = require('module');
// Dependencies live in server/node_modules, not in the repo root.
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'));
const dotenv = serverRequire('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const { prisma } = require('../server/src/config/db');
const { newId } = require('../server/src/utils/idGenerator');

const CATEGORIES = [
  {
    name: 'Ferrous Metals',
    slug: 'ferrous-metals',
    description: 'Steel and iron scrap: MS scrap, cast iron, rebar, structural steel.',
    icon: 'wrench',
  },
  {
    name: 'Non-Ferrous Metals',
    slug: 'non-ferrous-metals',
    description: 'Aluminium, brass, copper and other metals without iron content.',
    icon: 'copper',
  },
  {
    name: 'E-Waste',
    slug: 'e-waste',
    description: 'Electronic waste: PCBs, wiring, devices and components.',
    icon: 'cpu',
  },
  {
    name: 'Batteries',
    slug: 'batteries',
    description: 'Lead-acid and lithium batteries from vehicles, inverters and electronics.',
    icon: 'battery',
  },
  {
    name: 'Industrial Scrap',
    slug: 'industrial-scrap',
    description: 'Manufacturing offcuts, machine scrap and factory waste.',
    icon: 'factory',
  },
  {
    name: 'Automotive Scrap',
    slug: 'automotive-scrap',
    description: 'End-of-life vehicles, auto parts and workshop scrap.',
    icon: 'car',
  },
  {
    name: 'Construction & Demolition',
    slug: 'construction-demolition',
    description: 'Rubble, concrete, wood and debris from construction and demolition sites.',
    icon: 'building',
  },
  {
    name: 'Plastic',
    slug: 'plastic',
    description: 'Plastic waste: HDPE, PP, PET and mixed polymers.',
    icon: 'recycle',
  },
  {
    name: 'Paper & Cardboard',
    slug: 'paper-cardboard',
    description: 'Cartons, newsprint and mixed paper.',
    icon: 'file',
  },
  {
    name: 'Other Recyclables',
    slug: 'other-recyclables',
    description: 'Glass, rubber, textiles and other recyclable materials.',
    icon: 'recycle',
  },
];

async function main() {
  console.log(
    'Connecting to PostgreSQL…',
    process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^@/]+)@/, ':***@') : '(from env)'
  );
  await prisma.$connect();

  let created = 0;
  let updated = 0;
  for (const [i, cat] of CATEGORIES.entries()) {
    const existing = await prisma.materialCategory.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      await prisma.materialCategory.update({
        where: { slug: cat.slug },
        data: { name: cat.name, description: cat.description, icon: cat.icon, sortOrder: i, active: true },
      });
      updated += 1;
    } else {
      await prisma.materialCategory.create({
        data: { id: newId(), ...cat, sortOrder: i, active: true },
      });
      created += 1;
    }
  }

  console.log(`✔ Categories: ${created} created, ${updated} ensured (${CATEGORIES.length} total)`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
