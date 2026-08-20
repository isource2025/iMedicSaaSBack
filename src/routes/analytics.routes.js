const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/analytics.controller');

const router = express.Router();

const eventLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: Number(process.env.ANALYTICS_EVENT_RATE_MAX) || 40,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, mensaje: 'Demasiadas solicitudes. Intente más tarde.' },
	keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown'),
});

router.post('/events', eventLimiter, ctrl.registrarEvento);

router.get(
	'/session-expiration',
	requireAuth,
	requirePermiso('PLATAFORMA.ANALITICA.VER'),
	ctrl.estadisticasSesion,
);

module.exports = router;
