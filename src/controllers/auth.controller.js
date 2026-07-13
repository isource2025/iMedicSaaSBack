const jwt = require('jsonwebtoken');
const authService = require('../services/auth.service');
const tenantRegistry = require('../services/tenantRegistry.service');
const authLoginFlow = require('../services/authLoginFlow.service');
const authAudit = require('../services/authAudit.service');
const sessionService = require('../services/session.service');
const geoPolicy = require('../services/geoPolicy.service');
const { runWithTenant } = require('../context/tenantContext');
const { JWT_SECRET, TEMP_TOKEN_EXPIRATION } = require('../config/jwt');
const {
	AUTH_FAIL_MESSAGE,
	timingPad,
	getClientIp,
} = require('../config/security');
const authCentralService = require('../services/authCentral.service');

function normalizarUsername(username) {
	return String(username || '').trim().toLowerCase();
}

function signTempToken(username) {
	return jwt.sign(
		{ purpose: 'empresa-select', sub: normalizarUsername(username) },
		JWT_SECRET,
		{ expiresIn: TEMP_TOKEN_EXPIRATION },
	);
}

function verifyTempToken(tempToken, username) {
	const decoded = jwt.verify(String(tempToken || ''), JWT_SECRET);
	if (decoded.purpose !== 'empresa-select') {
		const e = new Error('Token de paso inválido');
		e.statusCode = 401;
		throw e;
	}
	if (decoded.sub !== normalizarUsername(username)) {
		const e = new Error('Token de paso inválido');
		e.statusCode = 401;
		throw e;
	}
	return decoded;
}

const inicioSesion = async (req, res) => {
	const t0 = Date.now();
	const { username, password, idEmpresa, tempToken } = req.body;
	const ip = getClientIp(req);
	const userAgent = req.headers['user-agent'];

	try {
		if (!username?.trim() || !password) {
			return res.status(400).json({
				success: false,
				mensaje: 'Usuario y contraseña son obligatorios',
			});
		}

		let loginResult;
		if (tempToken && idEmpresa != null && idEmpresa !== '') {
			verifyTempToken(tempToken, username);
			loginResult = await tenantRegistry.resolverLogin(username, password, idEmpresa);
		} else {
			loginResult = await tenantRegistry.resolverLogin(username, password, null);
		}

		const usuario = loginResult.usuario;
		const idEmpresaSesion = loginResult.idEmpresa;

		const runComplete = async () =>
			authLoginFlow.completarLogin({
				res,
				username,
				usuario,
				idEmpresaSesion,
				idEmpresaBody: idEmpresa,
				ip,
				userAgent,
			});

		let payload;
		if (idEmpresaSesion != null) {
			payload = await runWithTenant(idEmpresaSesion, runComplete);
		} else {
			payload = await runComplete();
		}

		await authAudit.logEvent({
			ip,
			userAgent,
			username,
			evento: 'LOGIN_OK',
			resultado: 'OK',
			idEmpresa: payload.idEmpresa,
		});

		return res.json(payload);
	} catch (error) {
		if (error.message === 'MULTI_EMPRESA' || error.statusCode === 200) {
			const empresas = error.empresas || [];
			const temp = signTempToken(username);
			await authAudit.logEvent({
				ip,
				userAgent,
				username,
				evento: 'LOGIN_MULTI_EMPRESA',
				resultado: 'PASO',
			});
			return res.json({
				success: true,
				step: 'SELECT_EMPRESA',
				mensaje: 'Seleccione la empresa para continuar',
				tempToken: temp,
				empresas,
			});
		}

		if (error.statusCode === 403) {
			await authAudit.logEvent({
				ip,
				userAgent,
				username,
				evento: 'LOGIN_FAIL',
				resultado: 'DENEGADO',
				detalle: error.message,
			});
			return res.status(403).json({ success: false, mensaje: error.message });
		}

		if (error.statusCode === 400) {
			return res.status(400).json({ success: false, mensaje: error.message });
		}

		await authAudit.logEvent({
			ip,
			userAgent,
			username,
			evento: 'LOGIN_FAIL',
			resultado: 'FAIL',
		});

		if (error.statusCode === 401 || !error.statusCode) {
			return res.status(401).json({ success: false, mensaje: AUTH_FAIL_MESSAGE });
		}

		console.error('Error durante la autenticación:', error);
		return res.status(500).json({
			success: false,
			mensaje: 'Error en el servidor durante la autenticación',
		});
	} finally {
		await timingPad(t0);
	}
};

const cerrarSesion = async (req, res) => {
	try {
		const sessionId = req.auth?.sessionId;
		if (sessionId) await sessionService.revokeSession(sessionId);
		const refresh = req.cookies?.[sessionService.COOKIE_REFRESH];
		if (refresh) await sessionService.revokeByRefreshToken(refresh);
		sessionService.clearAuthCookies(res);
		await authAudit.logEvent({
			ip: getClientIp(req),
			userAgent: req.headers['user-agent'],
			username: req.auth?.usuario?.username,
			evento: 'LOGOUT',
			resultado: 'OK',
			idEmpresa: req.idEmpresa,
		});
		return res.json({ success: true, mensaje: 'Sesión cerrada' });
	} catch (e) {
		sessionService.clearAuthCookies(res);
		return res.json({ success: true, mensaje: 'Sesión cerrada' });
	}
};

