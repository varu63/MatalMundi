'use strict';

const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const { signToken, setAuthCookie, clearAuthCookie } = require('../services/tokenService');
const { recordAudit } = require('../services/auditService');
const { randomToken } = require('../utils/idGenerator');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTION } = require('../utils/constants');
const env = require('../config/env');

/** POST /auth/register — public self-registration. Role is always USER. */
const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, address } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const verificationToken = randomToken(24);
  const user = new User({
    name,
    email,
    phone,
    address: address || {},
    role: ROLES.USER, // never trust a client-supplied role
    accountStatus: ACCOUNT_STATUS.ACTIVE,
    emailVerification: {
      verified: false,
      token: verificationToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await user.setPassword(password);
  await user.save();

  const token = signToken(user);
  setAuthCookie(res, token);
  await recordAudit({ action: AUDIT_ACTION.REGISTER, resourceType: 'User', resourceId: user._id, req });

  const data = { user: user.toSafeJSON() };
  // In development the verification token is returned so email flows can be
  // exercised without a mail provider (documented limitation).
  if (!env.isProd) data.emailVerificationToken = verificationToken;

  return created(res, data, 'Account created successfully');
});

/** POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw ApiError.forbidden('Your account has been suspended');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user);
  setAuthCookie(res, token);
  await recordAudit({ action: AUDIT_ACTION.LOGIN, resourceType: 'User', resourceId: user._id, req });

  return ok(res, { user: user.toSafeJSON() }, 'Logged in successfully');
});

/** POST /auth/logout */
const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  if (req.user) {
    await recordAudit({ action: AUDIT_ACTION.LOGOUT, resourceType: 'User', resourceId: req.user._id, req });
  }
  return ok(res, null, 'Logged out successfully');
});

/** GET /auth/me */
const me = asyncHandler(async (req, res) => ok(res, { user: req.user.toSafeJSON() }));

/** POST /auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always respond the same way (do not reveal whether the email exists).
  const data = {};
  if (user) {
    const token = randomToken(24);
    user.passwordReset = { token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
    await user.save();
    if (!env.isProd) data.resetToken = token;
    // In production this token would be emailed; no provider is configured.
  }
  return ok(res, data, 'If an account exists for that email, a reset link has been sent.');
});

/** POST /auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const user = await User.findOne({
    'passwordReset.token': token,
    'passwordReset.expiresAt': { $gt: new Date() },
  });
  if (!user) throw ApiError.badRequest('Reset token is invalid or has expired');

  await user.setPassword(password);
  user.passwordReset = { token: undefined, expiresAt: undefined };
  await user.save();

  return ok(res, null, 'Password has been reset. You can now log in.');
});

/** POST /auth/verify-email */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.findOne({
    'emailVerification.token': token,
    'emailVerification.expiresAt': { $gt: new Date() },
  });
  if (!user) throw ApiError.badRequest('Verification token is invalid or has expired');

  user.emailVerification.verified = true;
  user.emailVerification.token = undefined;
  user.emailVerification.expiresAt = undefined;
  await user.save();

  return ok(res, { user: user.toSafeJSON() }, 'Email verified successfully');
});

module.exports = { register, login, logout, me, forgotPassword, resetPassword, verifyEmail };
