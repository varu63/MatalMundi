'use strict';

const mongoose = require('mongoose');
const {
  INVENTORY_LOT_STATUS,
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
} = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

/**
 * Authoritative stock record. One lot per accepted waste submission so that
 * different sellers' material is never merged (source traceability).
 * `available + reserved + sold` should always equal `acceptedQuantityKg`.
 */
const inventoryLotSchema = new mongoose.Schema(
  {
    lotNumber: { type: String, required: true, unique: true, index: true },
    sourceSubmission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WasteSubmission',
      index: true,
    },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    materialCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaterialCategory',
      required: true,
      index: true,
    },
    materialType: { type: String, required: true, trim: true, index: true },
    qualityGrade: { type: String, enum: QUALITY_GRADES, required: true },
    condition: { type: String, enum: MATERIAL_CONDITIONS, required: true },

    acceptedQuantityKg: { type: Number, required: true, min: 0 },
    availableQuantityKg: { type: Number, required: true, min: 0 },
    reservedQuantityKg: { type: Number, default: 0, min: 0 },
    soldQuantityKg: { type: Number, default: 0, min: 0 },

    location: {
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
    },

    lotStatus: {
      type: String,
      enum: Object.values(INVENTORY_LOT_STATUS),
      default: INVENTORY_LOT_STATUS.ACCEPTED,
      index: true,
    },
    receivedAt: { type: Date, default: Date.now },
  },
  baseSchemaOptions(),
);

inventoryLotSchema.index({ materialCategory: 1, materialType: 1, lotStatus: 1 });
inventoryLotSchema.index({ availableQuantityKg: 1 });

module.exports = mongoose.model('InventoryLot', inventoryLotSchema);
