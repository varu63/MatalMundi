'use strict';

const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');
const usersRepo = require('../repositories/users');
const { verifyToken, AUTH_COOKIE } = require('./tokenService');

/**
 * Real-time transport for auctions.
 *
 * Design notes:
 *  - Socket auth is OPTIONAL: guests may watch public auction rooms; the price
 *    of a lot is public information. Placing bids stays on REST so every rule
 *    is validated in one backend place.
 *  - Only minimal public payloads are broadcast. Bidder identities and reserve
 *    prices are never put on the wire; personal events go to `user:<id>` rooms.
 *  - All emitters degrade to no-ops when Socket.IO is not initialised (tests).
 */

const ID_RE = /^[0-9a-fA-F]{24}$/;

let io = null;

function parseCookie(header, name) {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name.replace('.', '\\.')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function initSocket(httpServer) {
  const originList = [...env.corsOrigins, env.clientUrl].filter(Boolean);
  io = new Server(httpServer, {
    cors: { origin: originList.length ? originList : true, credentials: true },
    // Same-host browser clients (single-service deployment) are always allowed,
    // mirroring the HTTP CORS delegate in app.js — even when CORS_ORIGINS is unset.
    allowRequest: (req, allow) => {
      if (!originList.length) return allow(null, true);
      const origin = req.headers.origin;
      if (!origin) return allow(null, true); // non-browser clients
      let sameHost = false;
      try {
        sameHost = new URL(origin).host === req.headers.host;
      } catch {
        sameHost = false;
      }
      return allow(null, sameHost || originList.includes(origin));
    },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      const token =
        parseCookie(socket.handshake.headers.cookie, AUTH_COOKIE) ||
        (socket.handshake.auth && socket.handshake.auth.token) ||
        null;
      if (token) {
        const decoded = verifyToken(token);
        const user = await usersRepo.findById(decoded.sub);
        if (user) socket.data.user = { id: user.id, role: user.role };
      }
    } catch (_err) {
      // Stay anonymous; never reject the handshake for a bad token.
    }
    return next();
  });

  io.on('connection', (socket) => {
    if (socket.data.user) socket.join(`user:${socket.data.user.id}`);

    socket.on('auction:join', (auctionId) => {
      if (typeof auctionId === 'string' && ID_RE.test(auctionId)) {
        socket.join(`auction:${auctionId}`);
      }
    });

    socket.on('auction:leave', (auctionId) => {
      if (typeof auctionId === 'string' && ID_RE.test(auctionId)) {
        socket.leave(`auction:${auctionId}`);
      }
    });
  });

  logger.info('Socket.IO → listening for real-time auction updates');
  return io;
}

function getIO() {
  return io;
}

function emitAuctionEvent(auctionId, event, payload) {
  if (!io) return;
  io.to(`auction:${auctionId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function shutdownSocket() {
  if (!io) return Promise.resolve();
  const closing = io;
  io = null;
  return new Promise((resolve) => closing.close(() => resolve()));
}

module.exports = { initSocket, getIO, emitAuctionEvent, emitToUser, shutdownSocket };
