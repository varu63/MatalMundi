'use strict';

const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');

/** GET /users/me */
const getMe = asyncHandler(async (req, res) => ok(res, { user: req.user.toSafeJSON() }));

/** PATCH /users/me */
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body;

  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  if (address !== undefined) {
    req.user.address = { ...req.user.address.toObject?.() ?? req.user.address, ...address };
  }
  await req.user.save();

  return ok(res, { user: req.user.toSafeJSON() }, 'Profile updated');
});

module.exports = { getMe, updateMe };
