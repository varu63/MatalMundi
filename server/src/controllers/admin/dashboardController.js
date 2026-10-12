'use strict';

const { User, WasteSubmission, MarketplaceListing, Order, InventoryLot } = require('../../models');
const asyncHandler = require('../../middleware/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ORDER_STATUS, ROLES, LISTING_STATUS } = require('../../utils/constants');

/** GET /admin/dashboard — all figures come from live aggregation. */
const getDashboard = asyncHandler(async (_req, res) => {
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
    pendingOrders,
    acceptedOrders,
    completedDeliveries,
    inventoryAgg,
    recentSubmissions,
    recentOrders,
  ] = await Promise.all([
    User.countDocuments({ role: ROLES.USER }),
    WasteSubmission.countDocuments({ status: 'PENDING_APPROVAL' }),
    WasteSubmission.countDocuments({ status: 'UNDER_REVIEW' }),
    WasteSubmission.countDocuments({ status: 'APPROVED' }),
    MarketplaceListing.countDocuments({ active: true, publicationStatus: LISTING_STATUS.PUBLISHED }),
    Order.countDocuments({ status: ORDER_STATUS.PENDING_ADMIN_APPROVAL }),
    Order.countDocuments({ status: { $in: activeOrderStatuses } }),
    Order.countDocuments({ status: ORDER_STATUS.DELIVERED }),
    InventoryLot.aggregate([
      {
        $group: {
          _id: null,
          totalCollectedKg: { $sum: '$acceptedQuantityKg' },
          activeInventoryKg: { $sum: '$availableQuantityKg' },
          reservedKg: { $sum: '$reservedQuantityKg' },
          totalSoldKg: { $sum: '$soldQuantityKg' },
        },
      },
    ]),
    WasteSubmission.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('seller', 'name')
      .populate('materialCategory', 'name')
      .lean(),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('buyer', 'name')
      .lean(),
  ]);

  const inventory = inventoryAgg[0] || {
    totalCollectedKg: 0,
    activeInventoryKg: 0,
    reservedKg: 0,
    totalSoldKg: 0,
  };

  return ok(res, {
    stats: {
      totalUsers,
      pendingSubmissions,
      underReview,
      approvedAwaitingPublication,
      publishedListings,
      pendingOrders,
      acceptedOrders,
      completedDeliveries,
      totalCollectedKg: inventory.totalCollectedKg,
      activeInventoryKg: inventory.activeInventoryKg,
      reservedKg: inventory.reservedKg,
      totalSoldKg: inventory.totalSoldKg,
    },
    recentSubmissions,
    recentOrders,
  });
});

module.exports = { getDashboard };
