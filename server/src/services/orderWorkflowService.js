'use strict';

const { prisma } = require('../config/db');
const ordersRepo = require('../repositories/orders');
const ApiError = require('../utils/ApiError');
const { newId } = require('../utils/idGenerator');
const { round2 } = require('../utils/numbers');
const {
  reserveOrderItems,
  releaseOrderItems,
  commitOrderItems,
} = require('./inventoryService');
const {
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  INSPECTION_ORDER_STATUSES,
  INSPECTION_STATUS,
  DELIVERY_CHARGE_STATUS,
  AUDIT_ACTION,
} = require('../utils/constants');

const STATUS_LABELS = {
  [ORDER_STATUS.PENDING_ADMIN_APPROVAL]: 'Awaiting admin approval',
  [ORDER_STATUS.ACCEPTED]: 'Accepted',
  [ORDER_STATUS.INSPECTION_SCHEDULED]: 'Inspection scheduled',
  [ORDER_STATUS.INSPECTION_IN_PROGRESS]: 'Inspection in progress',
  [ORDER_STATUS.DELIVERY_CHARGE_PENDING]: 'Delivery charge pending',
  [ORDER_STATUS.AWAITING_BUYER_CONFIRMATION]: 'Awaiting buyer confirmation',
  [ORDER_STATUS.REJECTED]: 'Rejected',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.PROCESSING]: 'Processing',
  [ORDER_STATUS.READY_FOR_DISPATCH]: 'Ready for dispatch',
  [ORDER_STATUS.DISPATCHED]: 'Dispatched',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function historyFor(order, status, actor, note = '') {
  return [
    ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
    { status, at: new Date(), by: actor, note },
  ];
}

function assertTransition(order, next) {
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(`Cannot change order from ${order.status} to ${next}`);
  }
}

/**
 * Backend gates for statuses that must be earned by the workflow, not typed
 * into the status endpoint. Frontend button visibility is never the check.
 */
function assertStatusGate(order, next) {
  if (next === ORDER_STATUS.AWAITING_BUYER_CONFIRMATION) {
    throw ApiError.conflict('Set the delivery charge to move this order to buyer confirmation');
  }
  if (next === ORDER_STATUS.CONFIRMED) {
    if (order.inspectionStatus !== INSPECTION_STATUS.PASSED) {
      throw ApiError.conflict('The inspection must pass before this order can be confirmed');
    }
    if (order.deliveryChargeStatus !== DELIVERY_CHARGE_STATUS.CONFIRMED) {
      throw ApiError.conflict('Only the buyer can confirm the final delivery terms');
    }
  }
  if (
    [ORDER_STATUS.PROCESSING, ORDER_STATUS.READY_FOR_DISPATCH].includes(next) &&
    !order.addressReleased
  ) {
    throw ApiError.conflict('The buyer has not confirmed the delivery terms yet');
  }
  if (
    [ORDER_STATUS.DISPATCHED, ORDER_STATUS.DELIVERED].includes(next) &&
    order.inspectionStatus === INSPECTION_STATUS.FAILED
  ) {
    throw ApiError.conflict('A failed inspection cannot dispatch material');
  }
  if (INSPECTION_ORDER_STATUSES.includes(next) && order.inspectionStatus === INSPECTION_STATUS.PASSED) {
    throw ApiError.conflict('This order has already passed inspection');
  }
}

async function ensureReserved(order, actor) {
  if (order.inventoryReserved || order.inventoryCommitted) return;
  try {
    await reserveOrderItems(order.items, order.id, actor);
  } catch (err) {
    throw ApiError.conflict(`Could not reserve stock: ${err.message}`);
  }
}

async function releaseReservation(order, actor, reason) {
  if (!order.inventoryReserved || order.inventoryCommitted) return;
  await releaseOrderItems(order.items, order.id, actor, reason);
}

