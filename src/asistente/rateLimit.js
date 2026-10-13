const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const asistenteLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: Number(process.env.ASISTENTE_RATE_MAX) || 40,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, mensaje: 'Demasiados mensajes al asistente. Probá en unos minutos.' },
	keyGenerator: (req) => {
		const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
		return `${ip}:${req.valorPersonal || 'anon'}:${req.idEmpresa || 0}`;
	},
});

module.exports = { asistenteLimiter };
