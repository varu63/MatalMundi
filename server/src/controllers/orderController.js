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
const { createReservedOrder } = require('../services/orderBookingService');
const {
  confirmBuyerOrder,
  declineBuyerOrder,
  updateSellerStatus,
  statusLabel,
} = require('../services/orderWorkflowService');
const { parsePage } = require('../utils/numbers');
const { ROLES, AUDIT_ACTION } = require('../utils/constants');
const env = require('../config/env');

/**
 * POST /orders
 * The client sends only listing ids and weights. Every price, tax and total is
 * recomputed here from the database — client totals are never trusted.
 */
const createOrder = asyncHandler(async (req, res) => {
  const { items: requestedItems, delivery, notes, idempotencyKey } = req.body;

  // Collapse duplicate listing ids and validate against live, sellable stock.
  const resolved = [];
  for (const item of requestedItems) {
    const listing = await listingsRepo.findSellableById(item.listingId);

    if (!listing) {
      throw ApiError.badRequest('One or more selected materials are no longer available');
    }

    // Authoritative stock check against the inventory lot.

    const lot = await lotsRepo.findById(listing.inventoryLotId);
    if (!lot) throw ApiError.conflict('Inventory for a selected material is unavailable');

    const weightKg = Number(item.weightKg);
    if (weightKg <= 0) throw ApiError.badRequest('Weight must be greater than zero');
    if (listing.minPurchaseKg > 0 && weightKg < listing.minPurchaseKg) {
      throw ApiError.badRequest(
        `Minimum purchase for "${listing.title}" is ${listing.minPurchaseKg} kg`
      );
    }
    if (weightKg > lot.availableQuantityKg) {
      throw ApiError.badRequest(
        `Only ${lot.availableQuantityKg} kg of "${listing.title}" is currently available`
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
        `Only ${r.lot.availableQuantityKg} kg of "${r.listing.title}" is currently available`
      );
    }
  }

  // Per-material tax: use the active pricing config for each material category.
  const categoryIds = [...new Set(resolved.map((r) => String(r.listing.materialCategoryId)))];
  const pricingConfigs = await pricingRepo.findActiveForCategories(categoryIds);
  const taxForCategory = (categoryId) => {
    const cfg =
      pricingConfigs.find(
        (c) => String(c.materialCategoryId) === String(categoryId) && !c.materialType
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
  const effectiveTaxPercent =
    totals.materialSubtotalPaise > 0
      ? Math.round((taxPaise / totals.materialSubtotalPaise) * 10000) / 100
      : 0;
  const totalPaise =
    totals.materialSubtotalPaise + taxPaise + totals.transportationPaise + totals.otherFeesPaise;

  const { order, duplicate } = await createReservedOrder({
    buyerId: req.user.id,
    idempotencyKey,
    delivery,
    notes,
    items: resolved,
    materialSubtotalPaise: totals.materialSubtotalPaise,
    taxPercent: effectiveTaxPercent,
    taxPaise,
    totalPaise,
  });

  if (!duplicate) {
    await notifyOrder(
      req.user.id,
      'Purchase request submitted',
      `Your purchase request ${order.orderNumber} was submitted and is pending review.`,
      order.id
    );
    if (order.sellerId) {
      await notifyOrder(
        order.sellerId,
        'New purchase request',
        `A buyer has requested ${order.items.reduce((sum, item) => sum + item.weightKg, 0)} kg of your material. Inspection will be arranged before contact details are shared.`,
        order.id
      );
    }
    await recordAudit({
      action: AUDIT_ACTION.ORDER_CREATE,
      resourceType: 'Order',
      resourceId: order.id,
      req,
    });
  }

  return created(
    res,
    { order: serializeOrder(order, { viewer: req.user }) },
    'Purchase request submitted'
  );
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
  const items = rows.map((order) => serializeOrder(order, { viewer: req.user }));
  return paginated(res, items, { page, limit, total });
});

/** GET /orders/selling — orders where the current user is the seller. */
const sellerOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await ordersRepo.list({
    sellerId: req.user.id,
    status: req.query.status,
    skip,
    take: limit,
    populateBuyer: true,
  });
  const items = rows.map((order) => serializeOrder(order, { viewer: req.user }));
  return paginated(res, items, { page, limit, total });
});

/** GET /orders/:id — buyer, seller or admin. */
const getOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findDetail(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const isAdmin = req.user.role === ROLES.ADMIN;
  const isBuyer = String(order.buyerId) === String(req.user.id);
  const isSeller = order.sellerId && String(order.sellerId) === String(req.user.id);
  if (!isAdmin && !isBuyer && !isSeller) {
    throw ApiError.forbidden('You cannot view this order');
  }

  return ok(res, {
    order: serializeOrder(order, { viewer: req.user, isAdmin }),
  });
});

/** PATCH /orders/:id/confirm — buyer accepts the delivery charge. */
const confirmOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (String(order.buyerId) !== String(req.user.id)) {
    throw ApiError.forbidden('Only the buyer can confirm this order');
  }

  const updated = await confirmBuyerOrder(order, req.user.id, req.body.note);
  await notifyOrder(
    order.buyerId,
    'Order confirmed',
    `Your order ${order.orderNumber} is confirmed. The seller can now see your delivery details.`,
    order.id
  );
  if (order.sellerId) {
    await notifyOrder(
      order.sellerId,
      'Buyer confirmed the order',
      `The buyer confirmed delivery charge for ${order.orderNumber}. Review the delivery details in your seller orders.`,
      order.id
    );
  }
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { status: order.status },
    after: { status: updated.status, addressReleased: true },
    req,
  });

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user }) },
    'Order confirmed'
  );
});

/** PATCH /orders/:id/decline — buyer rejects the delivery charge. */
const declineOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (String(order.buyerId) !== String(req.user.id)) {
    throw ApiError.forbidden('Only the buyer can decline this order');
  }

  const updated = await declineBuyerOrder(order, req.user.id, req.body.reason);
  await notifyOrder(
    order.buyerId,
    'Order cancelled',
    `You declined the delivery charge for ${order.orderNumber}. The order has been cancelled.`,
    order.id
  );
  if (order.sellerId) {
    await notifyOrder(
      order.sellerId,
      'Order cancelled',
      `The buyer declined the delivery charge for ${order.orderNumber}.`,
      order.id
    );
  }
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { status: order.status },
    after: { status: updated.status },
    req,
  });

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user }) },
    'Order cancelled'
  );
});

/** PATCH /orders/:id/status — seller fulfilment after address release. */
const updateSellerOrderStatus = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!order.sellerId || String(order.sellerId) !== String(req.user.id)) {
    throw ApiError.forbidden('You cannot update this order');
  }

  const updated = await updateSellerStatus(
    order,
    req.user.id,
    req.body.status,
    req.body.note || ''
  );
  await notifyOrder(
    order.buyerId,
    `Order ${statusLabel(updated.status)}`,
    `Your order ${order.orderNumber} is now ${statusLabel(updated.status)}.`,
    order.id
  );

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user }) },
    `Order moved to ${updated.status}`
  );
});

module.exports = {
  createOrder,
  myOrders,
  sellerOrders,
  getOrder,
  confirmOrder,
  declineOrder,
  updateSellerOrderStatus,
};
