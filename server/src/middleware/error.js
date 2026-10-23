'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, _next) {
  let error = err;

  // Prisma known request errors → client-safe HTTP errors.
  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      const target = err.meta && err.meta.target;
      const field = Array.isArray(target) ? target[0] : target;
      error = ApiError.conflict(`Duplicate value for ${field || 'field'}`);
    } else if (err.code === 'P2025') {
      error = ApiError.notFound('Record not found');
    } else if (err.code === 'P2003') {
      error = ApiError.badRequest('Related record does not exist');
    } else if (err.code === 'P2021' || err.code === 'P2022') {
      // Missing table / migration not applied — never start failing with 500s
      // that leak schema internals; report a safe service-unavailable.
      error = new ApiError(503, 'Database schema is not ready (migrations pending)', undefined, 'DB_SCHEMA');
    }
  }
  // Connection-level failures (DB unreachable, pooled-out, DNS…) → 503.
  if (
    err.name === 'PrismaClientInitializationError' ||
    ['P1001', 'P1008', 'P1017'].includes(err.code)
  ) {
    error = new ApiError(503, 'Database unavailable', undefined, 'DB_UNAVAILABLE');
  }
  // Malformed ids / wrong value types reaching the database layer.
  if (err.name === 'PrismaClientValidationError') {
    error = ApiError.badRequest('Invalid request data');
  }
  // Multer file errors
  if (error.name === 'MulterError') {
    error = ApiError.badRequest(`Upload error: ${error.message}`);
  }
  // Body parser errors report their code as `status` (not `statusCode`) and
  // their message is raw parser text — replace both with client-safe output.
  if (error.type === 'entity.parse.failed') {
    error = new ApiError(400, 'Malformed JSON body', undefined, 'INVALID_JSON');
  } else if (error.type === 'entity.too.large') {
    error = new ApiError(413, 'Request body too large', undefined, 'PAYLOAD_TOO_LARGE');
  } else if (!error.statusCode && typeof error.status === 'number') {
    error = new ApiError(
      error.status,
      error.expose ? error.message : 'Request rejected',
      undefined,
      'REQUEST_REJECTED'
    );
  }

  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    logger.error(err.stack || err.message || String(err));
  }

  const body = {
    success: false,
    message: statusCode >= 500 && env.isProd ? 'Internal Server Error' : error.message,
    code: error.code || (statusCode >= 500 ? 'INTERNAL' : undefined),
  };
  if (error.details) body.details = error.details;

  // Never leak stack traces outside development.
  if (!env.isProd && statusCode >= 500) body.stack = err.stack;

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
