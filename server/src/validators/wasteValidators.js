'use strict';

const { z, objectId, phone } = require('./commonValidators');
const {
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
  DEMAND_BASIS,
  SALE_MODE,
} = require('../utils/constants');

const pickupSchema = z.object({
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(4).max(20),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: phone,
});

/** Multipart optional number: empty string means "not provided". */
const optionalRupees = (max = 10_000_000) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(0, 'Price cannot be negative').max(max, 'Price looks too large').optional(),
  );

/**
 * Multipart submissions send every field as a string, so numbers are coerced.
 * The 100 kg minimum is enforced here AND in the Prisma schema AND in the
 * controller so it holds on every path.
 *
 * Auction mode (saleMode=AUCTION) additionally requires its price signals and
 * allows a duration choice — see the superRefine below and the controller for
 * the admin-configured quantity/duration eligibility checks.
 */
const createSubmissionSchema = z
  .object({
    materialCategory: objectId,
    materialType: z.string().trim().min(2).max(120),
    quantityKg: z.coerce
      .number()
      .min(100, 'Minimum submission quantity is 100 kg')
      .max(1_000_000, 'Quantity looks too large'),
    condition: z.enum(MATERIAL_CONDITIONS),
    qualityGrade: z.enum(QUALITY_GRADES),
    description: z.string().trim().min(10, 'Please describe the material (min 10 chars)').max(1000),
    pickup: pickupSchema,
    demandBasis: z.enum(Object.values(DEMAND_BASIS)),
    demandedPrice: z.coerce.number().min(0, 'Demanded price cannot be negative'),
    comments: z.string().trim().max(1000).optional().default(''),

    // ── Sale mode + auction fields (auction fields only used when AUCTION) ──
    saleMode: z.enum(Object.values(SALE_MODE)).optional().default(SALE_MODE.NORMAL),
    startingPricePerKg: optionalRupees(),
    expectedPricePerKg: optionalRupees(),
    minAcceptablePerKg: optionalRupees(),
    reservePricePerKg: optionalRupees(),
    durationMinutes: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().min(1).max(10_080).optional(),
    ),
    inspectionNotes: z.string().trim().max(1000).optional().default(''),
  })
  .superRefine((val, ctx) => {
    if (val.saleMode !== SALE_MODE.AUCTION) return;
    if (val.startingPricePerKg === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startingPricePerKg'],
        message: 'Starting price per kg is required for auctions',
      });
    }
    if (
      val.reservePricePerKg != null
      && val.startingPricePerKg != null
      && val.reservePricePerKg > 0
      && val.reservePricePerKg < val.startingPricePerKg
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reservePricePerKg'],
        message: 'Reserve price cannot be below the starting price',
      });
    }
  });

/** Query validation for a seller's own submissions list. */
const mySubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  status: z.string().trim().optional(),
});

/** Preview valuation for the submission form (nothing is persisted). */
const estimateSchema = z.object({
  materialCategory: objectId,
  materialType: z.string().trim().min(2).max(120),
  quantityKg: z.coerce.number().min(1).max(1_000_000),
  qualityGrade: z.enum(QUALITY_GRADES),
  pickup: z
    .object({
      city: z.string().trim().max(100).optional().default(''),
      state: z.string().trim().max(100).optional().default(''),
      postalCode: z.string().trim().max(20).optional().default(''),
    })
    .optional()
    .default({}),
});

module.exports = {
  createSubmissionSchema,
  mySubmissionsQuerySchema,
  estimateSchema,
  pickupSchema,
};
