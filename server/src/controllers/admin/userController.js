'use strict';

const usersRepo = require('../../repositories/users');
const ordersRepo = require('../../repositories/orders');
const submissionsRepo = require('../../repositories/submissions');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { serializeUser } = require('../../utils/serializers');
const { recordAudit } = require('../../services/auditService');
const { parsePage } = require('../../utils/numbers');
const { ACCOUNT_STATUS, ROLES, AUDIT_ACTION, ORDER_STATUS } = require('../../utils/constants');

/** GET /admin/users */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const { rows, total } = await usersRepo.list({
    accountStatus: req.query.status,
    role: req.query.role,
    search: req.query.search,
    skip,
    take: limit,
  });
  return paginated(res, rows.map(serializeUser), { page, limit, total });
});

/** GET /admin/users/:id */
const getUser = asyncHandler(async (req, res) => {
  const user = await usersRepo.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  return ok(res, { user: serializeUser(user) });
});

/** PATCH /admin/users/:id/status — suspend or reactivate. */
const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!Object.values(ACCOUNT_STATUS).includes(status)) {
    throw ApiError.badRequest('Invalid account status');
  }
  const user = await usersRepo.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === ROLES.ADMIN) {
    throw ApiError.forbidden('Admin accounts cannot be suspended via this endpoint');
  }

  const updated = await usersRepo.updateById(user.id, { accountStatus: status });

  await recordAudit({
    action: AUDIT_ACTION.USER_STATUS,
    resourceType: 'User',
    resourceId: user.id,
    after: { accountStatus: status },
    req,
  });

  return ok(res, { user: serializeUser(updated) }, `Account ${status.toLowerCase()}`);
});

/** GET /admin/users/:id/summary — a user's marketplace activity. */
const getUserSummary = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const [orderCount, lifetimeSpendPaise, submissionCount, pendingOrders] = await Promise.all([
    ordersRepo.count({ buyerId: userId }),
    ordersRepo.sumTotalsForBuyer(userId),
    submissionsRepo.count({ sellerId: userId }),
    ordersRepo.count({ buyerId: userId, status: ORDER_STATUS.PENDING_ADMIN_APPROVAL }),
  ]);

  return ok(res, {
    summary: {
      orders: orderCount,
      lifetimeSpendPaise,
      pendingOrders,
      submissions: submissionCount,
    },
  });
});

module.exports = { listUsers, getUser, updateUserStatus, getUserSummary };
