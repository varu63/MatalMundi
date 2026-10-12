'use strict';

const mongoose = require('mongoose');
const {
  SUBMISSION_STATUS,
  SUBMISSION_STATUS_VALUES,
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
  DEMAND_BASIS,
} = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    provider: { type: String, enum: ['cloudinary', 'local'], default: 'local' },
  },
  { _id: false },
);

const pickupSchema = new mongoose.Schema(
  {
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true, trim: true, maxlength: 20 },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    contactPhone: { type: String, required: true, trim: true, maxlength: 20 },
  },
  { _id: false },
);

const valuationSchema = new mongoose.Schema(
  {
    pricingConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingConfiguration' },
    pricingVersion: { type: Number },
    materialRatePerKgPaise: { type: Number, default: 0 },
    qualityMultiplier: { type: Number, default: 1 },
    materialValuePaise: { type: Number, default: 0 },

    basePickupChargePaise: { type: Number, default: 0 },
    estimatedDistanceKm: { type: Number, default: 0 },
    perKmChargePaise: { type: Number, default: 0 },
    pickupCostPaise: { type: Number, default: 0 },
    distanceIsProvisional: { type: Boolean, default: true },

    platformFeePercent: { type: Number, default: 0 },
    platformFeePaise: { type: Number, default: 0 },

    estimatedPayoutPaise: { type: Number, default: 0 },
    isProvisional: { type: Boolean, default: true },
    calculatedAt: { type: Date, default: Date.now },
    currency: { type: String, default: 'INR' },
  },
  { _id: false },
);

const wasteSubmissionSchema = new mongoose.Schema(
  {
    submissionNumber: { type: String, required: true, unique: true, index: true },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    materialCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaterialCategory',
      required: true,
      index: true,
    },
    materialType: { type: String, required: true, trim: true, maxlength: 120 },
    quantityKg: { type: Number, required: true, min: 100 },
    condition: { type: String, enum: MATERIAL_CONDITIONS, required: true },
    qualityGrade: { type: String, enum: QUALITY_GRADES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },

    images: {
      front: { type: imageSchema, required: true },
      back: { type: imageSchema, required: true },
      left: { type: imageSchema, required: true },
      right: { type: imageSchema, required: true },
      additional: { type: [imageSchema], default: [] },
    },

    pickup: { type: pickupSchema, required: true },

    demandBasis: { type: String, enum: Object.values(DEMAND_BASIS), required: true },
    demandedTotalPaise: { type: Number, min: 0, default: 0 },
    demandedPerKgPaise: { type: Number, min: 0, default: 0 },

    valuation: { type: valuationSchema, default: () => ({}) },

    proposedPurchasePricePaise: { type: Number, min: 0, default: 0 },
    proposedPurchasePriceSetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    proposedPurchasePriceSetAt: { type: Date },

    acceptedQuantityKg: { type: Number, min: 0, default: 0 },

    status: {
      type: String,
      enum: SUBMISSION_STATUS_VALUES,
      default: SUBMISSION_STATUS.PENDING_APPROVAL,
      index: true,
    },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: '' },

    adminNotes: { type: [{
      note: { type: String, trim: true, maxlength: 2000 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date, default: Date.now },
    }], default: [] },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    collectedAt: { type: Date },
    pickupDate: { type: Date },

    inventoryLot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceListing' },
  },
  baseSchemaOptions(),
);

wasteSubmissionSchema.index({ status: 1, createdAt: -1 });
wasteSubmissionSchema.index({ seller: 1, createdAt: -1 });
wasteSubmissionSchema.index({ materialCategory: 1, materialType: 1 });

module.exports = mongoose.model('WasteSubmission', wasteSubmissionSchema);
