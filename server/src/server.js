'use strict';

const app = require('./app');
const env = require('./config/env');
const { connectDB, disconnectDB, isConnected } = require('./config/db');
const logger = require('./utils/logger');

async function start() {
  try {
    await connectDB();
    if (!isConnected()) {
      // Never start serving as though the app were ready without a database.
      logger.error('Unable to establish MongoDB connection. Server will not start.');
      process.exit(1);
    }

    const server = app.listen(env.port, () => {
      logger.info('--------------------------------------------------');
      logger.info(` MetalMundi API  ·  ${env.nodeEnv}`);
      logger.info(` Listening      →  http://localhost:${env.port}`);
      logger.info(` Health check   →  /api/v1/health`);
      logger.info(` MongoDB        →  connected`);
      logger.info('--------------------------------------------------');
    });

    server.requestTimeout = 30_000;

    const shutdown = async (signal) => {
      logger.warn(`${signal} received. Shutting down gracefully...`);
      server.close(() => process.exit(0));
      await disconnectDB();
      setTimeout(() => process.exit(0), 2000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

start();