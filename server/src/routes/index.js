'use strict';

const { Router } = require('express');
const { ping } = require('../config/db');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const wasteRoutes = require('./waste.routes');
const marketplaceRoutes = require('./marketplace.routes');
const orderRoutes = require('./order.routes');
const notificationRoutes = require('./notification.routes');
const categoryRoutes = require('./category.routes');
const auctionRoutes = require('./auction.routes');
const adminRoutes = require('./admin.routes');

const router = Router();

router.get('/health', async (_req, res) => {
  const dbUp = await ping();
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    message: dbUp ? 'OK' : 'Database not ready',
    data: {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'connected' : 'disconnected',
      time: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/waste-submissions', wasteRoutes);
router.use('/marketplace', marketplaceRoutes);
router.use('/orders', orderRoutes);
router.use('/notifications', notificationRoutes);
router.use('/categories', categoryRoutes);
router.use('/auctions', auctionRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
