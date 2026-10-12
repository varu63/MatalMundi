'use strict';

const { PricingConfiguration, MaterialCategory } = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, created, paginated } = require('../../utils/apiResponse');
const { recordAudit } = require('../../services/auditService');
const { parsePage } = require('../../utils/numbers');
const { AUDIT_ACTION } = require('../../utils/constants');

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

function toDB(admin, body) {
  return {
    materialCategory: body.materialCategory,
    materialType: body.materialType || '',
    ratePerKgPaise: moneyToPaise(body.ratePerKg),
    qualityMultipliers: body.qualityMultipliers,
    basePickupChargePaise: moneyToPaise(body.basePickupCharge),
    perKmChargePaise: moneyToPaise(body.perKmCharge),
    platformFeePercent: body.platformFeePercent,
    taxPercent: body.taxPercent,
    notes: body.notes || '',
    updatedBy: admin,
  };
}

async function deactivateSameKey(category, materialType, exceptId = null) {
  const filter = { materialCategory: category, materialType: materialType || '', active: true };
  if (exceptId) filter._id = { $ne: exceptId };
  await PricingConfiguration.updateMany(filter, { $set: { active: false } });
}

/** GET /admin/pricing */
const listPricing = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;

  const [items, total] = await Promise.all([
    PricingConfiguration.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('materialCategory', 'name slug')
      .populate('updatedBy', 'name')
      .lean(),
    PricingConfiguration.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

/** POST /admin/pricing — create a new version of a pricing rule. */
const createPricing = asyncHandler(async (req, res) => {
  const category = await MaterialCategory.findById(req.body.materialCategory);
  if (!category) throw ApiError.badRequest('Invalid material category');

  await deactivateSameKey(category._id, req.body.materialType || '');

  const maxVersion = await PricingConfiguration.findOne({
    materialCategory: category._id,
    materialType: req.body.materialType || '',
  }).sort({ version: -1 }).select('version').lean();

  const config = await PricingConfiguration.create({
    ...toDB(req.user._id, req.body),
    version: (maxVersion?.version || 0) + 1,
    active: true,
  });

  await recordAudit({
    action: AUDIT_ACTION.PRICING_CREATE,
    resourceType: 'PricingConfiguration',
    resourceId: config._id,
    after: { category: category.slug, materialType: config.materialType, version: config.version },
    req,
  });

  return created(res, { config }, 'Pricing rule created');
});

/** PATCH /admin/pricing/:id */
const updatePricing = asyncHandler(async (req, res) => {
  const config = await PricingConfiguration.findById(req.params.id);
  if (!config) throw ApiError.notFound('Pricing rule not found');

  // Editing a rule always supersedes other active rules for the same key.
  await deactivateSameKey(config.materialCategory, config.materialType, config._id);

  if (req.body.materialType !== undefined) config.materialType = req.body.materialType;
  if (req.body.ratePerKg !== undefined) config.ratePerKgPaise = moneyToPaise(req.body.ratePerKg);
  if (req.body.qualityMultipliers) {
    config.qualityMultipliers = { ...config.qualityMultipliers.toObject?.() ?? config.qualityMultipliers, ...req.body.qualityMultipliers };
  }
  if (req.body.basePickupCharge !== undefined) config.basePickupChargePaise = moneyToPaise(req.body.basePickupCharge);
  if (req.body.perKmCharge !== undefined) config.perKmChargePaise = moneyToPaise(req.body.perKmCharge);
  if (req.body.platformFeePercent !== undefined) config.platformFeePercent = req.body.platformFeePercent;
  if (req.body.taxPercent !== undefined) config.taxPercent = req.body.taxPercent;
  if (req.body.notes !== undefined) config.notes = req.body.notes;
  config.active = true;
  config.updatedBy = req.user._id;
  await config.save();

  await recordAudit({
    action: AUDIT_ACTION.PRICING_UPDATE,
    resourceType: 'PricingConfiguration',
    resourceId: config._id,
    after: { version: config.version, materialType: config.materialType },
    req,
  });

  return ok(res, { config }, 'Pricing rule updated');
});

/** PATCH /admin/pricing/:id/status — activate / deactivate. */
const togglePricing = asyncHandler(async (req, res) => {
  const config = await PricingConfiguration.findById(req.params.id);
  if (!config) throw ApiError.notFound('Pricing rule not found');

  const active = Boolean(req.body.active);
  config.active = active;
  await config.save();
  return ok(res, { config }, `Pricing rule ${active ? 'activated' : 'deactivated'}`);
});

module.exports = { listPricing, createPricing, updatePricing, togglePricing };