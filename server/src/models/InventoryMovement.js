'use strict';

const mongoose = require('mongoose');
const { INVENTORY_MOVEMENT_TYPE } = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const inventoryMovementSchema = new mongoose.Schema(
  {
    lot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', required: true, index: true },
    type: {
      type: String,
      enum: Object.values(INVENTORY_MOVEMENT_TYPE),
      required: true,
      index: true,
    },
    quantityKg: { type: Number, required: true },
    balanceAvailableKg: { type: Number, default: 0 },
    balanceReservedKg: { type: Number, default: 0 },
    balanceSoldKg: { type: Number, default: 0 },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  baseSchemaOptions({ updatedAt: false }),
);

inventoryMovementSchema.index({ lot: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);
