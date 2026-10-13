'use strict';

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function verifyPassword(plain, passwordHash) {
  if (!passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
