const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/turneroDisplay.controller');

router.get('/:token/events', ctrl.streamEventos);
router.get('/:token', ctrl.obtenerEstado);

module.exports = router;
