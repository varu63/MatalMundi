'use strict';

const listingsRepo = require('../repositories/listings');
const lotsRepo = require('../repositories/lots');
const ordersRepo = require('../repositories/orders');
const pricingRepo = require('../repositories/pricing');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created, paginated } = require('../utils/apiResponse');
const { serializeOrder } = require('../utils/serializers');
const { computeOrderTotals } = require('../services/pricingService');
const { notifyOrder } = require('../services/notificationService');
const { recordAudit } = require('../services/auditService');
const { generateReference } = require('../utils/idGenerator');
const { parsePage } = require('../utils/numbers');
const {
  ORDER_STATUS,
  ROLES,
  AUDIT_ACTION,
} = require('../utils/constants');
const env = require('../config/env');

/**
 * POST /orders
 * The client sends only listing ids and weights. Every price, tax and total is
 * recomputed here from the database — client totals are never trusted.
 */
const createOrder = asyncHandler(async (req, res) => {
  const { items: requestedItems, delivery, notes } = req.body;

  // Collapse duplicate listing ids and validate against live, sellable stock.
  const resolved = [];
  for (const item of requestedItems) {
    // eslint-disable-next-line no-await-in-loop
    const listing = await listingsRepo.findSellableById(item.listingId);

    if (!listing) {
      throw ApiError.badRequest('One or more selected materials are no longer available');
    }

    // Authoritative stock check against the inventory lot.
    // eslint-disable-next-line no-await-in-loop
    const lot = await lotsRepo.findById(listing.inventoryLotId);
    if (!lot) throw ApiError.conflict('Inventory for a selected material is unavailable');

    const weightKg = Number(item.weightKg);
    if (weightKg <= 0) throw ApiError.badRequest('Weight must be greater than zero');
    if (listing.minPurchaseKg > 0 && weightKg < listing.minPurchaseKg) {
      throw ApiError.badRequest(
        `Minimum purchase for "${listing.title}" is ${listing.minPurchaseKg} kg`,
      );
    }
    if (weightKg > lot.availableQuantityKg) {
      throw ApiError.badRequest(
        `Only ${lot.availableQuantityKg} kg of "${listing.title}" is currently available`,
      );
    }

    const existing = resolved.find((r) => String(r.listing.id) === String(listing.id));
    if (existing) {
      existing.weightKg += weightKg; // merge duplicates
    } else {
      resolved.push({ listing, lot, weightKg });
    }
  }

  // Re-check merged weights against stock.
  for (const r of resolved) {
    if (r.weightKg > r.lot.availableQuantityKg) {
      throw ApiError.badRequest(
        `Only ${r.lot.availableQuantityKg} kg of "${r.listing.title}" is currently available`,
      );
    }
  }

  // Per-material tax: use the active pricing config for each material category.
  const categoryIds = [...new Set(resolved.map((r) => String(r.listing.materialCategoryId)))];
  const pricingConfigs = await pricingRepo.findActiveForCategories(categoryIds);
  const taxForCategory = (categoryId) => {
    const cfg = pricingConfigs.find(
      (c) => String(c.materialCategoryId) === String(categoryId) && !c.materialType,
    ) || pricingConfigs.find((c) => String(c.materialCategoryId) === String(categoryId));
    return cfg ? cfg.taxPercent : env.business.taxPercent;
  };

  const pricedInputs = resolved.map((r) => ({
    listing: r.listing.id,
    inventoryLot: r.lot.id,
    materialName: r.listing.title,
    materialType: r.listing.materialType,
    qualityGrade: r.listing.qualityGrade,
    condition: r.listing.condition,
    weightKg: r.weightKg,
    unitPricePaise: r.listing.pricePerKgPaise,
    taxPercent: taxForCategory(r.listing.materialCategoryId),
  }));

  const totals = computeOrderTotals({
    items: pricedInputs,
    taxPercent: 0, // per-item tax is applied below
    transportationPaise: 0,
    otherFeesPaise: 0,
  });

  // Apply per-item tax and derive an effective order tax rate for display.
  let taxPaise = 0;
  totals.items.forEach((it, idx) => {
    const pct = pricedInputs[idx].taxPercent || 0;
    taxPaise += Math.round((it.subtotalPaise * pct) / 100);
  });
  const effectiveTaxPercent = totals.materialSubtotalPaise > 0
    ? Math.round((taxPaise / totals.materialSubtotalPaise) * 10000) / 100
    : 0;
  const totalPaise = totals.materialSubtotalPaise + taxPaise + totals.transportationPaise + totals.otherFeesPaise;

  const order = await ordersRepo.create({
    orderNumber: generateReference('ORD'),
    buyerId: req.user.id,
    delivery,
    items: totals.items.map((it) => ({
      listing: it.listing,
      inventoryLot: it.inventoryLot,
      materialName: it.materialName,
      materialType: it.materialType,
      qualityGrade: it.qualityGrade,
      condition: it.condition,
      weightKg: it.weightKg,
      unitPricePaise: it.unitPricePaise,
      subtotalPaise: it.subtotalPaise,
      reservedWeightKg: 0,
      fulfilledWeightKg: 0,
    })),
    materialSubtotalPaise: totals.materialSubtotalPaise,
    taxPercent: effectiveTaxPercent,
    taxPaise,
    transportationPaise: totals.transportationPaise,
    otherFeesPaise: totals.otherFeesPaise,
    totalPaise,
    // Delivery cost is not computed from any real logistics source -> provisional.
    quoteIsProvisional: true,
    status: ORDER_STATUS.PENDING_ADMIN_APPROVAL,
    statusHistory: [{
      status: ORDER_STATUS.PENDING_ADMIN_APPROVAL,
      at: new Date(),
      by: req.user.id,
      note: 'Purchase request submitted',
    }],
    notes: notes || '',
  });

  await notifyOrder(
    req.user.id,
    'Purchase request submitted',
    `Your purchase request ${order.orderNumber} was submitted and is pending review.`,
    order.id,
  );
  await recordAudit({ action: AUDIT_ACTION.ORDER_CREATE, resourceType: 'Order', resourceId: order.id, req });

  return created(res, { order: serializeOrder(order) }, 'Purchase request submitted');
});

/** GET /orders/my */
const myOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await ordersRepo.list({
    buyerId: req.user.id,
    status: req.query.status,
    skip,
    take: limit,
  });
  const items = rows.map(serializeOrder);
  return paginated(res, items, { page, limit, total });
});

/** GET /orders/:id — buyer or admin only. */
const getOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findDetail(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const isAdmin = req.user.role === ROLES.ADMIN;
  const isOwner = String(order.buyerId) === String(req.user.id);
  if (!isAdmin && !isOwner) throw ApiError.forbidden('You cannot view this order');

  return ok(res, { order: serializeOrder(order) });
});

module.exports = { createOrder, myOrders, getOrder };
