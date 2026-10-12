'use strict';

const { Router } = require('express');
const { validate, validateObjectId } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const { wasteImageUpload } = require('../middleware/upload');
const parseJsonFields = require('../middleware/parseJsonFields');
const validator = require('../validators/wasteValidators');
const controller = require('../controllers/wasteController');

const router = Router();

router.use(protect);

router.post(
  '/',
  writeLimiter,
  wasteImageUpload,
  parseJsonFields(['pickup']),
  validate(validator.createSubmissionSchema),
  controller.createSubmission,
);

router.post('/estimate', validate(validator.estimateSchema), controller.estimateValuation);
router.get('/my', validate(validator.mySubmissionsQuerySchema, 'query'), controller.mySubmissions);
router.get('/:id', validateObjectId('id'), controller.getSubmission);

module.exports = router;