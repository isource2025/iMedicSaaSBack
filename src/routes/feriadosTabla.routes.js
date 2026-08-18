const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feriadosTabla.controller');

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.put('/:fecha', ctrl.actualizar);
router.delete('/:fecha', ctrl.eliminar);

module.exports = router;
