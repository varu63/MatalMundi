'use strict';

const usersRepo = require('../repositories/users');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/apiResponse');
const { serializeUser, normalizeAddress } = require('../utils/serializers');

/** GET /users/me */
const getMe = asyncHandler(async (req, res) => ok(res, { user: serializeUser(req.user) }));

/** PATCH /users/me */
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body;

  const data = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) {
    data.address = { ...normalizeAddress(req.user.address), ...address };
  }

  const fresh = Object.keys(data).length
    ? await usersRepo.updateById(req.user.id, data)
    : req.user;

  return ok(res, { user: serializeUser(fresh) }, 'Profile updated');
});

module.exports = { getMe, updateMe };