async function acceptOrder(order, actor, note = '') {
  if (order.auctionId) {
    throw ApiError.conflict(
      'This order was created by an auction. Manage it from Auction Management.'
    );
  }
  if (order.status !== ORDER_STATUS.PENDING_ADMIN_APPROVAL) {
    if (order.status === ORDER_STATUS.ACCEPTED) return order;
    throw ApiError.conflict(`Cannot accept an order in ${order.status}`);
  }

  await ensureReserved(order, actor);
  const accepted = await ordersRepo.transitionById(order.id, ORDER_STATUS.PENDING_ADMIN_APPROVAL, {
    status: ORDER_STATUS.ACCEPTED,
    inventoryReserved: true,
    statusHistory: historyFor(order, ORDER_STATUS.ACCEPTED, actor, note),
  });
  if (accepted) return accepted;
  // Another request moved it first: accepting twice is not an error, but only
  // the first write may add history.
  const current = await ordersRepo.findById(order.id);
  if (current && current.status === ORDER_STATUS.ACCEPTED) return current;
  throw ApiError.conflict(`Cannot accept an order in ${current ? current.status : order.status}`);
}

async function rejectOrder(order, actor, reason, nextStatus = ORDER_STATUS.REJECTED) {
  if (order.auctionId) {
    throw ApiError.conflict(
      'This order was created by an auction. Manage it from Auction Management.'
    );
  }
  assertTransition(order, nextStatus);
  await releaseReservation(order, actor, `Order ${nextStatus}: reservation released`);

  const data = {
    status: nextStatus,
    inventoryReserved: false,
    inventoryCommitted: order.inventoryCommitted,
    statusHistory: historyFor(order, nextStatus, actor, reason || ''),
  };
  if (reason) data.rejectionReason = reason;
  if (nextStatus === ORDER_STATUS.CANCELLED) {
    data.deliveryChargeStatus = DELIVERY_CHARGE_STATUS.REJECTED;
  }
  const updated = await ordersRepo.transitionById(order.id, order.status, data);
  if (!updated) {
    throw ApiError.conflict(
      'This order changed while your action was running. Reload it and try again.'
    );
  }
  return updated;
}

