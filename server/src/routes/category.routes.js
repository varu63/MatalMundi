'use strict';

const { Router } = require('express');
const controller = require('../controllers/categoryController');

const router = Router();

router.get('/', controller.listCategories);
router.get('/:slug/types', controller.listCategoryTypes);

module.exports = router;
