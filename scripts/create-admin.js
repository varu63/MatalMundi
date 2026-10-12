'use strict';

/**
 * Secure initial setup script.
 *
 *   npm run seed:admin
 *
 * Creates the initial administrator from environment variables
 * (read from server/.env — see .env.example). It also seeds the default
 * material categories and pricing rules so the platform is usable immediately.
 *
 * An admin is NEVER created through the public registration API.
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const mongoose = require('mongoose');
const { User, MaterialCategory, PricingConfiguration } = require('../server/src/models');
const { ROLES, DEFAULT_QUALITY_MULTIPLIERS } = require('../server/src/utils/constants');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/metalmundi';

const DEFAULT_CATEGORIES = [
  { name: 'Ferrous Scrap', icon: 'wrench', rates: { default: 18 }, example: 'MS scrap, cast iron' },
  { name: 'Non-Ferrous Scrap', icon: 'copper', rates: { default: 95 }, example: 'aluminium, brass, copper' },
  {
    name: 'Plastics',
    icon: 'recycle',
    rates: { default: 12, HDPE: 14, 'PP (Polypropylene)': 16, 'PET': 10 },
    example: 'HDPE, PP, PET',
  },
  { name: 'Paper & Cardboard', icon: 'file', rates: { default: 6 }, example: 'cartons, newsprint' },
  { name: 'Glass', icon: 'glass', rates: { default: 3 }, example: 'cullet, bottles' },
  { name: 'E-Waste', icon: 'cpu', rates: { default: 25 }, example: 'PCBs, wiring' },
  { name: 'Rubber', icon: 'tire', rates: { default: 8 }, example: 'tyres, hoses' },
  { name: 'Textiles', icon: 'shirt', rates: { default: 5 }, example: 'garment cuttings' },
];

async function seedAdmin() {
  const name = process.env.ADMIN_NAME || 'MetalMundi Admin';
  const email = (process.env.ADMIN_EMAIL || 'admin@metalmundi.test').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  let admin = await User.findOne({ email });
  if (admin) {
    admin.role = ROLES.ADMIN;
    admin.accountStatus = 'ACTIVE';
    await admin.setPassword(password);
    await admin.save();
    console.log(`✔ Updated existing admin: ${email}`);
  } else {
    admin = new User({
      name,
      email,
      phone: '0000000000',
      role: ROLES.ADMIN,
      accountStatus: 'ACTIVE',
      emailVerification: { verified: true },
    });
    await admin.setPassword(password);
    await admin.save();
    console.log(`✔ Created admin: ${email}`);
  }
  return admin;
}

async function seedCategoriesAndPricing() {
  let createdCat = 0;
  let createdPricing = 0;

  for (const def of DEFAULT_CATEGORIES) {
    let category = await MaterialCategory.findOne({ name: def.name });
    if (!category) {
      category = await MaterialCategory.create({
        name: def.name,
        slug: def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: `Recyclable ${def.name.toLowerCase()}: ${def.example}`,
        icon: def.icon,
        active: true,
      });
      createdCat += 1;
    }

    const typeEntries = Object.entries(def.rates).filter(([k]) => k !== 'default');
    const keys = typeEntries.length ? typeEntries.map(([name]) => name) : [''];
    for (const typeName of keys) {
      const ratePerKg = typeName ? def.rates[typeName] : def.rates.default;
      if (ratePerKg === undefined) continue;
      const activeExists = await PricingConfiguration.findOne({
        materialCategory: category._id,
        materialType: typeName || '',
        active: true,
      });
      if (activeExists) continue;
      await PricingConfiguration.create({
        materialCategory: category._id,
        materialType: typeName || '',
        ratePerKgPaise: Math.round(ratePerKg * 100),
        qualityMultipliers: { ...DEFAULT_QUALITY_MULTIPLIERS },
        basePickupChargePaise: Math.round((parseFloat(process.env.DEFAULT_BASE_PICKUP_CHARGE) || 500) * 100),
        perKmChargePaise: Math.round((parseFloat(process.env.DEFAULT_PER_KM_CHARGE) || 12) * 100),
        platformFeePercent: parseFloat(process.env.DEFAULT_PLATFORM_FEE_PERCENT) || 5,
        taxPercent: parseFloat(process.env.DEFAULT_TAX_PERCENT) || 18,
        version: 1,
        active: true,
      });
      createdPricing += 1;
    }
  }
  console.log(`✔ Categories: ${createdCat} created, ${DEFAULT_CATEGORIES.length} ensured`);
  console.log(`✔ Pricing rules: ${createdPricing} created`);
}

async function main() {
  console.log('Connecting to MongoDB…', MONGODB_URI.replace(/:([^@/]+)@/, ':***@'));
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  await seedAdmin();
  await seedCategoriesAndPricing();

  console.log('✔ Setup complete. Log in at http://localhost:5173/login');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});