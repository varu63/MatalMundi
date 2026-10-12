'use strict';

class ApiError extends Error {
  constructor(statusCode, message, details = undefined, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', details) {
    return new ApiError(400, message, details, 'BAD_REQUEST');
  }
  static unauthorized(message = 'Unauthorized', details) {
    return new ApiError(401, message, details, 'UNAUTHORIZED');
  }
  static forbidden(message = 'Forbidden', details) {
    return new ApiError(403, message, details, 'FORBIDDEN');
  }
  static notFound(message = 'Not Found', details) {
    return new ApiError(404, message, details, 'NOT_FOUND');
  }
  static conflict(message = 'Conflict', details) {
    return new ApiError(409, message, details, 'CONFLICT');
  }
  static unprocessable(message = 'Unprocessable Entity', details) {
    return new ApiError(422, message, details, 'UNPROCESSABLE');
  }
  static tooMany(message = 'Too Many Requests', details) {
    return new ApiError(429, message, details, 'RATE_LIMITED');
  }
  static internal(message = 'Internal Server Error', details) {
    return new ApiError(500, message, details, 'INTERNAL');
  }
}

module.exports = ApiError;
