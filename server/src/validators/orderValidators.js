'use strict';

const { z, objectId, phone, pagination } = require('./commonValidators');
const { ORDER_STATUS } = require('../utils/constants');

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        listingId: objectId,
        weightKg: z.coerce.number().positive('Weight must be greater than 0'),
      })
    )
    .min(1, 'Add at least one material to your order'),
  delivery: z.object({
    name: z.string().trim().min(2).max(120),
    phone,
    address: z.string().trim().min(5).max(300),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(4).max(20),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  }),
  notes: z.string().trim().max(1000).optional().default(''),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

const myOrdersQuerySchema = pagination.extend({
  status: z.string().trim().optional(),
});

const sellerStatusSchema = z.object({
  status: z.enum([
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.READY_FOR_DISPATCH,
    ORDER_STATUS.DISPATCHED,
    ORDER_STATUS.DELIVERED,
  ]),
  note: z.string().trim().max(1000).optional().default(''),
});

const confirmOrderSchema = z.object({
  note: z.string().trim().max(1000).optional().default(''),
});

const declineOrderSchema = z.object({
  reason: z.string().trim().min(3).max(1000).optional().default(''),
});

module.exports = {
  createOrderSchema,
  myOrdersQuerySchema,
  sellerStatusSchema,
  confirmOrderSchema,
  declineOrderSchema,
};
