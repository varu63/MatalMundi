'use strict';

const categoriesRepo = require('../repositories/categories');
const pricingRepo = require('../repositories/pricing');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');
const { serializeCategory } = require('../utils/serializers');

/** GET /categories — active categories (public). */
const listCategories = asyncHandler(async (_req, res) => {
  const categories = await categoriesRepo.listActive();
  return ok(res, { categories: categories.map(serializeCategory) });
});

/** GET /categories/:slug/types — material types + reference rates for a category. */
const listCategoryTypes = asyncHandler(async (req, res) => {
  const category = await categoriesRepo.findBySlug(req.params.slug, { activeOnly: true });
  if (!category) return ok(res, { category: null, types: [] });

  const configs = await pricingRepo.findActiveForCategories([category.id]);
  configs.sort((a, b) => String(a.materialType).localeCompare(String(b.materialType)));

  const types = configs
    .filter((c) => c.materialType)
    .map((c) => ({
      materialType: c.materialType,
      ratePerKgPaise: c.ratePerKgPaise,
      qualityMultipliers: c.qualityMultipliers,
    }));

  return ok(res, { category: serializeCategory(category), types });
});

module.exports = { listCategories, listCategoryTypes };
