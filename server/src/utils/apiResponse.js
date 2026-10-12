'use strict';

/**
 * Consistent response envelope used across the API.
 * { success, message, data, meta? }
 */
function ok(res, data = null, message = 'OK', statusCode = 200, meta = undefined) {
  const body = { success: true, message, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
}

function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

function paginated(res, items, { page, limit, total }, message = 'OK') {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return ok(res, items, message, 200, {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  });
}

module.exports = { ok, created, paginated };
