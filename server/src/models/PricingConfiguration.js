'use strict';

const mongoose = require('mongoose');
const { DEFAULT_QUALITY_MULTIPLIERS } = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const qualityMultiplierSchema = new mongoose.Schema(
  {
    A: { type: Number, default: DEFAULT_QUALITY_MULTIPLIERS.A, min: 0 },
    B: { type: Number, default: DEFAULT_QUALITY_MULTIPLIERS.B, min: 0 },
    C: { type: Number, default: DEFAULT_QUALITY_MULTIPLIERS.C, min: 0 },
    D: { type: Number, default: DEFAULT_QUALITY_MULTIPLIERS.D, min: 0 },
  },
  { _id: false },
);

/**
 * A versioned pricing rule. The most recent `active` rule for a
 * (category, materialType) pair is the authoritative one, but every waste
 * submission stores a snapshot of the rule used so history never changes.
 */
const pricingConfigSchema = new mongoose.Schema(
  {
    materialCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaterialCategory',
      required: true,
      index: true,
    },
    materialType: { type: String, trim: true, default: '', index: true },

    ratePerKgPaise: { type: Number, required: true, min: 0 },
    qualityMultipliers: { type: qualityMultiplierSchema, default: () => ({}) },

    basePickupChargePaise: { type: Number, default: 50000, min: 0 },
    perKmChargePaise: { type: Number, default: 1200, min: 0 },
    platformFeePercent: { type: Number, default: 5, min: 0, max: 100 },
    taxPercent: { type: Number, default: 18, min: 0, max: 100 },

    version: { type: Number, default: 1, min: 1 },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, maxlength: 500, default: '' },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  baseSchemaOptions(),
);

pricingConfigSchema.index({ materialCategory: 1, materialType: 1, active: 1, version: -1 });

module.exports = mongoose.model('PricingConfiguration', pricingConfigSchema);
