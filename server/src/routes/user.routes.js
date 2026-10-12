'use strict';

const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const authValidator = require('../validators/authValidators');
const controller = require('../controllers/userController');

const router = Router();

router.use(protect);
router.get('/me', controller.getMe);
router.patch('/me', validate(authValidator.updateProfileSchema), controller.updateMe);

module.exports = router;