async function setInspection(order, actor, payload) {
  if (order.auctionId) {
    throw ApiError.conflict('Auction orders do not use marketplace inspections');
  }
  if ([ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED, ORDER_STATUS.DELIVERED].includes(order.status)) {
    throw ApiError.conflict('This order is closed and cannot be inspected');
  }

  const inspection = order.inspection || (await prisma.inspection.findUnique({ where: { orderId: order.id } }));
  const current = inspection?.status || INSPECTION_STATUS.PENDING;
  const next = payload.status || current;

  const allowed = {
    [INSPECTION_STATUS.PENDING]: [
      INSPECTION_STATUS.SCHEDULED,
      INSPECTION_STATUS.IN_PROGRESS,
      INSPECTION_STATUS.PASSED,
      INSPECTION_STATUS.FAILED,
    ],
    [INSPECTION_STATUS.SCHEDULED]: [
      INSPECTION_STATUS.IN_PROGRESS,
      INSPECTION_STATUS.PASSED,
      INSPECTION_STATUS.FAILED,
    ],
    [INSPECTION_STATUS.IN_PROGRESS]: [INSPECTION_STATUS.PASSED, INSPECTION_STATUS.FAILED],
    [INSPECTION_STATUS.PASSED]: [],
    [INSPECTION_STATUS.FAILED]: [],
  };
  if (next !== current && !(allowed[current] || []).includes(next)) {
    throw ApiError.conflict(`Cannot change inspection from ${current} to ${next}`);
  }
  if (next === INSPECTION_STATUS.SCHEDULED && !payload.scheduledAt && !inspection?.scheduledAt) {
    throw ApiError.badRequest('A scheduled inspection requires a date and time');
  }
  if (next === INSPECTION_STATUS.PASSED && !payload.actualQuantityKg && !inspection?.actualQuantityKg) {
    throw ApiError.badRequest('A passed inspection must record the actual quantity weighed out');
  }
  if (payload.actualQuantityKg !== undefined && !(Number(payload.actualQuantityKg) > 0)) {
    throw ApiError.badRequest('Actual quantity must be greater than zero');
  }

  const now = new Date();
  const inspectionData = {
    inspectorId: actor,
    status: next,
    notes: payload.notes !== undefined ? payload.notes : inspection?.notes || '',
    failureReason:
      payload.failureReason !== undefined
        ? payload.failureReason
        : inspection?.failureReason || '',
    photos: payload.photos !== undefined ? payload.photos : inspection?.photos || [],
    actualQuantityKg:
      payload.actualQuantityKg !== undefined
        ? round2(payload.actualQuantityKg)
        : inspection?.actualQuantityKg ?? 0,
    materialCondition:
      payload.materialCondition !== undefined
        ? payload.materialCondition
        : inspection?.materialCondition || order.inspection?.materialCondition,
    quantityChangedFromKg:
      payload.actualQuantityKg !== undefined
        ? round2(bookedQuantityKg(order))
        : inspection?.quantityChangedFromKg ?? 0,
  };
  if (payload.scheduledAt !== undefined) inspectionData.scheduledAt = payload.scheduledAt;
  if (next === INSPECTION_STATUS.IN_PROGRESS) inspectionData.startedAt = now;
  if (next === INSPECTION_STATUS.PASSED) {
    inspectionData.startedAt = inspection?.startedAt || now;
    inspectionData.completedAt = now;
  }
  if (next === INSPECTION_STATUS.FAILED) {
    inspectionData.failedAt = now;
    inspectionData.failureReason = payload.failureReason || payload.notes || 'Inspection failed';
  }

  const statusData = { inspectionStatus: next };

  if (next === INSPECTION_STATUS.SCHEDULED || next === INSPECTION_STATUS.IN_PROGRESS) {
    // Mirror the inspection stage onto the order so admin queues can filter it.
    const mirrored =
      next === INSPECTION_STATUS.SCHEDULED
        ? ORDER_STATUS.INSPECTION_SCHEDULED
        : ORDER_STATUS.INSPECTION_IN_PROGRESS;
    if (order.status !== mirrored) {
      const allowedFrom = [ORDER_STATUS.PENDING_ADMIN_APPROVAL, ORDER_STATUS.ACCEPTED];
      if (allowedFrom.includes(order.status)) {
        await ensureReserved(order, actor);
        statusData.status = mirrored;
        statusData.inventoryReserved = true;
        statusData.statusHistory = historyFor(order, mirrored, actor, `Inspection ${next.toLowerCase()}`);
      }
    }
  }

  if (next === INSPECTION_STATUS.PASSED) {
    await ensureReserved(order, actor);
    statusData.inventoryReserved = true;
    const revised = applyInspectedQuantity(order, inspectionData.actualQuantityKg);
    if (revised) {
      Object.assign(statusData, revised);
    }
    if (
      order.status === ORDER_STATUS.PENDING_ADMIN_APPROVAL ||
      order.status === ORDER_STATUS.INSPECTION_SCHEDULED ||
      order.status === ORDER_STATUS.INSPECTION_IN_PROGRESS
    ) {
      statusData.status = ORDER_STATUS.ACCEPTED;
      statusData.statusHistory = historyFor(
        statusData.items ? { ...order, ...statusData } : order,
        ORDER_STATUS.ACCEPTED,
        actor,
        'Inspection passed'
      );
    }
  }

  if (next === INSPECTION_STATUS.FAILED) {
    await releaseReservation(order, actor, 'Inspection failed: reservation released');
    statusData.status = ORDER_STATUS.REJECTED;
    statusData.inventoryReserved = false;
    statusData.rejectionReason = inspectionData.failureReason;
    statusData.deliveryChargeStatus = DELIVERY_CHARGE_STATUS.REJECTED;
    statusData.statusHistory = historyFor(
      order,
      ORDER_STATUS.REJECTED,
      actor,
      inspectionData.failureReason
    );
  }

  // The inspection row and the order's mirrored `inspectionStatus` are two views
  // of the same fact. Written one after the other, two admins recording
  // different inspection steps simultaneously could interleave and leave the
  // pair disagreeing (order PASSED, inspection IN_PROGRESS). Committing them
  // together means the last transaction wins on both rows at once.
  const [saved, updatedOrder] = await prisma.$transaction([
    inspection
      ? prisma.inspection.update({ where: { id: inspection.id }, data: inspectionData })
      : prisma.inspection.create({ data: { id: newId(), orderId: order.id, ...inspectionData } }),
    prisma.order.update({ where: { id: order.id }, data: statusData }),
  ]);

  return { order: updatedOrder, inspection: saved };
}

