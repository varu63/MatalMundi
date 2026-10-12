'use strict';

const mongoose = require('mongoose');
const { ORDER_STATUS, ORDER_STATUS_VALUES } = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const orderItemSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceListing', required: true },
    inventoryLot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', required: true },

    materialName: { type: String, required: true },
    materialType: { type: String, default: '' },
    qualityGrade: { type: String, default: '' },
    condition: { type: String, default: '' },

    weightKg: { type: Number, required: true, min: 0.01 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    subtotalPaise: { type: Number, required: true, min: 0 },

    reservedWeightKg: { type: Number, default: 0, min: 0 },
    fulfilledWeightKg: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUS_VALUES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    delivery: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      phone: { type: String, required: true, trim: true, maxlength: 20 },
      address: { type: String, required: true, trim: true, maxlength: 300 },
      city: { type: String, required: true, trim: true, maxlength: 100 },
      state: { type: String, required: true, trim: true, maxlength: 100 },
      postalCode: { type: String, required: true, trim: true, maxlength: 20 },
    },

    items: { type: [orderItemSchema], default: [] },

    materialSubtotalPaise: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    taxPaise: { type: Number, default: 0, min: 0 },
    transportationPaise: { type: Number, default: 0, min: 0 },
    otherFeesPaise: { type: Number, default: 0, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },

    quoteIsProvisional: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ORDER_STATUS_VALUES,
      default: ORDER_STATUS.PENDING_ADMIN_APPROVAL,
      index: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },

    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: '' },
    adminNotes: { type: String, trim: true, maxlength: 2000, default: '' },

    // Reservation lifecycle flags (guarded so we never double-release).
    inventoryReserved: { type: Boolean, default: false },
    inventoryCommitted: { type: Boolean, default: false },

    // Placeholder for a future payment integration.
    payment: {
      status: { type: String, enum: ['UNPAID', 'PAID', 'REFUNDED'], default: 'UNPAID' },
      provider: { type: String, default: '' },
      reference: { type: String, default: '' },
      paidAt: { type: Date },
    },
  },
  baseSchemaOptions(),
);

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
