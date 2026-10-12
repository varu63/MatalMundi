'use strict';

const { InventoryLot, InventoryMovement } = require('../../models');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePage } = require('../../utils/numbers');

/** GET /admin/inventory — stock per lot with source traceability. */
const listInventory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = {};
  if (req.query.status) filter.lotStatus = req.query.status;
  if (req.query.materialType) filter.materialType = req.query.materialType;

  const [items, total] = await Promise.all([
    InventoryLot.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('materialCategory', 'name')
      .populate('sourceSubmission', 'submissionNumber seller status')
      .populate('seller', 'name email')
      .lean(),
    InventoryLot.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
});

/** GET /admin/inventory/:id — lot detail + movements. */
const getInventory = asyncHandler(async (req, res) => {
  const lot = await InventoryLot.findById(req.params.id)
    .populate('materialCategory', 'name')
    .populate('sourceSubmission', 'submissionNumber status')
    .populate('seller', 'name email');
  if (!lot) return ok(res, { lot: null });

  const movements = await InventoryMovement.find({ lot: lot._id }).sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, { lot, movements });
});

module.exports = { listInventory, getInventory };