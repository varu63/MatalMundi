'use strict';

const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const logger = require('../utils/logger');

// Single shared Prisma client for the whole process. `datasourceUrl` is taken
// from the loaded env (not the schema's env lookup) so tests can point the
// whole app at a separate database before it is required for the first time.
const prisma = new PrismaClient({ datasourceUrl: env.databaseUrl });

async function connectDB() {
  await prisma.$connect();
  logger.info('PostgreSQL connected');
}

async function disconnectDB() {
  await prisma.$disconnect();
}

/** Real connectivity probe used by the readiness endpoint. */
async function ping() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

module.exports = { prisma, connectDB, disconnectDB, ping };
