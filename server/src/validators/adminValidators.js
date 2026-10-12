'use strict';

const { z, objectId, pagination } = require('./commonValidators');
const {
  QUALITY_GRADES,
  MATERIAL_CONDITIONS,
  SUBMISSION_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  LISTING_STATUS,
  DEFAULT_QUALITY_MULTIPLIERS,
} = require('../utils/constants');

// ── Waste submission review ────────────────────────────────────────────────
const reviewSchema = z.object({
  status: z.enum(['PENDING_APPROVAL', 'UNDER_REVIEW', 'PICKUP_SCHEDULED']).optional(),
  pickupDate: z.coerce.date().optional(),
  note: z.string().trim().max(2000).optional().default(''),
});

const approveSchema = z.object({
  // Optional per-kg offer in INR. Defaults to the auto-valuation payout.
  proposedPricePerKg: z.coerce.number().min(0).optional(),
  note: z.string().trim().max(2000).optional().default(''),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'A rejection reason is required').max(1000),
});

const collectSchema = z.object({
  acceptedQuantityKg: z.coerce.number().min(100, 'Accepted quantity must be at least 100 kg'),
  note: z.string().trim().max(2000).optional().default(''),
});

const publishSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(2000),
  pricePerKg: z.coerce.number().positive('Selling price per kg is required'),
  minPurchaseKg: z.coerce.number().min(0).optional().default(0),
  deliveryTerms: z.string().trim().max(500).optional().default('Pickup from MetalMundi facility'),
  qualityGrade: z.enum(QUALITY_GRADES).optional(),
  condition: z.enum(MATERIAL_CONDITIONS).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
});

const adminSubmissionsQuerySchema = pagination.extend({
  status: z.enum(SUBMISSION_STATUS_VALUES).optional(),
  search: z.string().trim().max(120).optional(),
});

// ── Listings ────────────────────────────────────────────────────────────────
const updateListingSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  pricePerKg: z.coerce.number().positive().optional(),
  minPurchaseKg: z.coerce.number().min(0).optional(),
  deliveryTerms: z.string().trim().max(500).optional(),
  qualityGrade: z.enum(QUALITY_GRADES).optional(),
  condition: z.enum(MATERIAL_CONDITIONS).optional(),
  availableQuantityKg: z.coerce.number().min(0).optional(),
});

const listingStatusSchema = z.object({
  status: z.enum(Object.values(LISTING_STATUS)),
  reason: z.string().trim().max(500).optional().default(''),
});

const adminListingsQuerySchema = pagination.extend({
  status: z.enum(Object.values(LISTING_STATUS)).optional(),
  search: z.string().trim().max(120).optional(),
});

// ── Orders ──────────────────────────────────────────────────────────────────
const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  reason: z.string().trim().max(1000).optional().default(''),
});

const adminOrdersQuerySchema = pagination.extend({
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  search: z.string().trim().max(120).optional(),
});

// ── Pricing ─────────────────────────────────────────────────────────────────
const qualityMultipliers = z
  .object({
    A: z.coerce.number().min(0).max(10).optional().default(DEFAULT_QUALITY_MULTIPLIERS.A),
    B: z.coerce.number().min(0).max(10).optional().default(DEFAULT_QUALITY_MULTIPLIERS.B),
    C: z.coerce.number().min(0).max(10).optional().default(DEFAULT_QUALITY_MULTIPLIERS.C),
    D: z.coerce.number().min(0).max(10).optional().default(DEFAULT_QUALITY_MULTIPLIERS.D),
  })
  .optional();

const createPricingSchema = z.object({
  materialCategory: objectId,
  materialType: z.string().trim().max(120).optional().default(''),
  ratePerKg: z.coerce.number().min(0),
  qualityMultipliers,
  basePickupCharge: z.coerce.number().min(0).optional().default(500),
  perKmCharge: z.coerce.number().min(0).optional().default(12),
  platformFeePercent: z.coerce.number().min(0).max(100).optional().default(5),
  taxPercent: z.coerce.number().min(0).max(100).optional().default(18),
  notes: z.string().trim().max(500).optional().default(''),
});

const updatePricingSchema = createPricingSchema.partial().omit({ materialCategory: true });

// ── Categories ────────────────────────────────────────────────────────────────
const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(''),
  icon: z.string().trim().max(60).optional().default('recycle'),
  sortOrder: z.coerce.number().optional().default(0),
  active: z.coerce.boolean().optional().default(true),
});

const updateCategorySchema = categorySchema.partial();

module.exports = {
  reviewSchema,
  approveSchema,
  rejectSchema,
  collectSchema,
  publishSchema,
  adminSubmissionsQuerySchema,
  updateListingSchema,
  listingStatusSchema,
  adminListingsQuerySchema,
  orderStatusSchema,
  adminOrdersQuerySchema,
  createPricingSchema,
  updatePricingSchema,
  categorySchema,
  updateCategorySchema,
};
