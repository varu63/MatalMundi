'use strict';

const { Order } = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { notifyOrder } = require('../../services/notificationService');
const { recordAudit } = require('../../services/auditService');
const {
  reserveOrderItems,
  releaseOrderItems,
  commitOrderItems,
} = require('../../services/inventoryService');
const { parsePage } = require('../../utils/numbers');
const { ORDER_TRANSITIONS, ORDER_STATUS, AUDIT_ACTION } = require('../../utils/constants');

const STATUS_LABELS = {
  [ORDER_STATUS.PENDING_ADMIN_APPROVAL]: 'Awaiting admin approval',
  [ORDER_STATUS.ACCEPTED]: 'Accepted',
  [ORDER_STATUS.REJECTED]: 'Rejected',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.PROCESSING]: 'Processing',
  [ORDER_STATUS.READY_FOR_DISPATCH]: 'Ready for dispatch',
  [ORDER_STATUS.DISPATCHED]: 'Dispatched',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

/** GET /admin/orders */
const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const term = String(req.query.search).trim();
    filter.$or = [{ orderNumber: { $regex: term, $options: 'i' } }];
  }

  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('buyer', 'name email phone')
      .lean(),
    Order.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

/** GET /admin/orders/:id */
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('buyer', 'name email phone address')
    .populate('items.listing', 'title materialType qualityGrade condition pricePerKgPaise active publicationStatus')
    .populate('items.inventoryLot', 'lotNumber lotStatus');
  if (!order) return ok(res, { order: null });
  return ok(res, { order });
});

/**
 * PATCH /admin/orders/:id/status
 * Inventory side effects:
 *  ACCEPTED   -> atomically reserve stock from every lot (rollback on failure)
 *  REJECTED/CANCELLED -> release any reservation (never double-release)
 *  DELIVERED  -> commit reservation to sold stock (once)
 */
const updateStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const next = req.body.status;
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(`Cannot change order from ${order.status} to ${next}`);
  }

  const actor = req.user._id;
  const previousStatus = order.status;

  // 1. ACCEPTED — reserve inventory now.
  if (next === ORDER_STATUS.ACCEPTED && !order.inventoryReserved) {
    try {
      await reserveOrderItems(order.items, order._id, actor);
      order.inventoryReserved = true;
    } catch (err) {
      throw ApiError.conflict(`Could not reserve stock: ${err.message}`);
    }
  }

  // 2. REJECTED / CANCELLED — release the reservation exactly once.
  if ((next === ORDER_STATUS.REJECTED || next === ORDER_STATUS.CANCELLED)
      && order.inventoryReserved && !order.inventoryCommitted) {
    await releaseOrderItems(order.items, order._id, actor, `Order ${next}: reservation released`);
    order.inventoryReserved = false;
  }

  // 3. DELIVERED — commit reservation to sold stock exactly once.
  if (next === ORDER_STATUS.DELIVERED) {
    if (order.inventoryReserved && !order.inventoryCommitted) {
      await commitOrderItems(order.items, order._id, actor);
      order.inventoryCommitted = true;
      order.inventoryReserved = false;
    }
    if (order.payment.status === 'UNPAID') order.payment.status = 'PAID';
  }

  if (next === ORDER_STATUS.REJECTED && req.body.reason) {
    order.rejectionReason = req.body.reason;
  }
  if (req.body.reason && next === ORDER_STATUS.CANCELLED) {
    order.rejectionReason = req.body.reason;
  }

  order.status = next;
  order.statusHistory.push({ status: next, at: new Date(), by: actor, note: req.body.reason || '' });
  await order.save();

  await notifyOrder(
    order.buyer,
    `Order ${STATUS_LABELS[next] || next}`,
    `Your order ${order.orderNumber} is now ${STATUS_LABELS[next] || next}.${req.body.reason ? ` ${req.body.reason}` : ''}`,
    order._id,
  );
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order._id,
    before: { status: previousStatus },
    after: { status: next, inventoryReserved: order.inventoryReserved, inventoryCommitted: order.inventoryCommitted },
    req,
  });

  return ok(res, { order }, `Order moved to ${next}`);
});

module.exports = { listOrders, getOrder, updateStatus };