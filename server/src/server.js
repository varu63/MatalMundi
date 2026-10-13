'use strict';

const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { initSocket, shutdownSocket } = require('./services/socketService');
const { startAuctionWorker, recoverAuctions } = require('./services/auctionService');
const logger = require('./utils/logger');

async function start() {
  try {
    await connectDB();

    const server = http.createServer(app);
    initSocket(server);

    server.listen(env.port, () => {
      logger.info('--------------------------------------------------');
      logger.info(` MetalMundi API  ·  ${env.nodeEnv}`);
      logger.info(` Listening      →  http://localhost:${env.port}`);
      logger.info(` Health check   →  /api/v1/health`);
      logger.info(` PostgreSQL     →  connected`);
      logger.info('--------------------------------------------------');
    });

    server.requestTimeout = 30_000;

    // Auction engine: first catch up on anything that expired while the server
    // was down, then keep checking on an interval (server clock is the only
    // clock — browsers can refresh or close without affecting the timer).
    try {
      await recoverAuctions();
      startAuctionWorker();
    } catch (err) {
      logger.error(`Auction worker startup failed: ${err.message}`);
    }

    const shutdown = async (signal) => {
      logger.warn(`${signal} received. Shutting down gracefully...`);
      await shutdownSocket();
      server.close(() => process.exit(0));
      await disconnectDB();
      setTimeout(() => process.exit(0), 2000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    // Never start serving as though the app were ready without a database.
    logger.error(`Unable to establish PostgreSQL connection. Server will not start. (${err.message})`);
    process.exit(1);
  }
}

start();
