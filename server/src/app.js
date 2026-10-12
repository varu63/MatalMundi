'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const env = require('./config/env');
const { issueCsrfToken, verifyCsrf } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.isProd ? 1 : 0);

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── CORS (only configured origins, always with credentials) ────────────────
const originList = [...env.corsOrigins, env.clientUrl].filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || originList.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
  }),
);

app.use(morgan(env.isProd ? 'combined' : 'dev'));

// ── Body parsing with size limits ───────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(env.cookieSecret));
app.use(express.raw({ type: 'image/*', limit: '6mb' }));

// ── Query sanitisation (blocks $where / $gt injection) ──────────────────────
app.use(mongoSanitize());

// ── CSRF tokens for the cookie-based auth ───────────────────────────────────
app.use(issueCsrfToken);
app.use('/api', verifyCsrf);

// ── Static uploads (local storage fallback) ─────────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '1d' }));

// ── Rate limiting on the public API ─────────────────────────────────────────
app.use('/api', apiLimiter);

// ── Application routes ───────────────────────────────────────────────────────
app.use('/api/v1', routes);

app.get('/', (_req, res) => {
  res.json({
    name: 'MetalMundi API',
    version: '1.0.0',
    docs: 'See README.md for API documentation',
    health: '/api/v1/health',
  });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;