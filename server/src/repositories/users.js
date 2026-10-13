'use strict';

const { prisma } = require('../config/db');
const { newId } = require('../utils/idGenerator');
const { hashPassword } = require('../utils/password');

/**
 * User data access. Returns raw Prisma rows — controllers shape responses with
 * `serializeUser` so `passwordHash` is never serialized accidentally.
 */

async function create({
  name,
  email,
  phone,
  password,
  address = {},
  role = 'USER',
  accountStatus = 'ACTIVE',
  emailVerificationVerified = false,
  emailVerificationToken = null,
  emailVerificationExpiresAt = null,
}) {
  return prisma.user.create({
    data: {
      id: newId(),
      name,
      email,
      phone,
      passwordHash: await hashPassword(password),
      role,
      address,
      accountStatus,
      emailVerificationVerified,
      emailVerificationToken,
      emailVerificationExpiresAt,
    },
  });
}

function findByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findById(id) {
  return prisma.user.findUnique({ where: { id } });
}

async function updateById(id, data) {
  try {
    return await prisma.user.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2025') return null;
    throw err;
  }
}

function findByPasswordResetToken(token) {
  return prisma.user.findFirst({
    where: { passwordResetToken: token, passwordResetExpiresAt: { gt: new Date() } },
  });
}

function findByEmailVerificationToken(token) {
  return prisma.user.findFirst({
    where: { emailVerificationToken: token, emailVerificationExpiresAt: { gt: new Date() } },
  });
}

async function list({ accountStatus, role, search, skip = 0, take = 12 } = {}) {
  const where = {};
  where.role = role || { in: ['USER', 'ADMIN'] };
  if (accountStatus) where.accountStatus = accountStatus;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

function count(where = {}) {
  return prisma.user.count({ where });
}

module.exports = {
  create,
  findByEmail,
  findById,
  updateById,
  findByPasswordResetToken,
  findByEmailVerificationToken,
  list,
  count,
};
