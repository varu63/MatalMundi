'use strict';

const {
  users: usersRepo,
  submissions: submissionsRepo,
  listings: listingsRepo,
  orders: ordersRepo,
  lots: lotsRepo,
} = require('../../repositories');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { serializeSubmission, serializeOrder } = require('../../utils/serializers');
const { ORDER_STATUS, ROLES, LISTING_STATUS } = require('../../utils/constants');

/** GET /admin/dashboard — all figures come from live aggregation. */
const getDashboard = asyncHandler(async (req, res) => {
  const activeOrderStatuses = [
    ORDER_STATUS.ACCEPTED,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.READY_FOR_DISPATCH,
    ORDER_STATUS.DISPATCHED,
  ];

  const [
    totalUsers,
    pendingSubmissions,
    underReview,
    approvedAwaitingPublication,
    publishedListings,
    aiFlaggedListings,
    pendingOrders,
    acceptedOrders,
    completedDeliveries,
    inventory,
    recentSubmissions,
    recentOrders,
  ] = await Promise.all([
    usersRepo.count({ role: ROLES.USER }),
    submissionsRepo.count({ status: 'PENDING_APPROVAL' }),
    submissionsRepo.count({ status: 'UNDER_REVIEW' }),
    submissionsRepo.count({ status: 'APPROVED' }),
    listingsRepo.count({ active: true, publicationStatus: LISTING_STATUS.PUBLISHED }),
    listingsRepo.count({ imageCheckFlagged: true }),
    ordersRepo.count({ status: ORDER_STATUS.PENDING_ADMIN_APPROVAL }),
    ordersRepo.count({ status: { in: activeOrderStatuses } }),
    ordersRepo.count({ status: ORDER_STATUS.DELIVERED }),
    lotsRepo.aggregateTotals(),
    submissionsRepo.findRecent(5),
    ordersRepo.findRecent(5),
  ]);

  return ok(res, {
    stats: {
      totalUsers,
      pendingSubmissions,
      underReview,
      approvedAwaitingPublication,
      publishedListings,
      aiFlaggedListings,
      pendingOrders,
      acceptedOrders,
      completedDeliveries,
      totalCollectedKg: inventory.totalCollectedKg,
      activeInventoryKg: inventory.activeInventoryKg,
      reservedKg: inventory.reservedKg,
      totalSoldKg: inventory.totalSoldKg,
    },
    recentSubmissions: recentSubmissions.map(serializeSubmission),
    recentOrders: recentOrders.map((order) =>
      serializeOrder(order, { viewer: req.user, isAdmin: true })
    ),
  });
});

module.exports = { getDashboard };
