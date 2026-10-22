'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load server/.env regardless of the current working directory.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name, fallback) {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: parseInt(process.env.PORT || '5000', 10),
  // Matches the defaults in docker-compose.yml / .env.example (dev only).
  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://admin:adminpassword@localhost:5432/metalmundi'
  ),

  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieSecret: required('COOKIE_SECRET', 'dev-only-insecure-cookie-secret-change-me'),

  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  apiPublicUrl: process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`,

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'metalmundi',
  },

  admin: {
    name: process.env.ADMIN_NAME || 'MetalMundi Admin',
    email: process.env.ADMIN_EMAIL || 'admin@metalmundi.test',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
  },

  // Optional AI-image detection microservice (ai-detect-service/). When unset,
  // listing image checks are skipped silently.
  mlServiceUrl: (process.env.ML_SERVICE_URL || '').replace(/\/+$/, ''),
  aiFlagThreshold: parseFloat(process.env.AI_FLAG_THRESHOLD || '0.8'),

  // Rate limits. The per-IP caps are deliberately generous: in India a large
  // share of mobile traffic shares a public IP (CGNAT), and campuses/offices
  // share one too, so a tight per-IP cap locks out unrelated users. Credential
  // abuse is instead contained per account (see rateLimit.js).
  rateLimits: {
    apiMax: parseInt(process.env.RATE_LIMIT_API_MAX || '1000', 10),
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '120', 10),
    authAccountMax: parseInt(process.env.RATE_LIMIT_AUTH_ACCOUNT_MAX || '10', 10),
    writeMax: parseInt(process.env.RATE_LIMIT_WRITE_MAX || '120', 10),
    bidMax: parseInt(process.env.RATE_LIMIT_BID_MAX || '60', 10),
  },

  business: {
    platformFeePercent: parseFloat(process.env.DEFAULT_PLATFORM_FEE_PERCENT || '5'),
    basePickupCharge: parseFloat(process.env.DEFAULT_BASE_PICKUP_CHARGE || '500'),
    perKmCharge: parseFloat(process.env.DEFAULT_PER_KM_CHARGE || '12'),
    taxPercent: parseFloat(process.env.DEFAULT_TAX_PERCENT || '18'),
    minSubmissionKg: parseFloat(process.env.MIN_SUBMISSION_KG || '100'),
    // Fallback pickup distance used when no real geocoding/distance service is
    // configured. Always surfaced to the user as a *provisional* estimate.
    defaultDistanceKm: parseFloat(process.env.DEFAULT_DISTANCE_KM || '25'),
  },
};

// Fail fast on insecure defaults in production.
if (env.isProd) {
  if (env.jwtSecret.includes('dev-only') || env.cookieSecret.includes('dev-only')) {
    throw new Error('Refusing to start in production with development secrets.');
  }
}

module.exports = env;
