'use strict';

const { MaterialCategory, PricingConfiguration } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');

/** GET /categories — active categories (public). */
const listCategories = asyncHandler(async (_req, res) => {
  const categories = await MaterialCategory.find({ active: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return ok(res, { categories });
});

/** GET /categories/:slug/types — material types + reference rates for a category. */
const listCategoryTypes = asyncHandler(async (req, res) => {
  const category = await MaterialCategory.findOne({ slug: req.params.slug, active: true }).lean();
  if (!category) return ok(res, { category: null, types: [] });

  const configs = await PricingConfiguration.find({ materialCategory: category._id, active: true })
    .sort({ materialType: 1 })
    .lean();

  const types = configs
    .filter((c) => c.materialType)
    .map((c) => ({
      materialType: c.materialType,
      ratePerKgPaise: c.ratePerKgPaise,
      qualityMultipliers: c.qualityMultipliers,
    }));

  return ok(res, { category, types });
});

module.exports = { listCategories, listCategoryTypes };
