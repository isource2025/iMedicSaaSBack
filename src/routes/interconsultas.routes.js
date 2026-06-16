const express = require('express');
const router = express.Router();
const interconsultasController = require('../controllers/interconsultas.controller');

router.get('/:idVisita', interconsultasController.listarPorVisita);
router.post('/', interconsultasController.crear);

module.exports = router;