const refrescarSesion = async (req, res) => {
	const t0 = Date.now();
	try {
		const refresh = req.cookies?.[sessionService.COOKIE_REFRESH];
		const access = req.cookies?.[sessionService.COOKIE_ACCESS];
		if (!refresh || !access) {
			return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
		}
		let decoded;
		try {
			decoded = jwt.verify(access, JWT_SECRET, { ignoreExpiration: true });
		} catch {
			return res.status(401).json({ success: false, mensaje: 'Sesión inválida' });
		}
		const rotated = await sessionService.rotateRefresh(decoded.sessionId, refresh);
		if (!rotated) {
			sessionService.clearAuthCookies(res);
			return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
		}
		const session = await sessionService.validateSession(decoded.sessionId);
		if (!session) {
			sessionService.clearAuthCookies(res);
			return res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
		}
		const newAccess = sessionService.signAccessToken({
			usuario: decoded.usuario,
			rol: decoded.rol,
			idEmpresa: decoded.idEmpresa,
			sessionId: decoded.sessionId,
		});
		sessionService.setAuthCookies(res, newAccess, rotated.refreshToken);
		return res.json({ success: true, mensaje: 'Sesión renovada' });
	} catch (e) {
		sessionService.clearAuthCookies(res);
		return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
	} finally {
		await timingPad(t0);
	}
};

const sesionActual = async (req, res) => {
	const usuario = req.auth?.usuario ? { ...req.auth.usuario } : null;
	if (usuario && req.valorPersonal != null && req.idEmpresa != null) {
		try {
			const { resolverMatriculaTenant } = require('../utils/matriculaTenant');
			const tenantMat = await resolverMatriculaTenant(req.valorPersonal);
			if (tenantMat) {
				usuario.matricula = tenantMat;
				req.matricula = tenantMat;
			}
		} catch {
			/* keep JWT matricula */
		}
	}
	return res.json({
		success: true,
		usuario,
		rol: req.auth?.rol || null,
		idEmpresa: req.idEmpresa ?? req.auth?.idEmpresa ?? null,
		idleTimeoutMinutes: await sessionService.getIdleTimeoutMinutes(req.idEmpresa),
	});
};

const obtenerSectores = async (req, res) => {
	try {
		const sectores = await authService.obtenerSectores();
		res.json({ success: true, data: sectores });
	} catch (error) {
		console.error('Error al obtener sectores:', error);
		res.status(500).json({ success: false, mensaje: 'Error al obtener los sectores' });
	}
};

/** Eliminado por seguridad: no revelar empresas sin autenticación previa. */
const obtenerSectoresPorUsuario = async (_req, res) => {
	res.status(410).json({
		success: false,
		mensaje: 'Endpoint deshabilitado. Autentíquese con usuario y contraseña.',
	});
};

const obtenerEmpresasPorUsuario = async (_req, res) => {
	res.status(410).json({
		success: false,
		mensaje: 'Endpoint deshabilitado. Autentíquese con usuario y contraseña.',
	});
};

const listarPaisesPermitidos = async (_req, res) => {
	try {
		const data = await geoPolicy.listarPaises();
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
};

const guardarPaisPermitido = async (req, res) => {
	try {
		const { codigoISO, nombre, activo } = req.body || {};
		const data = await geoPolicy.upsertPais(codigoISO, nombre, activo !== false);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 500).json({ success: false, mensaje: e.message });
	}
};

const togglePaisPermitido = async (req, res) => {
	try {
		const data = await geoPolicy.setPaisActivo(req.params.codigo, req.body?.activo !== false);
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
};

const obtenerConfigSeguridad = async (_req, res) => {
	try {
		const idleTimeoutMinutes = await sessionService.getIdleTimeoutMinutes();
		const paises = await geoPolicy.listarPaises();
		res.json({
			success: true,
			data: {
				idleTimeoutMinutes,
				paises,
				authCentral: authCentralService.isAuthCentralEnabled(),
			},
		});
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
};

const actualizarConfigSeguridad = async (req, res) => {
	try {
		const { idleTimeoutMinutes } = req.body || {};
		if (idleTimeoutMinutes != null && authCentralService.isAuthCentralEnabled()) {
			const pool = await require('../config/authCentralDb').getAuthCentralPool();
			const mins = Math.max(5, Math.min(480, Number(idleTimeoutMinutes)));
			await pool.query(
				`INSERT INTO imPlataformaConfig (Clave, Valor, FechaMod)
         VALUES ('SESSION_IDLE_MINUTES', ?, NOW())
         ON DUPLICATE KEY UPDATE Valor = VALUES(Valor), FechaMod = NOW()`,
				[String(mins)],
			);
		}
		res.json({ success: true, mensaje: 'Configuración actualizada' });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
};

module.exports = {
	inicioSesion,
	cerrarSesion,
	refrescarSesion,
	sesionActual,
	obtenerSectores,
	obtenerSectoresPorUsuario,
	obtenerEmpresasPorUsuario,
	listarPaisesPermitidos,
	guardarPaisPermitido,
	togglePaisPermitido,
	obtenerConfigSeguridad,
	actualizarConfigSeguridad,
};
