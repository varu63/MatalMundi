'use strict';

const lotsRepo = require('../../repositories/lots');
const movementsRepo = require('../../repositories/movements');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { serializeLot, serializeMovement } = require('../../utils/serializers');
const { parsePage } = require('../../utils/numbers');

/** GET /admin/inventory — stock per lot with source traceability. */
const listInventory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await lotsRepo.list({
    lotStatus: req.query.status,
    materialType: req.query.materialType,
    skip,
    take: limit,
  });
  return paginated(res, rows.map(serializeLot), { page, limit, total });
});

/** GET /admin/inventory/:id — lot detail + movements. */
const getInventory = asyncHandler(async (req, res) => {
  const lot = await lotsRepo.findById(req.params.id, { populate: true });
  if (!lot) return ok(res, { lot: null });

  const movements = await movementsRepo.findByLot(lot.id, { take: 100 });
  return ok(res, { lot: serializeLot(lot), movements: movements.map(serializeMovement) });
});

module.exports = { listInventory, getInventory };