/** Total weight booked on the order's items. */
function bookedQuantityKg(order) {
  return (Array.isArray(order.items) ? order.items : []).reduce(
    (sum, item) => sum + Number(item.weightKg || 0),
    0
  );
}

/**
 * Rewrites the order's line items and totals to the quantity actually weighed
 * out at inspection. Returns null when the quantity is unchanged.
 *
 * A revised quantity makes the stored total stale, so the quote goes back to
 * provisional and `termsRevision` increments — the buyer must confirm again
 * before the delivery charge can be sent.
 */
function applyInspectedQuantity(order, actualQuantityKg) {
  const booked = bookedQuantityKg(order);
  const actual = round2(actualQuantityKg);
  if (!actual || !booked || actual === booked) return null;

  const scale = actual / booked;
  const items = order.items.map((item) => {
    const weightKg = round2(Number(item.weightKg || 0) * scale);
    return {
      ...item,
      weightKg,
      subtotalPaise: Math.round(weightKg * Number(item.unitPricePaise || 0)),
      reservedWeightKg: weightKg,
    };
  });

  const materialSubtotalPaise = items.reduce((sum, i) => sum + i.subtotalPaise, 0);
  const taxPaise = Math.round((materialSubtotalPaise * Number(order.taxPercent || 0)) / 100);
  const transportationPaise = Number(order.transportationPaise || 0);
  const otherFeesPaise = Number(order.otherFeesPaise || 0);

  return {
    items,
    materialSubtotalPaise,
    taxPaise,
    totalPaise: materialSubtotalPaise + taxPaise + transportationPaise + otherFeesPaise,
    quoteIsProvisional: true,
    termsRevision: Number(order.termsRevision || 0) + 1,
  };
}

async function setDeliveryCharge(order, actor, { chargePaise, notes = '' }) {
  if (order.inspectionStatus !== INSPECTION_STATUS.PASSED) {
    throw ApiError.conflict('Inspection must pass before a delivery charge can be set');
  }
  if (
    ![
      ORDER_STATUS.ACCEPTED,
      ORDER_STATUS.DELIVERY_CHARGE_PENDING,
      ORDER_STATUS.AWAITING_BUYER_CONFIRMATION,
    ].includes(order.status)
  ) {
    throw ApiError.conflict(`Cannot set a delivery charge while the order is ${order.status}`);
  }
  if (order.addressReleased) {
    throw ApiError.conflict('The delivery address has already been released');
  }

  const charge = Number(chargePaise);
  if (!Number.isInteger(charge) || charge < 0) {
    throw ApiError.badRequest('Delivery charge must be a non-negative amount in paise');
  }

  const baseTotal =
    Number(order.materialSubtotalPaise || 0) +
    Number(order.taxPaise || 0) +
    Number(order.otherFeesPaise || 0);
  const nextStatus =
    order.status === ORDER_STATUS.AWAITING_BUYER_CONFIRMATION
      ? order.status
      : ORDER_STATUS.AWAITING_BUYER_CONFIRMATION;

  return ordersRepo.updateById(order.id, {
    deliveryChargePaise: charge,
    deliveryChargeStatus: DELIVERY_CHARGE_STATUS.AWAITING_BUYER_CONFIRMATION,
    deliveryChargeSetById: actor,
    deliveryChargeSetAt: new Date(),
    deliveryChargeNotes: notes || '',
    transportationPaise: charge,
    totalPaise: baseTotal + charge,
    quoteIsProvisional: false,
    status: nextStatus,
    statusHistory:
      nextStatus !== order.status
        ? historyFor(
            order,
            nextStatus,
            actor,
            'Delivery charge set; awaiting buyer confirmation'
          )
        : order.statusHistory,
  });
}

