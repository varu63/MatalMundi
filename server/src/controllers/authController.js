'use strict';

const usersRepo = require('../repositories/users');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const { serializeUser } = require('../utils/serializers');
const { signToken, setAuthCookie, clearAuthCookie } = require('../services/tokenService');
const { recordAudit } = require('../services/auditService');
const { randomToken } = require('../utils/idGenerator');
const { verifyPassword, hashPassword } = require('../utils/password');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTION } = require('../utils/constants');
const env = require('../config/env');

/** POST /auth/register — public self-registration. Role is always USER. */
const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, address } = req.body;

  const existing = await usersRepo.findByEmail(email);
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const verificationToken = randomToken(24);
  const user = await usersRepo.create({
    name,
    email,
    phone,
    password,
    address: address || {},
    role: ROLES.USER, // never trust a client-supplied role
    accountStatus: ACCOUNT_STATUS.ACTIVE,
    emailVerificationVerified: false,
    emailVerificationToken: verificationToken,
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const token = signToken(user);
  setAuthCookie(res, token);
  await recordAudit({ action: AUDIT_ACTION.REGISTER, resourceType: 'User', resourceId: user.id, req });

  const data = { user: serializeUser(user) };
  // In development the verification token is returned so email flows can be
  // exercised without a mail provider (documented limitation).
  if (!env.isProd) data.emailVerificationToken = verificationToken;

  return created(res, data, 'Account created successfully');
});

/** POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await usersRepo.findByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw ApiError.forbidden('Your account has been suspended');
  }

  const fresh = await usersRepo.updateById(user.id, { lastLoginAt: new Date() });

  const token = signToken(fresh);
  setAuthCookie(res, token);
  await recordAudit({ action: AUDIT_ACTION.LOGIN, resourceType: 'User', resourceId: fresh.id, req });

  return ok(res, { user: serializeUser(fresh) }, 'Logged in successfully');
});

/** POST /auth/logout */
const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  if (req.user) {
    await recordAudit({ action: AUDIT_ACTION.LOGOUT, resourceType: 'User', resourceId: req.user.id, req });
  }
  return ok(res, null, 'Logged out successfully');
});

/** GET /auth/me */
const me = asyncHandler(async (req, res) => ok(res, { user: serializeUser(req.user) }));

/** POST /auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await usersRepo.findByEmail(email);

  // Always respond the same way (do not reveal whether the email exists).
  const data = {};
  if (user) {
    const token = randomToken(24);
    await usersRepo.updateById(user.id, {
      passwordResetToken: token,
      passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!env.isProd) data.resetToken = token;
    // In production this token would be emailed; no provider is configured.
  }
  return ok(res, data, 'If an account exists for that email, a reset link has been sent.');
});

/** POST /auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const user = await usersRepo.findByPasswordResetToken(token);
  if (!user) throw ApiError.badRequest('Reset token is invalid or has expired');

  await usersRepo.updateById(user.id, {
    passwordHash: await hashPassword(password),
    passwordResetToken: null,
    passwordResetExpiresAt: null,
  });

  return ok(res, null, 'Password has been reset. You can now log in.');
});

/** POST /auth/verify-email */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await usersRepo.findByEmailVerificationToken(token);
  if (!user) throw ApiError.badRequest('Verification token is invalid or has expired');

  const fresh = await usersRepo.updateById(user.id, {
    emailVerificationVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
  });

  return ok(res, { user: serializeUser(fresh) }, 'Email verified successfully');
});

module.exports = { register, login, logout, me, forgotPassword, resetPassword, verifyEmail };
