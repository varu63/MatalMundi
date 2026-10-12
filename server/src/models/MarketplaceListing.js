'use strict';

const mongoose = require('mongoose');
const {
  LISTING_STATUS,
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
} = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

/**
 * Public marketplace listing. One listing maps to exactly one InventoryLot
 * (source traceability). The lot is authoritative for stock; the listing keeps
 * a denormalised `availableQuantityKg` cache that is refreshed from the lot
 * after every stock change and used for fast marketplace filtering.
 */
const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    materialCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaterialCategory',
      required: true,
      index: true,
    },
    materialType: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },

    images: { type: [{ url: String, publicId: String, provider: String, _id: false }], default: [] },

    inventoryLot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryLot',
      required: true,
      unique: true,
      index: true,
    },
    sourceSubmission: { type: mongoose.Schema.Types.ObjectId, ref: 'WasteSubmission' },

    qualityGrade: { type: String, enum: QUALITY_GRADES, required: true },
    condition: { type: String, enum: MATERIAL_CONDITIONS, required: true },

    pricePerKgPaise: { type: Number, required: true, min: 0 },
    minPurchaseKg: { type: Number, default: 0, min: 0 },

    acceptedQuantityKg: { type: Number, default: 0, min: 0 },
    availableQuantityKg: { type: Number, default: 0, min: 0 },
    reservedQuantityKg: { type: Number, default: 0, min: 0 },
    soldQuantityKg: { type: Number, default: 0, min: 0 },

    location: {
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
    },
    deliveryTerms: { type: String, trim: true, maxlength: 500, default: 'Pickup from MetalMundi facility' },

    publicationStatus: {
      type: String,
      enum: Object.values(LISTING_STATUS),
      default: LISTING_STATUS.DRAFT,
      index: true,
    },
    active: { type: Boolean, default: false, index: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
  },
  baseSchemaOptions(),
);

listingSchema.index({ active: 1, publicationStatus: 1, availableQuantityKg: 1 });
listingSchema.index({ pricePerKgPaise: 1 });
listingSchema.index({ createdAt: -1 });
// Text search on title / material type / description.
listingSchema.index(
  { title: 'text', materialType: 'text', description: 'text' },
  { weights: { title: 5, materialType: 3, description: 1 }, name: 'listing_text' },
);

module.exports = mongoose.model('MarketplaceListing', listingSchema);
