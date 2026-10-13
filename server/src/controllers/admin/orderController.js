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
  const { rows, total } = await ordersRepo.list({
    status: req.query.status,
    search: req.query.search,
    skip,
    take: limit,
    populateBuyer: true,
  });
  return paginated(res, rows.map(serializeOrder), { page, limit, total });
});

/** GET /admin/orders/:id */
const getOrder = asyncHandler(async (req, res) => {
  const order = await ordersRepo.findDetail(req.params.id, { buyerFull: true });
  if (!order) return ok(res, { order: null });
  return ok(res, { order: serializeOrder(order) });
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
    throw ApiError.conflict('This order was created by an auction. Manage it from Auction Management.');
  }

  const next = req.body.status;
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(`Cannot change order from ${order.status} to ${next}`);
  }

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
  if ((next === ORDER_STATUS.REJECTED || next === ORDER_STATUS.CANCELLED)
      && inventoryReserved && !inventoryCommitted) {
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
    if (order.paymentStatus === 'UNPAID') data.paymentStatus = 'PAID';
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
    `Order ${STATUS_LABELS[next] || next}`,
    `Your order ${order.orderNumber} is now ${STATUS_LABELS[next] || next}.${req.body.reason ? ` ${req.body.reason}` : ''}`,
    order.id,
  );
  await recordAudit({
    action: AUDIT_ACTION.ORDER_STATUS,
    resourceType: 'Order',
    resourceId: order.id,
    before: { status: previousStatus },
    after: { status: next, inventoryReserved: updated.inventoryReserved, inventoryCommitted: updated.inventoryCommitted },
    req,
  });

  return ok(res, { order: serializeOrder(updated) }, `Order moved to ${next}`);
});

module.exports = { listOrders, getOrder, updateStatus };
