'use strict';

const { pricing: pricingRepo, categories: categoriesRepo } = require('../../repositories');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, created, paginated } = require('../../utils/apiResponse');
const { serializePricing } = require('../../utils/serializers');
const { recordAudit } = require('../../services/auditService');
const { parsePage } = require('../../utils/numbers');
const { AUDIT_ACTION } = require('../../utils/constants');

function moneyToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

/** GET /admin/pricing */
const listPricing = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  let active;
  if (req.query.active === 'true') active = true;
  if (req.query.active === 'false') active = false;

  const { rows, total } = await pricingRepo.list({ active, skip, take: limit });
  return paginated(res, rows.map(serializePricing), { page, limit, total });
});

/** POST /admin/pricing — create a new version of a pricing rule. */
const createPricing = asyncHandler(async (req, res) => {
  const category = await categoriesRepo.findById(req.body.materialCategory);
  if (!category) throw ApiError.badRequest('Invalid material category');

  const materialType = req.body.materialType || '';
  await pricingRepo.deactivateSameKey(category.id, materialType);

  const latest = await pricingRepo.maxVersion(category.id, materialType);

  const config = await pricingRepo.create({
    materialCategoryId: category.id,
    materialType,
    ratePerKgPaise: moneyToPaise(req.body.ratePerKg),
    qualityMultipliers: req.body.qualityMultipliers,
    basePickupChargePaise: moneyToPaise(req.body.basePickupCharge),
    perKmChargePaise: moneyToPaise(req.body.perKmCharge),
    platformFeePercent: req.body.platformFeePercent,
    taxPercent: req.body.taxPercent,
    notes: req.body.notes || '',
    updatedById: req.user.id,
    version: (latest?.version || 0) + 1,
    active: true,
  });

  await recordAudit({
    action: AUDIT_ACTION.PRICING_CREATE,
    resourceType: 'PricingConfiguration',
    resourceId: config.id,
    after: { category: category.slug, materialType: config.materialType, version: config.version },
    req,
  });

  return created(res, { config: serializePricing(config) }, 'Pricing rule created');
});

/** PATCH /admin/pricing/:id */
const updatePricing = asyncHandler(async (req, res) => {
  const config = await pricingRepo.findById(req.params.id);
  if (!config) throw ApiError.notFound('Pricing rule not found');

  // Editing a rule always supersedes other active rules for the same key.
  await pricingRepo.deactivateSameKey(config.materialCategoryId, config.materialType, config.id);

  const data = { active: true, updatedById: req.user.id };
  if (req.body.materialType !== undefined) data.materialType = req.body.materialType;
  if (req.body.ratePerKg !== undefined) data.ratePerKgPaise = moneyToPaise(req.body.ratePerKg);
  if (req.body.qualityMultipliers) {
    data.qualityMultipliers = {
      ...(config.qualityMultipliers || {}),
      ...req.body.qualityMultipliers,
    };
  }
  if (req.body.basePickupCharge !== undefined)
    data.basePickupChargePaise = moneyToPaise(req.body.basePickupCharge);
  if (req.body.perKmCharge !== undefined)
    data.perKmChargePaise = moneyToPaise(req.body.perKmCharge);
  if (req.body.platformFeePercent !== undefined)
    data.platformFeePercent = req.body.platformFeePercent;
  if (req.body.taxPercent !== undefined) data.taxPercent = req.body.taxPercent;
  if (req.body.notes !== undefined) data.notes = req.body.notes;

  const updated = await pricingRepo.updateById(config.id, data);

  await recordAudit({
    action: AUDIT_ACTION.PRICING_UPDATE,
    resourceType: 'PricingConfiguration',
    resourceId: updated.id,
    after: { version: updated.version, materialType: updated.materialType },
    req,
  });

  return ok(res, { config: serializePricing(updated) }, 'Pricing rule updated');
});

/** PATCH /admin/pricing/:id/status — activate / deactivate. */
const togglePricing = asyncHandler(async (req, res) => {
  const config = await pricingRepo.findById(req.params.id);
  if (!config) throw ApiError.notFound('Pricing rule not found');

  const active = Boolean(req.body.active);
  const updated = await pricingRepo.updateById(config.id, { active });

  return ok(
    res,
    { config: serializePricing(updated) },
    `Pricing rule ${active ? 'activated' : 'deactivated'}`
  );
});

module.exports = { listPricing, createPricing, updatePricing, togglePricing };
