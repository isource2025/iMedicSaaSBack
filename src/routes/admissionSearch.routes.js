const express = require('express');
const controller = require('../controllers/admissionSearch.controller');

const router = express.Router();

router.get('/', controller.buscar);
router.get('/:numeroVisita/detail', controller.detalle);
router.post('/:numeroVisita/export-selective', controller.exportSelectivo);

module.exports = router;
