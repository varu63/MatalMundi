'use strict';

const ordersRepo = require('../../repositories/orders');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { serializeOrder } = require('../../utils/serializers');
const { notifyOrder } = require('../../services/notificationService');
const { recordAudit } = require('../../services/auditService');
const {
  reserveOrderItems,
  releaseOrderItems,
  commitOrderItems,
} = require('../../services/inventoryService');
const {
  statusLabel,
  assertStatusGate,
  setInspection,
  setDeliveryCharge,
  releaseAddress,
} = require('../../services/orderWorkflowService');
const { parsePage } = require('../../utils/numbers');
const {
  ORDER_TRANSITIONS,
  ORDER_STATUS,
  INSPECTION_STATUS,
  AUDIT_ACTION,
} = require('../../utils/constants');

/** GET /admin/orders */
const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await ordersRepo.list({
    status: req.query.status,
    search: req.query.search,
    skip,
    take: limit,
    populateBuyer: true,
  });
  return paginated(
    res,
    rows.map((order) => serializeOrder(order, { viewer: req.user, isAdmin: true })),
    { page, limit, total }
  );
});

/** GET /admin/orders/:id */
const getOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findDetail(req.params.id, { buyerFull: true });
  if (!order) return ok(res, { order: null });
  return ok(res, { order: serializeOrder(order, { viewer: req.user, isAdmin: true }) });
});

/**
 * PATCH /admin/orders/:id/status
 * Inventory side effects:
 *  ACCEPTED   -> atomically reserve stock from every lot (rollback on failure)
 *  REJECTED/CANCELLED -> release any reservation (never double-release)
 *  DELIVERED  -> commit reservation to sold stock (once)
 */
const updateStatus = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  // Auction orders follow the auction payment/pickup workflow instead.
  if (order.auctionId) {
    throw ApiError.conflict(
      'This order was created by an auction. Manage it from Auction Management.'
    );
  }

  const next = req.body.status;
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(`Cannot change order from ${order.status} to ${next}`);
  }
  assertStatusGate(order, next);

  const actor = req.user.id;
  const previousStatus = order.status;
  const data = { status: next };
  let inventoryReserved = order.inventoryReserved;
  let inventoryCommitted = order.inventoryCommitted;

  // 1. ACCEPTED — reserve inventory now.
  if (next === ORDER_STATUS.ACCEPTED && !inventoryReserved) {
    try {
      await reserveOrderItems(order.items, order.id, actor);
      inventoryReserved = true;
    } catch (err) {
      throw ApiError.conflict(`Could not reserve stock: ${err.message}`);
    }
  }

  // 2. REJECTED / CANCELLED — release the reservation exactly once.
  if (
    (next === ORDER_STATUS.REJECTED || next === ORDER_STATUS.CANCELLED) &&
    inventoryReserved &&
    !inventoryCommitted
  ) {
    await releaseOrderItems(order.items, order.id, actor, `Order ${next}: reservation released`);
    inventoryReserved = false;
  }

  // 3. DELIVERED — commit reservation to sold stock exactly once.
  if (next === ORDER_STATUS.DELIVERED) {
    if (inventoryReserved && !inventoryCommitted) {
      await commitOrderItems(order.items, order.id, actor);
      inventoryCommitted = true;
      inventoryReserved = false;
    }
    // Payment is never marked on the seller's say-so: there is no payment
    // provider in this application, so an order is only PAID once a real
    // payment has been recorded against it.
  }

  if ((next === ORDER_STATUS.REJECTED || next === ORDER_STATUS.CANCELLED) && req.body.reason) {
    data.rejectionReason = req.body.reason;
  }

  data.inventoryReserved = inventoryReserved;
  data.inventoryCommitted = inventoryCommitted;
  data.statusHistory = [
    ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
    { status: next, at: new Date(), by: actor, note: req.body.reason || '' },
  ];

  const updated = await ordersRepo.updateById(order.id, data);

  await notifyOrder(
    order.buyerId,
    `Order ${statusLabel(next)}`,
    `Your order ${order.orderNumber} is now ${statusLabel(next)}.${req.body.reason ? ` ${req.body.reason}` : ''}`,
    order.id
  );
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { status: previousStatus },
    after: {
      status: next,
      inventoryReserved: updated.inventoryReserved,
      inventoryCommitted: updated.inventoryCommitted,
    },
    req,
  });

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user, isAdmin: true }) },
    `Order moved to ${next}`
  );
});

