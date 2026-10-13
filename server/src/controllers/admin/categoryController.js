'use strict';

const categoriesRepo = require('../../repositories/categories');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { serializeCategory } = require('../../utils/serializers');
const { recordAudit } = require('../../services/auditService');
const { AUDIT_ACTION } = require('../../utils/constants');

/** GET /admin/categories — all categories (including inactive). */
const listCategories = asyncHandler(async (_req, res) => {
  const categories = await categoriesRepo.listAll();
  return ok(res, { categories: categories.map(serializeCategory) });
});

/** POST /admin/categories */
const createCategory = asyncHandler(async (req, res) => {
  const slug = categoriesRepo.slugify(req.body.name);
  const exists = await categoriesRepo.findByNameOrSlug(req.body.name, slug);
  if (exists) throw ApiError.conflict('A category with this name already exists');

  const category = await categoriesRepo.create({ ...req.body, slug });
  await recordAudit({
    action: AUDIT_ACTION.CATEGORY_CREATE,
    resourceType: 'MaterialCategory',
    resourceId: category.id,
    after: { name: category.name, slug: category.slug },
    req,
  });
  return created(res, { category: serializeCategory(category) }, 'Category created');
});

/** PATCH /admin/categories/:id */
const updateCategory = asyncHandler(async (req, res) => {
  const category = await categoriesRepo.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');

  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.description !== undefined) data.description = req.body.description;
  if (req.body.icon !== undefined) data.icon = req.body.icon;
  if (req.body.sortOrder !== undefined) data.sortOrder = req.body.sortOrder;
  if (req.body.active !== undefined) data.active = req.body.active;
  if (req.body.name !== undefined) data.slug = categoriesRepo.slugify(req.body.name);

  const updated = await categoriesRepo.updateById(category.id, data);

  await recordAudit({
    action: AUDIT_ACTION.CATEGORY_UPDATE,
    resourceType: 'MaterialCategory',
    resourceId: category.id,
    after: { name: updated.name, active: updated.active },
    req,
  });

  return ok(res, { category: serializeCategory(updated) }, 'Category updated');
});

module.exports = { listCategories, createCategory, updateCategory };
