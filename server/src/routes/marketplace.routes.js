'use strict';

const { Router } = require('express');
const { validateObjectId } = require('../middleware/validate');
const controller = require('../controllers/marketplaceController');

const router = Router();

router.get('/', controller.listListings);
router.get('/:id', validateObjectId('id'), controller.getListing);

module.exports = router;