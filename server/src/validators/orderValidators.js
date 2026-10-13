'use strict';

const { z, objectId, phone, pagination } = require('./commonValidators');

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
  }),
  notes: z.string().trim().max(1000).optional().default(''),
});

const myOrdersQuerySchema = pagination.extend({
  status: z.string().trim().optional(),
});

module.exports = { createOrderSchema, myOrdersQuerySchema };