/** PATCH /admin/orders/:id/inspection */
const updateInspection = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const { order: updated, inspection } = await setInspection(order, req.user.id, req.body);

  if (inspection.status === INSPECTION_STATUS.PASSED) {
    const changed = Number(inspection.actualQuantityKg) &&
      Number(inspection.quantityChangedFromKg) &&
      Number(inspection.actualQuantityKg) !== Number(inspection.quantityChangedFromKg);
    await notifyOrder(
      order.buyerId,
      'Inspection passed',
      changed
        ? `Inspection for ${order.orderNumber} passed. The weighed-out quantity is ${inspection.actualQuantityKg} kg (booked ${inspection.quantityChangedFromKg} kg), so the totals have been revised. A delivery charge will follow for your confirmation.`
        : `Inspection for ${order.orderNumber} passed. A delivery charge will be shared for your confirmation.`,
      order.id
    );
    if (order.sellerId) {
      await notifyOrder(
        order.sellerId,
        'Inspection passed',
        `Inspection for ${order.orderNumber} passed. The buyer will confirm the delivery charge next.`,
        order.id
      );
    }
  } else if (inspection.status === INSPECTION_STATUS.IN_PROGRESS) {
    if (order.sellerId) {
      await notifyOrder(
        order.sellerId,
        'Inspection in progress',
        `The inspection for ${order.orderNumber} has started.`,
        order.id
      );
    }
  } else if (inspection.status === INSPECTION_STATUS.FAILED) {
    await notifyOrder(
      order.buyerId,
      'Inspection failed',
      `Inspection for ${order.orderNumber} failed. Reason: ${inspection.failureReason}`,
      order.id
    );
    if (order.sellerId) {
      await notifyOrder(
        order.sellerId,
        'Inspection failed',
        `Inspection for ${order.orderNumber} failed. Reason: ${inspection.failureReason}`,
        order.id
      );
    }
  } else if (inspection.status === INSPECTION_STATUS.SCHEDULED) {
    await notifyOrder(
      order.buyerId,
      'Inspection scheduled',
      `Inspection for ${order.orderNumber} has been scheduled.`,
      order.id
    );
  }

  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { inspectionStatus: order.inspectionStatus, status: order.status },
    after: {
      inspectionStatus: inspection.status,
      status: updated.status,
      inspectionId: inspection.id,
    },
    req,
  });

  const fresh = await ordersRepo.findDetail(order.id, { buyerFull: true });
  return ok(
    res,
    {
      order: serializeOrder(fresh || updated, { viewer: req.user, isAdmin: true }),
      inspection,
    },
    `Inspection ${inspection.status.toLowerCase().replace('_', ' ')}`
  );
});

/** PATCH /admin/orders/:id/delivery-charge */
const setOrderDeliveryCharge = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const updated = await setDeliveryCharge(order, req.user.id, {
    chargePaise: req.body.deliveryChargePaise,
    notes: req.body.notes,
  });

  await notifyOrder(
    order.buyerId,
    'Delivery charge ready',
    `Delivery charge for ${order.orderNumber} is ${(updated.deliveryChargePaise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })}. Review and confirm it in your order.`,
    order.id
  );
  if (order.sellerId) {
    await notifyOrder(
      order.sellerId,
      'Awaiting buyer confirmation',
      `The delivery charge for ${order.orderNumber} has been set. Waiting for the buyer to confirm.`,
      order.id
    );
  }

  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: {
      deliveryChargePaise: order.deliveryChargePaise,
      deliveryChargeStatus: order.deliveryChargeStatus,
      status: order.status,
    },
    after: {
      deliveryChargePaise: updated.deliveryChargePaise,
      deliveryChargeStatus: updated.deliveryChargeStatus,
      status: updated.status,
    },
    req,
  });

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user, isAdmin: true }) },
    'Delivery charge sent to buyer for confirmation'
  );
});

/** POST /admin/orders/:id/release-address */
const releaseOrderAddress = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const updated = await releaseAddress(order, req.user.id, req.body.reason);
  if (order.sellerId) {
    await notifyOrder(
      order.sellerId,
      'Delivery address released',
      `Delivery details for ${order.orderNumber} are now available in your seller orders.`,
      order.id
    );
  }
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { addressReleased: order.addressReleased },
    after: { addressReleased: true, reason: updated.addressReleaseReason },
    req,
  });

  return ok(
    res,
    { order: serializeOrder(updated, { viewer: req.user, isAdmin: true }) },
    'Delivery address released'
  );
});

module.exports = {
  listOrders,
  getOrder,
  updateStatus,
  updateInspection,
  setOrderDeliveryCharge,
  releaseOrderAddress,
};
