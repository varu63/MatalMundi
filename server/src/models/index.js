'use strict';

// Central model registry so route/controller files can import from one place.
module.exports = {
  User: require('./User'),
  MaterialCategory: require('./MaterialCategory'),
  PricingConfiguration: require('./PricingConfiguration'),
  WasteSubmission: require('./WasteSubmission'),
  InventoryLot: require('./InventoryLot'),
  MarketplaceListing: require('./MarketplaceListing'),
  Order: require('./Order'),
  Notification: require('./Notification'),
  AuditLog: require('./AuditLog'),
  InventoryMovement: require('./InventoryMovement'),
};
