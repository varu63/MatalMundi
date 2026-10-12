'use strict';

const { User } = require('../../models');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { recordAudit } = require('../../services/auditService');
const { parsePage } = require('../../utils/numbers');
const { ACCOUNT_STATUS, ROLES, AUDIT_ACTION, ORDER_STATUS } = require('../../utils/constants');

function safeUser(u) {
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    accountStatus: u.accountStatus,
    emailVerified: u.emailVerification?.verified || false,
    address: u.address,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/** GET /admin/users */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const filter = { role: { $in: [ROLES.USER, ROLES.ADMIN] } };
  if (req.query.status) filter.accountStatus = req.query.status;
  if (req.query.role) filter.role = req.query.role;
  if (req.query.search) {
    const term = String(req.query.search).trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return paginated(res, users.map(safeUser), { page, limit, total });
});

/** GET /admin/users/:id */
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) throw ApiError.notFound('User not found');
  return ok(res, { user: safeUser(user) });
});

/** PATCH /admin/users/:id/status — suspend or reactivate. */
const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!Object.values(ACCOUNT_STATUS).includes(status)) {
    throw ApiError.badRequest('Invalid account status');
  }
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === ROLES.ADMIN) {
    throw ApiError.forbidden('Admin accounts cannot be suspended via this endpoint');
  }

  user.accountStatus = status;
  await user.save();

  await recordAudit({
    action: AUDIT_ACTION.USER_STATUS,
    resourceType: 'User',
    resourceId: user._id,
    after: { accountStatus: status },
    req,
  });

  return ok(res, { user: safeUser(user) }, `Account ${status.toLowerCase()}`);
});

/** GET /admin/users/:id/summary — a user's marketplace activity. */
const getUserSummary = asyncHandler(async (req, res) => {
  const { Order, WasteSubmission } = require('../../models');
  const userId = req.params.id;
  const [orderCount, orderTotalAgg, submissionCount, pendingOrders] = await Promise.all([
    Order.countDocuments({ buyer: userId }),
    Order.aggregate([{ $match: { buyer: new (require('mongoose').Types.ObjectId)(userId) } }, { $group: { _id: null, total: { $sum: '$totalPaise' } } }]),
    WasteSubmission.countDocuments({ seller: userId }),
    Order.countDocuments({ buyer: userId, status: ORDER_STATUS.PENDING_ADMIN_APPROVAL }),
  ]);

  return ok(res, {
    summary: {
      orders: orderCount,
      lifetimeSpendPaise: orderTotalAgg[0]?.total || 0,
      pendingOrders,
      submissions: submissionCount,
    },
  });
});

module.exports = { listUsers, getUser, updateUserStatus, getUserSummary };