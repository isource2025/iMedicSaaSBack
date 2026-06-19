const express = require('express');
const router = express.Router();
const estudiosController = require('../controllers/estudios.controller');

router.get('/visita/:idVisita', estudiosController.listarPorVisita);

module.exports = router;
