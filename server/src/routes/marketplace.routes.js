'use strict';

const { Router } = require('express');
const { validateObjectId } = require('../middleware/validate');
const controller = require('../controllers/marketplaceController');

const router = Router();

router.get('/', controller.listListings);
// Registered before `/:id` so "geocode" is never treated as a listing id.
// Covered by the global API rate limiter; the provider call itself is bounded
// by a timeout.
router.get('/geocode', controller.geocodePlace);
router.get('/:id', validateObjectId('id'), controller.getListing);

module.exports = router;
