'use strict';

const { z, objectId } = require('./commonValidators');
const {
  AUCTION_STATUS,
  BID_INCREMENT_TYPE,
} = require('../utils/constants');

const optionalNumber = (schema) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    schema.optional(),
  );

const paginationFields = {
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
};

/** Public auctions list / search filters. */
const auctionListQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(Object.values(AUCTION_STATUS)).optional(),
  category: objectId.optional(),
  materialType: z.string().trim().max(120).optional(),
  search: z.string().trim().max(120).optional(),
  city: z.string().trim().max(100).optional(),
  bidMin: optionalNumber(z.coerce.number().int().min(0)),
  bidMax: optionalNumber(z.coerce.number().int().min(0)),
  quantityMin: optionalNumber(z.coerce.number().min(0)),
  quantityMax: optionalNumber(z.coerce.number().min(0)),
});

/** Admin queue filters — same as public plus any-status/seller. */
const adminAuctionListQuerySchema = auctionListQuerySchema.extend({
  seller: objectId.optional(),
});

/** POST /auctions/:id/bids */
const placeBidSchema = z.object({
  bidPerKgPaise: z.coerce
    .number()
    .int('Bid must be a whole number of paise')
    .min(1, 'Bid must be positive')
    .max(100_000_000, 'Bid amount looks unreasonable'),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
});

/** Admin: approve (optional schedule + price adjustment). */
const approveAuctionSchema = z.object({
  startAt: optionalNumber(z.coerce.date()),
  durationMinutes: optionalNumber(z.coerce.number().int().min(1).max(10_080)),
  startingPricePerKgPaise: optionalNumber(z.coerce.number().int().min(1).max(100_000_000)),
  note: z.string().trim().max(500).optional().default(''),
});

const rejectAuctionSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required').max(500),
});

/** Admin: pre-bid rule adjustments (never while bids exist). */
const updateAuctionSchema = z
  .object({
    startingPricePerKgPaise: optionalNumber(z.coerce.number().int().min(1).max(100_000_000)),
    minIncrementType: z.enum(Object.values(BID_INCREMENT_TYPE)).optional(),
    minIncrementValue: optionalNumber(z.coerce.number().positive().max(1_000_000)),
    antiSnipingEnabled: z.boolean().optional(),
    antiSnipingWindowSeconds: optionalNumber(z.coerce.number().int().min(5).max(3600)),
    antiSnipingExtensionSeconds: optionalNumber(z.coerce.number().int().min(5).max(3600)),
    durationMinutes: optionalNumber(z.coerce.number().int().min(1).max(10_080)),
    inspectionNotes: z.string().trim().max(2000).optional(),
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });

const cancelAuctionSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation reason is required').max(500),
});

const paymentReceivedSchema = z.object({
  provider: z.string().trim().max(60).optional().default('MANUAL'),
  reference: z.string().trim().max(120).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

const completeAuctionSchema = z.object({
  verifiedQuantityKg: optionalNumber(z.coerce.number().min(1).max(1_000_000)),
  note: z.string().trim().max(500).optional().default(''),
});

/** Admin auction settings. */
const updateAuctionSettingsSchema = z
  .object({
    minAuctionQuantityKg: optionalNumber(z.coerce.number().min(100).max(1_000_000)),
    sellerCanChooseDuration: z.boolean().optional(),
    defaultDurationMinutes: optionalNumber(z.coerce.number().int().min(1).max(10_080)),
    minDurationMinutes: optionalNumber(z.coerce.number().int().min(1).max(10_080)),
    maxDurationMinutes: optionalNumber(z.coerce.number().int().min(1).max(10_080)),
    allowedDurationsMinutes: z.array(z.coerce.number().int().min(1).max(10_080)).min(1).max(12).optional(),
    minIncrementType: z.enum(Object.values(BID_INCREMENT_TYPE)).optional(),
    minIncrementValue: optionalNumber(z.coerce.number().positive().max(1_000_000)),
    antiSnipingEnabled: z.boolean().optional(),
    antiSnipingWindowSeconds: optionalNumber(z.coerce.number().int().min(5).max(3600)),
    antiSnipingExtensionSeconds: optionalNumber(z.coerce.number().int().min(5).max(3600)),
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });

module.exports = {
  auctionListQuerySchema,
  adminAuctionListQuerySchema,
  placeBidSchema,
  approveAuctionSchema,
  rejectAuctionSchema,
  updateAuctionSchema,
  cancelAuctionSchema,
  paymentReceivedSchema,
  completeAuctionSchema,
  updateAuctionSettingsSchema,
};
