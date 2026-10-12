'use strict';

const { Router } = require('express');
const { isConnected } = require('../config/db');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const wasteRoutes = require('./waste.routes');
const marketplaceRoutes = require('./marketplace.routes');
const orderRoutes = require('./order.routes');
const notificationRoutes = require('./notification.routes');
const categoryRoutes = require('./category.routes');
const adminRoutes = require('./admin.routes');

const router = Router();

router.get('/health', (_req, res) => {
  const db = isConnected() ? 'connected' : 'disconnected';
  const status = isConnected() ? 200 : 503;
  res.status(status).json({
    success: isConnected(),
    message: isConnected() ? 'OK' : 'Database not ready',
    data: { status: 'ok', db, time: new Date().toISOString() },
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/waste-submissions', wasteRoutes);
router.use('/marketplace', marketplaceRoutes);
router.use('/orders', orderRoutes);
router.use('/notifications', notificationRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);

module.exports = router;