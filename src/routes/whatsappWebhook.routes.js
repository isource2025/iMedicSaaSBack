const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/whatsappWebhook.controller');

router.get('/', ctrl.verificar);
router.post('/', ctrl.recibirEventos);

module.exports = router;
