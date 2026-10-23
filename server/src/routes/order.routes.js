'use strict';

const { Router } = require('express');
const { validate, validateObjectId } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const validator = require('../validators/orderValidators');
const controller = require('../controllers/orderController');

const router = Router();

router.use(protect);
router.post('/', writeLimiter, validate(validator.createOrderSchema), controller.createOrder);
router.get('/my', validate(validator.myOrdersQuerySchema, 'query'), controller.myOrders);
router.get(
  '/selling',
  validate(validator.myOrdersQuerySchema, 'query'),
  controller.sellerOrders
);
router.patch(
  '/:id/confirm',
  writeLimiter,
  validateObjectId('id'),
  validate(validator.confirmOrderSchema),
  controller.confirmOrder
);
router.patch(
  '/:id/decline',
  writeLimiter,
  validateObjectId('id'),
  validate(validator.declineOrderSchema),
  controller.declineOrder
);
router.patch(
  '/:id/status',
  writeLimiter,
  validateObjectId('id'),
  validate(validator.sellerStatusSchema),
  controller.updateSellerOrderStatus
);
router.get('/:id', validateObjectId('id'), controller.getOrder);

module.exports = router;
