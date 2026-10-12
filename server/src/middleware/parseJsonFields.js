'use strict';

const ApiError = require('../utils/ApiError');

/**
 * multipart/form-data cannot carry nested objects. The SPA sends nested fields
 * as JSON strings; this middleware parses the listed fields back into objects
 * before Zod validation runs.
 */
function parseJsonFields(fields = []) {
  return function parseJsonMiddleware(req, _res, next) {
    for (const field of fields) {
      const value = req.body?.[field];
      if (typeof value === 'string' && value.length) {
        try {
          req.body[field] = JSON.parse(value);
        } catch (_e) {
          return next(ApiError.badRequest(`Field "${field}" must be valid JSON`));
        }
      }
    }
    return next();
  };
}

module.exports = parseJsonFields;
