'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let error = err;

  // Mongoose bad ObjectId
  if (error.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${error.path}: ${error.value}`);
  }
  // Mongoose duplicate key
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || { field: '' })[0];
    error = ApiError.conflict(`Duplicate value for ${field || 'field'}`);
  }
  // Mongoose validation
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors).map((e) => ({
      path: e.path,
      message: e.message,
    }));
    error = ApiError.unprocessable('Validation failed', details);
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
