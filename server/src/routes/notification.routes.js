'use strict';

const { Router } = require('express');
const { validateObjectId } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const controller = require('../controllers/notificationController');

const router = Router();

router.use(protect);
router.get('/my', controller.listMine);
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validateObjectId('id'), controller.markRead);

module.exports = router;