'use strict';

const { z, objectId, phone } = require('./commonValidators');
const {
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
  DEMAND_BASIS,
} = require('../utils/constants');

const pickupSchema = z.object({
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(4).max(20),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: phone,
});

/**
 * Multipart submissions send every field as a string, so numbers are coerced.
 * The 100 kg minimum is enforced here AND in the Mongoose schema AND in the
 * controller so it holds on every path.
 */
const createSubmissionSchema = z.object({
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
