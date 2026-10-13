'use strict';

const ApiError = require('../utils/ApiError');

const SOURCES = ['body', 'query', 'params'];
// Identifiers are 24-char hex strings (same shape Mongo ObjectIds had).
const ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * validate(schema, 'body') -> Express middleware
 * `schema` is a Zod schema. Replaces req[source] with the parsed (and coerced)
 * value so downstream handlers always receive validated, typed data.
 */
function validate(schema, source = 'body') {
  if (!SOURCES.includes(source)) throw new Error(`Invalid validation source: ${source}`);

  return function validateMiddleware(req, _res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    req[source] = result.data;
    return next();
  };
}

/** Validates a route param that must be a 24-char hex id. */
function validateObjectId(paramName = 'id') {
  return function validateId(req, _res, next) {
    const value = req.params[paramName];
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      return next(ApiError.badRequest(`Invalid ${paramName}`));
    }
    return next();
  };
}

module.exports = { validate, validateObjectId };