async function confirmBuyerOrder(order, actor, note = '') {
  if (order.status !== ORDER_STATUS.AWAITING_BUYER_CONFIRMATION) {
    throw ApiError.conflict('This order is not awaiting buyer confirmation');
  }
  if (order.deliveryChargeStatus !== DELIVERY_CHARGE_STATUS.AWAITING_BUYER_CONFIRMATION) {
    throw ApiError.conflict('There is no delivery charge awaiting confirmation');
  }

  const now = new Date();
  const confirmed = await ordersRepo.transitionById(order.id, order.status, {
    status: ORDER_STATUS.CONFIRMED,
    deliveryChargeStatus: DELIVERY_CHARGE_STATUS.CONFIRMED,
    buyerConfirmedAt: now,
    buyerConfirmationNote: note || '',
    addressReleased: true,
    addressReleasedAt: now,
    addressReleasedById: actor,
    addressReleaseReason: 'Buyer confirmed the delivery charge',
    statusHistory: historyFor(
      order,
      ORDER_STATUS.CONFIRMED,
      actor,
      'Buyer confirmed the delivery charge and released contact details'
    ),
  });
  if (!confirmed) {
    throw ApiError.conflict(
      'This order changed while your action was running. Reload it and try again.'
    );
  }
  return confirmed;
}

async function declineBuyerOrder(order, actor, reason = '') {
  if (order.status !== ORDER_STATUS.AWAITING_BUYER_CONFIRMATION) {
    throw ApiError.conflict('This order is not awaiting buyer confirmation');
  }
  await releaseReservation(order, actor, 'Buyer declined the delivery charge');
  const declined = await ordersRepo.transitionById(order.id, order.status, {
    status: ORDER_STATUS.CANCELLED,
    deliveryChargeStatus: DELIVERY_CHARGE_STATUS.REJECTED,
    inventoryReserved: false,
    rejectionReason: reason || 'Buyer declined the delivery charge',
    statusHistory: historyFor(
      order,
      ORDER_STATUS.CANCELLED,
      actor,
      reason || 'Buyer declined the delivery charge'
    ),
  });
  if (!declined) {
    throw ApiError.conflict(
      'This order changed while your action was running. Reload it and try again.'
    );
  }
  return declined;
}

async function releaseAddress(order, actor, reason = '') {
  if (order.addressReleased) return order;
  if (order.deliveryChargeStatus !== DELIVERY_CHARGE_STATUS.CONFIRMED) {
    throw ApiError.conflict('The buyer must confirm the delivery charge before release');
  }
  const now = new Date();
  return ordersRepo.updateById(order.id, {
    addressReleased: true,
    addressReleasedAt: now,
    addressReleasedById: actor,
    addressReleaseReason: reason || 'Address released after buyer confirmation',
  });
}

const SELLER_STATUSES = [
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.READY_FOR_DISPATCH,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.DELIVERED,
];

async function updateSellerStatus(order, actor, next, note = '') {
  if (!SELLER_STATUSES.includes(next)) {
    throw ApiError.forbidden('Sellers cannot move an order to this status');
  }
  if (String(order.sellerId || '') !== String(actor)) {
    throw ApiError.forbidden('You cannot update this order');
  }
  if (!order.addressReleased) {
    throw ApiError.conflict('Buyer contact details have not been released yet');
  }
  assertTransition(order, next);

  let inventoryCommitted = order.inventoryCommitted;
  let inventoryReserved = order.inventoryReserved;
  if (next === ORDER_STATUS.DELIVERED && inventoryReserved && !inventoryCommitted) {
    await commitOrderItems(order.items, order.id, actor);
    inventoryCommitted = true;
    inventoryReserved = false;
  }

  const updated = await ordersRepo.transitionById(order.id, order.status, {
    status: next,
    inventoryReserved,
    inventoryCommitted,
    statusHistory: historyFor(order, next, actor, note || ''),
  });
  if (!updated) {
    throw ApiError.conflict(
      'This order changed while your action was running. Reload it and try again.'
    );
  }
  return updated;
}

module.exports = {
  STATUS_LABELS,
  statusLabel,
  assertTransition,
  assertStatusGate,
  acceptOrder,
  rejectOrder,
  setInspection,
  setDeliveryCharge,
  confirmBuyerOrder,
  declineBuyerOrder,
  releaseAddress,
  updateSellerStatus,
  SELLER_STATUSES,
  AUDIT_ACTION,
};
