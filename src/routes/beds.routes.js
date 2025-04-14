const express = require('express');
const router = express.Router();
const bedsController = require('../controllers/beds.controller');


router.get('/', bedsController.obtenerCamas);


router.get('/:id', bedsController.obtenerCamaPorId);


router.put('/:id/status', bedsController.actualizarEstadoCama);

module.exports = router;
