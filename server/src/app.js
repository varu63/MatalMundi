'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const env = require('./config/env');
const ApiError = require('./utils/ApiError');
const { issueCsrfToken, verifyCsrf } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.isProd ? 1 : 0);

// ── Security headers ────────────────────────────────────────────────────────
// CSP: same-origin by default; connect-src must allow the API origin (and its
// WebSocket upgrade for socket.io) plus configured frontend origins, or
// production API calls get blocked. img-src allows Cloudinary when configured.
const apiOrigin = env.apiPublicUrl.replace(/\/+$/, '');
const wsOrigin = apiOrigin.replace(/^http/, 'ws');
const connectOrigins = [...new Set([apiOrigin, wsOrigin, ...env.corsOrigins, env.clientUrl])].filter(
  Boolean
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'connect-src': ["'self'", ...connectOrigins],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.cloudinary.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': null,
      },
    },
  })
);

// ── CORS (only configured origins, always with credentials) ────────────────
// Same-origin requests are always allowed: browsers send an Origin header even
// for same-origin POSTs, and a single-service deployment (client served from
// this server) must not reject its own requests.
const originList = [...env.corsOrigins, env.clientUrl].filter(Boolean);
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    let sameHost = false;
    if (origin) {
      try {
        sameHost = new URL(origin).host === req.headers.host;
      } catch {
        sameHost = false;
      }
    }
    if (!origin || sameHost || originList.includes(origin)) {
      return cb(null, { origin: true, credentials: true });
    }
    // A rejected origin is a client error, not a server fault: answer 403 with
    // the normal envelope instead of a 500 that carries a stack in dev.
    return cb(ApiError.forbidden('Origin not allowed by CORS'));
  })
);

app.use(morgan(env.isProd ? 'combined' : 'dev'));

// ── Body parsing with size limits ───────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(env.cookieSecret));
app.use(express.raw({ type: 'image/*', limit: '6mb' }));

// ── CSRF tokens for the cookie-based auth ───────────────────────────────────
app.use(issueCsrfToken);
app.use('/api', verifyCsrf);

// ── Static uploads (local storage fallback) ─────────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '1d' }));

// ── Rate limiting on the public API ─────────────────────────────────────────
app.use('/api', apiLimiter);

// ── Application routes ───────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── Serve the built React app when present (single-service deployment) ───────
// Run `npm run build` first; unknown non-API paths fall back to index.html so
// client-side routes (e.g. /marketplace, /admin) work on a hard refresh.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/uploads/') ||
      req.path.startsWith('/socket.io/')
    ) {
      return next();
    }
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
}

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
