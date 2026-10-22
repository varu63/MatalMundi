'use strict';

const { Router } = require('express');
const { requireAdmin } = require('../middleware/auth');
const { validate, validateObjectId } = require('../middleware/validate');
const { listingImageUpload } = require('../middleware/upload');
const ad = require('../validators/adminValidators');
const av = require('../validators/auctionValidators');

const dashboardController = require('../controllers/admin/dashboardController');
const submissionController = require('../controllers/admin/submissionController');
const listingController = require('../controllers/admin/listingController');
const inventoryController = require('../controllers/admin/inventoryController');
const orderController = require('../controllers/admin/orderController');
const userController = require('../controllers/admin/userController');
const pricingController = require('../controllers/admin/pricingController');
const categoryController = require('../controllers/admin/categoryController');
const auditController = require('../controllers/admin/auditController');
const auctionController = require('../controllers/admin/auctionController');

const router = Router();
router.use(requireAdmin);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', dashboardController.getDashboard);

// ── Waste submissions ───────────────────────────────────────────────────────
router.get(
  '/waste-submissions',
  validate(ad.adminSubmissionsQuerySchema, 'query'),
  submissionController.listSubmissions
);
router.get('/waste-submissions/:id', validateObjectId('id'), submissionController.getSubmission);
router.patch(
  '/waste-submissions/:id/review',
  validateObjectId('id'),
  validate(ad.reviewSchema),
  submissionController.reviewSubmission
);
router.post(
  '/waste-submissions/:id/approve',
  validateObjectId('id'),
  validate(ad.approveSchema),
  submissionController.approveSubmission
);
router.post(
  '/waste-submissions/:id/reject',
  validateObjectId('id'),
  validate(ad.rejectSchema),
  submissionController.rejectSubmission
);
router.post(
  '/waste-submissions/:id/collect',
  validateObjectId('id'),
  validate(ad.collectSchema),
  submissionController.collectSubmission
);
router.post(
  '/waste-submissions/:id/publish',
  validateObjectId('id'),
  listingImageUpload,
  validate(ad.publishSchema),
  submissionController.publishSubmission
);

// ── Listings ────────────────────────────────────────────────────────────────
router.get(
  '/listings',
  validate(ad.adminListingsQuerySchema, 'query'),
  listingController.listListings
);
router.get('/listings/:id', validateObjectId('id'), listingController.getListing);
router.post('/listings/:id/recheck', validateObjectId('id'), listingController.recheckListing);
router.patch(
  '/listings/:id',
  validateObjectId('id'),
  validate(ad.updateListingSchema),
  listingController.updateListing
);
router.patch(
  '/listings/:id/status',
  validateObjectId('id'),
  validate(ad.listingStatusSchema),
  listingController.updateListingStatus
);

// ── Inventory ───────────────────────────────────────────────────────────────
router.get('/inventory', inventoryController.listInventory);
router.get('/inventory/:id', validateObjectId('id'), inventoryController.getInventory);

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders', validate(ad.adminOrdersQuerySchema, 'query'), orderController.listOrders);
router.get('/orders/:id', validateObjectId('id'), orderController.getOrder);
router.patch(
  '/orders/:id/status',
  validateObjectId('id'),
  validate(ad.orderStatusSchema),
  orderController.updateStatus
);

// ── Users ───────────────────────────────────────────────────────────────────
router.get('/users', userController.listUsers);
router.get('/users/:id', validateObjectId('id'), userController.getUser);
router.get('/users/:id/summary', validateObjectId('id'), userController.getUserSummary);
router.patch(
  '/users/:id/status',
  validateObjectId('id'),
  validate(ad.userStatusSchema),
  userController.updateUserStatus
);

// ── Categories ──────────────────────────────────────────────────────────────
router.get('/categories', categoryController.listCategories);
router.post('/categories', validate(ad.categorySchema), categoryController.createCategory);
router.patch(
  '/categories/:id',
  validateObjectId('id'),
  validate(ad.updateCategorySchema),
  categoryController.updateCategory
);

// ── Pricing ─────────────────────────────────────────────────────────────────
router.get('/pricing', pricingController.listPricing);
router.post('/pricing', validate(ad.createPricingSchema), pricingController.createPricing);
router.patch(
  '/pricing/:id',
  validateObjectId('id'),
  validate(ad.updatePricingSchema),
  pricingController.updatePricing
);
router.patch(
  '/pricing/:id/status',
  validateObjectId('id'),
  validate(ad.pricingStatusSchema),
  pricingController.togglePricing
);

// ── Auction settings ────────────────────────────────────────────────────────
router.get('/auction-settings', auctionController.getSettings);
router.patch(
  '/auction-settings',
  validate(av.updateAuctionSettingsSchema),
  auctionController.updateSettings
);

// ── Auctions ────────────────────────────────────────────────────────────────
router.get(
  '/auctions',
  validate(av.adminAuctionListQuerySchema, 'query'),
  auctionController.listAuctions
);
router.get('/auctions/:id', validateObjectId('id'), auctionController.getAuction);
router.get('/auctions/:id/bids', validateObjectId('id'), auctionController.getAuctionBids);
router.patch(
  '/auctions/:id',
  validateObjectId('id'),
  validate(av.updateAuctionSchema),
  auctionController.updateAuction
);
router.post(
  '/auctions/:id/approve',
  validateObjectId('id'),
  validate(av.approveAuctionSchema),
  auctionController.approveAuction
);
router.post(
  '/auctions/:id/reject',
  validateObjectId('id'),
  validate(av.rejectAuctionSchema),
  auctionController.rejectAuction
);
router.post(
  '/auctions/:id/cancel',
  validateObjectId('id'),
  validate(av.cancelAuctionSchema),
  auctionController.cancelAuction
);
router.post(
  '/auctions/:id/payment-received',
  validateObjectId('id'),
  validate(av.paymentReceivedSchema),
  auctionController.paymentReceived
);
router.post(
  '/auctions/:id/complete',
  validateObjectId('id'),
  validate(av.completeAuctionSchema),
  auctionController.completeAuction
);

// ── Audit logs ──────────────────────────────────────────────────────────────
router.get('/audit-logs', auditController.listAuditLogs);

module.exports = router;
