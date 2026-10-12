'use strict';

const mongoose = require('mongoose');
const { NOTIFICATION_TYPE } = require('../utils/constants');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      default: NOTIFICATION_TYPE.SYSTEM,
      index: true,
    },
    relatedType: { type: String, enum: ['WasteSubmission', 'Order', 'User', ''], default: '' },
    relatedId: { type: mongoose.Schema.Types.ObjectId },
    read: { type: Boolean, default: false, index: true },
  },
  baseSchemaOptions({ updatedAt: false }),
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
