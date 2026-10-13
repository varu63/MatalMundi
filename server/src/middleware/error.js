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
    }
  }
  // Malformed ids / wrong value types reaching the database layer.
  if (err.name === 'PrismaClientValidationError') {
    error = ApiError.badRequest('Invalid request data');
  }
  // Multer file errors
  if (error.name === 'MulterError') {
    error = ApiError.badRequest(`Upload error: ${error.message}`);
  }

  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    logger.error(err.stack || err.message || String(err));
  }

  const body = {
    success: false,
    message: statusCode >= 500 && env.isProd ? 'Internal Server Error' : error.message,
    code: error.code || undefined,
  };
  if (error.details) body.details = error.details;

  // Never leak stack traces outside development.
  if (!env.isProd && statusCode >= 500) body.stack = err.stack;

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
