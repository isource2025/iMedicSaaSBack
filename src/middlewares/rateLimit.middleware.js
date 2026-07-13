const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { AUTH_FAIL_MESSAGE } = require('../config/security');

const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: Number(process.env.AUTH_LOGIN_RATE_MAX) || 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, mensaje: AUTH_FAIL_MESSAGE },
	keyGenerator: (req) => {
		const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
		const user = String(req.body?.username || '').trim().toLowerCase();
		return `${ip}:${user || 'anon'}`;
	},
});

const authGeneralLimiter = rateLimit({
	windowMs: 60 * 1000,
	max: Number(process.env.AUTH_GENERAL_RATE_MAX) || 60,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, mensaje: 'Demasiadas solicitudes. Intente más tarde.' },
});

module.exports = { loginLimiter, authGeneralLimiter };
