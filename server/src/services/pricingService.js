'use strict';

const pricingRepo = require('../repositories/pricing');
const env = require('../config/env');
const { percentOfPaise } = require('../utils/money');
const { round2 } = require('../utils/numbers');
const { estimateDistanceKm } = require('./distanceService');
const ApiError = require('../utils/ApiError');
const { DEMAND_BASIS, DEFAULT_QUALITY_MULTIPLIERS } = require('../utils/constants');

/**
 * Returns the active pricing rule for a category + optional material type.
 * Falls back to a category-wide rule, then to a `null` (caller decides).
 */
async function getActivePricing(materialCategoryId, materialType = '') {
  return pricingRepo.getActive(materialCategoryId, materialType);
}

function qualityMultiplierFor(config, grade) {
  const fromConfig = config?.qualityMultipliers?.[grade];
  if (typeof fromConfig === 'number') return fromConfig;
  return DEFAULT_QUALITY_MULTIPLIERS[grade] ?? 1;
}

/**
 * Server-authoritative valuation for a waste submission.
 * All amounts are integer paise. Returns a full snapshot suitable for storage.
 *
 * material value = weightKg × ratePerKgPaise × qualityMultiplier
 * pickup cost    = basePickupChargePaise + distanceKm × perKmChargePaise
 * platform fee   = materialValuePaise × platformFeePercent%
 * payout         = materialValue − pickupCost − platformFee
 */
function computeValuation({ pricingConfig, quantityKg, qualityGrade, pickup = {} }) {
  if (!pricingConfig) {
    throw ApiError.badRequest('No active pricing configuration for this material');
  }

  const weight = Number(quantityKg);
  const ratePerKgPaise = Number(pricingConfig.ratePerKgPaise) || 0;
  const qualityMultiplier = qualityMultiplierFor(pricingConfig, qualityGrade);

  const materialValuePaise = Math.round(weight * ratePerKgPaise * qualityMultiplier);

  const dist = estimateDistanceKm(pickup);
  const basePickupChargePaise =
    pricingConfig.basePickupChargePaise ?? Math.round(env.business.basePickupCharge * 100);
  const perKmChargePaise =
    pricingConfig.perKmChargePaise ?? Math.round(env.business.perKmCharge * 100);
  const pickupCostPaise = Math.round(basePickupChargePaise + dist.distanceKm * perKmChargePaise);

  const platformFeePercent = pricingConfig.platformFeePercent ?? env.business.platformFeePercent;
  const platformFeePaise = percentOfPaise(materialValuePaise, platformFeePercent);

  const estimatedPayoutPaise = materialValuePaise - pickupCostPaise - platformFeePaise;

  return {
    pricingConfigId: pricingConfig.id,
    pricingVersion: pricingConfig.version,
    materialRatePerKgPaise: ratePerKgPaise,
    qualityMultiplier,
    materialValuePaise,

    basePickupChargePaise,
    estimatedDistanceKm: dist.distanceKm,
    perKmChargePaise,
    pickupCostPaise,
    distanceIsProvisional: dist.provisional,

    platformFeePercent,
    platformFeePaise,

    estimatedPayoutPaise,
    isProvisional: true,
    calculatedAt: new Date(),
    currency: 'INR',
  };
}

/**
 * Pickup-cost component on its own, so auction settlement reuses the exact
 * same math as submission valuation without recomputing a material value.
 */
function computePickupCostPaise(pricingConfig, pickup = {}) {
  const dist = estimateDistanceKm(pickup);
  const basePickupChargePaise =
    pricingConfig?.basePickupChargePaise ?? Math.round(env.business.basePickupCharge * 100);
  const perKmChargePaise =
    pricingConfig?.perKmChargePaise ?? Math.round(env.business.perKmCharge * 100);
  return {
    pickupCostPaise: Math.round(basePickupChargePaise + dist.distanceKm * perKmChargePaise),
    basePickupChargePaise,
    perKmChargePaise,
    estimatedDistanceKm: dist.distanceKm,
    distanceIsProvisional: dist.provisional,
  };
}

/** Normalises a seller's demanded price into both total and per-kg paise. */
function normalizeDemand({
  demandBasis,
  demandedTotalPaise = 0,
  demandedPerKgPaise = 0,
  quantityKg,
}) {
  const weight = Number(quantityKg) || 0;
  if (demandBasis === DEMAND_BASIS.PER_KG) {
    const perKg = Math.round(Number(demandedPerKgPaise) || 0);
    return { demandedPerKgPaise: perKg, demandedTotalPaise: Math.round(perKg * weight) };
  }
  const total = Math.round(Number(demandedTotalPaise) || 0);
  return {
    demandedTotalPaise: total,
    demandedPerKgPaise: weight > 0 ? Math.round(total / weight) : 0,
  };
}

/**
 * Server-authoritative order totals. The client's numbers are never trusted.
 *
 * material subtotal = Σ (weightKg × unitPricePaise)
 * tax               = subtotal × taxPercent%
 * total             = subtotal + tax + transportation + otherFees
 */
function computeOrderTotals({ items, taxPercent, transportationPaise = 0, otherFeesPaise = 0 }) {
  const pricedItems = items.map((item) => {
    const weightKg = round2(item.weightKg);
    const unitPricePaise = Math.round(item.unitPricePaise);
    const subtotalPaise = Math.round(weightKg * unitPricePaise);
    return { ...item, weightKg, unitPricePaise, subtotalPaise };
  });

  const materialSubtotalPaise = pricedItems.reduce((sum, i) => sum + i.subtotalPaise, 0);
  const tax = percentOfPaise(materialSubtotalPaise, taxPercent || 0);
  const transportation = Math.round(Number(transportationPaise) || 0);
  const other = Math.round(Number(otherFeesPaise) || 0);
  const totalPaise = materialSubtotalPaise + tax + transportation + other;

  return {
    items: pricedItems,
    materialSubtotalPaise,
    taxPercent: taxPercent || 0,
    taxPaise: tax,
    transportationPaise: transportation,
    otherFeesPaise: other,
    totalPaise,
  };
}

module.exports = {
  getActivePricing,
  computeValuation,
  computePickupCostPaise,
  normalizeDemand,
  computeOrderTotals,
  qualityMultiplierFor,
};
