'use strict';

const { Router } = require('express');
const { authLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { protect, optionalAuth } = require('../middleware/auth');
const { issueCsrfToken, getCsrfToken } = require('../middleware/csrf');
const authValidator = require('../validators/authValidators');
const controller = require('../controllers/authController');

const router = Router();

// Every request through this router gets a CSRF token cookie.
router.use(issueCsrfToken);

router.post('/register', authLimiter, validate(authValidator.registerSchema), controller.register);
router.post('/login', authLimiter, validate(authValidator.loginSchema), controller.login);
router.post('/logout', optionalAuth, controller.logout);
router.get('/me', protect, controller.me);
router.post('/forgot-password', authLimiter, validate(authValidator.forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', authLimiter, validate(authValidator.resetPasswordSchema), controller.resetPassword);
router.post('/verify-email', validate(authValidator.verifyEmailSchema), controller.verifyEmail);
router.get('/csrf', getCsrfToken);

module.exports = router;