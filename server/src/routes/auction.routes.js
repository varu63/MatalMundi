'use strict';

const { Router } = require('express');
const { validate, validateObjectId } = require('../middleware/validate');
const { protect, optionalAuth } = require('../middleware/auth');
const { bidLimiter } = require('../middleware/rateLimit');
const av = require('../validators/auctionValidators');
const controller = require('../controllers/auctionController');

const router = Router();

// ── Public ──────────────────────────────────────────────────────────────────
router.get('/', validate(av.auctionListQuerySchema, 'query'), controller.listAuctions);
router.get('/settings', controller.getPublicSettings);

// ── Seller / bidder (authenticated) — must be registered before /:id ────────
router.get('/my', protect, controller.myAuctions);
router.get('/my/bids', protect, controller.myBids);

// ── Auction detail (public, optional auth for richer view) ──────────────────
router.get('/:id', validateObjectId('id'), optionalAuth, controller.getAuction);
router.get('/:id/bids', validateObjectId('id'), optionalAuth, controller.listAuctionBids);

// ── Bidding ─────────────────────────────────────────────────────────────────
router.post(
  '/:id/bids',
  protect,
  validateObjectId('id'),
  bidLimiter,
  validate(av.placeBidSchema),
  controller.placeBid
);

module.exports = router;
