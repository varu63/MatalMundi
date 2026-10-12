'use strict';

const { MaterialCategory } = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { recordAudit } = require('../../services/auditService');
const { AUDIT_ACTION } = require('../../utils/constants');

/** GET /admin/categories — all categories (including inactive). */
const listCategories = asyncHandler(async (_req, res) => {
  const categories = await MaterialCategory.find().sort({ sortOrder: 1, name: 1 }).lean();
  return ok(res, { categories });
});

/** POST /admin/categories */
const createCategory = asyncHandler(async (req, res) => {
  const exists = await MaterialCategory.findOne({
    $or: [{ name: req.body.name }, { slug: req.body.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') }],
  });
  if (exists) throw ApiError.conflict('A category with this name already exists');

  const category = await MaterialCategory.create(req.body);
  await recordAudit({
    action: AUDIT_ACTION.CATEGORY_CREATE,
    resourceType: 'MaterialCategory',
    resourceId: category._id,
    after: { name: category.name, slug: category.slug },
    req,
  });
  return created(res, { category }, 'Category created');
});

/** PATCH /admin/categories/:id */
const updateCategory = asyncHandler(async (req, res) => {
  const category = await MaterialCategory.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');

  if (req.body.name !== undefined) category.name = req.body.name;
  if (req.body.description !== undefined) category.description = req.body.description;
  if (req.body.icon !== undefined) category.icon = req.body.icon;
  if (req.body.sortOrder !== undefined) category.sortOrder = req.body.sortOrder;
  if (req.body.active !== undefined) category.active = req.body.active;
  await category.save();

  await recordAudit({
    action: AUDIT_ACTION.CATEGORY_UPDATE,
    resourceType: 'MaterialCategory',
    resourceId: category._id,
    after: { name: category.name, active: category.active },
    req,
  });

  return ok(res, { category }, 'Category updated');
});

module.exports = { listCategories, createCategory, updateCategory };