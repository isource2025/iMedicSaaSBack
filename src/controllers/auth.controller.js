const jwt = require('jsonwebtoken');
const authService = require('../services/auth.service');
const tenantRegistry = require('../services/tenantRegistry.service');
const authLoginFlow = require('../services/authLoginFlow.service');
const authAudit = require('../services/authAudit.service');
const sessionService = require('../services/session.service');
const geoPolicy = require('../services/geoPolicy.service');
const analyticsService = require('../services/analytics.service');
const { extractTokenFromRequest } = require('../middlewares/authJwt.middleware');
const { runWithTenant } = require('../context/tenantContext');
const { JWT_SECRET, TEMP_TOKEN_EXPIRATION } = require('../config/jwt');
const {
	AUTH_FAIL_MESSAGE,
	timingPad,
	getClientIp,
} = require('../config/security');
const authCentralService = require('../services/authCentral.service');
const { dedupeEmpresasPorId } = require('../utils/authEmpresas');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

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
	const { username, password, idEmpresa, tempToken, idSector } = req.body;
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
				idSectorBody: idSector,
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

		try {
			let sessionId = null;
			if (payload.token) {
				const decodedTok = jwt.decode(payload.token);
				sessionId = decodedTok?.sessionId || null;
			}
			await analyticsService.trackEvent({
				eventType: analyticsService.EVENT_TYPES.LOGIN,
				sessionId,
				valorPersonal: payload.usuario?.idValorpersonal,
				idEmpresa: payload.idEmpresa,
				role: payload.rol?.nombre,
				userAgent,
				metadata: { source: 'server' },
			});
			await analyticsService.trackReauthIfExpired({
				valorPersonal: payload.usuario?.idValorpersonal,
				sessionId,
				idEmpresa: payload.idEmpresa,
				role: payload.rol?.nombre,
				userAgent,
			});
		} catch {
			/* analytics no debe bloquear el login */
		}

		return res.json(payload);
	} catch (error) {
		if (error.message === 'MULTI_EMPRESA') {
			const empresas = dedupeEmpresasPorId(error.empresas || []);
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

		if (error.message === 'MULTI_SECTOR') {
			const temp = signTempToken(username);
			const idEmpresaPaso =
				error.idEmpresa != null && Number.isFinite(Number(error.idEmpresa))
					? Number(error.idEmpresa)
					: idEmpresa != null && idEmpresa !== '' && Number.isFinite(Number(idEmpresa))
						? Number(idEmpresa)
						: undefined;
			await authAudit.logEvent({
				ip,
				userAgent,
				username,
				evento: 'LOGIN_MULTI_SECTOR',
				resultado: 'PASO',
				idEmpresa: idEmpresaPaso,
			});
			return res.json({
				success: true,
				step: 'SELECT_SECTOR',
				mensaje: 'Seleccione el sector para continuar',
				tempToken: temp,
				sectores: error.sectores || [],
				idEmpresa: idEmpresaPaso ?? null,
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
		return res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error en el servidor durante la autenticación'),
		});
	} finally {
		await timingPad(t0);
	}
};

const cerrarSesion = async (req, res) => {
	try {
		let decoded = req.auth || null;
		if (!decoded) {
			const token = extractTokenFromRequest(req);
			if (token) {
				try {
					decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
				} catch {
					decoded = null;
				}
			}
		}
		const sessionId = decoded?.sessionId || null;
		if (sessionId) await sessionService.revokeSession(sessionId);
		const refresh = req.cookies?.[sessionService.COOKIE_REFRESH];
		if (refresh) await sessionService.revokeByRefreshToken(refresh);
		sessionService.clearAuthCookies(res);
		await authAudit.logEvent({
			ip: getClientIp(req),
			userAgent: req.headers['user-agent'],
			username: decoded?.usuario?.username || req.auth?.usuario?.username,
			evento: 'LOGOUT',
			resultado: 'OK',
			idEmpresa: decoded?.idEmpresa ?? req.idEmpresa,
		});
		try {
			const u = decoded?.usuario || {};
			const vp = Number(u.id || u.idValorpersonal || u.valorPersonal);
			await analyticsService.trackEvent({
				eventType: analyticsService.EVENT_TYPES.LOGOUT,
				sessionId,
				valorPersonal: Number.isFinite(vp) && vp > 0 ? vp : null,
				idEmpresa: decoded?.idEmpresa ?? req.idEmpresa,
				role: decoded?.rol?.nombre,
				userAgent: req.headers['user-agent'],
				metadata: { source: 'server' },
			});
		} catch {
			/* ignore */
		}
		return res.json({ success: true, mensaje: 'Sesión cerrada' });
	} catch (e) {
		sessionService.clearAuthCookies(res);
		return res.json({ success: true, mensaje: 'Sesión cerrada' });
	}
};

/** Fuerza el mismo 401 de inactividad que el timeout real (para probar modal + analytics). */
const simularInactividad = async (req, res) => {
	try {
		const sessionId = req.auth?.sessionId || null;
		const session = sessionId ? await sessionService.getSessionAny(sessionId) : null;
		if (sessionId) await sessionService.revokeSession(sessionId);
		const refresh = req.cookies?.[sessionService.COOKIE_REFRESH];
		if (refresh) await sessionService.revokeByRefreshToken(refresh);
		await analyticsService.trackIdleExpiration({
			decoded: req.auth,
			session,
			userAgent: req.headers['user-agent'],
			metadata: { simulated: true },
		});
		sessionService.clearAuthCookies(res);
		return res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
	} catch (e) {
		sessionService.clearAuthCookies(res);
		return res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
	}
};

const refrescarSesion = async (req, res) => {
	const t0 = Date.now();
	try {
		const refresh = req.cookies?.[sessionService.COOKIE_REFRESH];
		let access = req.cookies?.[sessionService.COOKIE_ACCESS];
		// Fallback: SPA cross-origin puede mandar Bearer aunque la cookie access no viaje.
		if (!access) {
			const h = req.headers.authorization;
			if (h && typeof h === 'string' && h.startsWith('Bearer ')) {
				access = h.slice(7).trim() || null;
			}
		}
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
			// Carrera entre pestañas: otra ya rotó el refresh. Si la sesión sigue viva, re-firmar access.
			const still = decoded.sessionId
				? await sessionService.getSession(decoded.sessionId)
				: null;
			if (still) {
				const idleMinutes = await sessionService.getIdleTimeoutMinutes(still.IdEmpresa);
				const idleMs = idleMinutes * 60 * 1000;
				const last = new Date(still.LastActivityAt).getTime();
				if (Date.now() - last <= idleMs && new Date(still.ExpiresAt).getTime() > Date.now()) {
					await sessionService.touchSession(decoded.sessionId);
					const newAccess = sessionService.signAccessToken({
						usuario: decoded.usuario,
						rol: decoded.rol,
						idEmpresa: decoded.idEmpresa,
						idSector: decoded.idSector || '',
						sectores: decoded.sectores || [],
						sessionId: decoded.sessionId,
					});
					sessionService.setAccessCookie(res, newAccess);
					return res.json({ success: true, mensaje: 'Sesión renovada' });
				}
			}
			sessionService.clearAuthCookies(res);
			return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
		}
		const session = await sessionService.evaluateSession(decoded.sessionId);
		if (!session.ok) {
			sessionService.clearAuthCookies(res);
			if (session.reason === 'idle') {
				try {
					await analyticsService.trackIdleExpiration({
						decoded,
						session: session.session,
						userAgent: req.headers['user-agent'],
					});
				} catch {
					/* ignore */
				}
				return res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
			}
			return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
		}
		const newAccess = sessionService.signAccessToken({
			usuario: decoded.usuario,
			rol: decoded.rol,
			idEmpresa: decoded.idEmpresa,
			idSector: decoded.idSector || '',
			sectores: decoded.sectores || [],
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
	const idEmpresa = req.idEmpresa ?? req.auth?.idEmpresa ?? null;
	let modulosEmpresa = null;
	if (idEmpresa != null && Number(idEmpresa) > 0) {
		try {
			const superAdminService = require('../services/superAdmin.service');
			modulosEmpresa = await superAdminService.obtenerModulosEmpresaActiva(Number(idEmpresa));
		} catch (e) {
			console.warn('[auth.me] modulosEmpresa:', e.message);
		}
	}
	return res.json({
		success: true,
		usuario,
		rol: req.auth?.rol || null,
		idEmpresa,
		idSector: req.idSector || req.auth?.idSector || '',
		sectores: req.sectores || [],
		modulosEmpresa,
		idleTimeoutMinutes: await sessionService.getIdleTimeoutMinutes(req.idEmpresa),
	});
};

const obtenerSectores = async (req, res) => {
	try {
		const sectores = await authService.obtenerSectores();
		res.json({ success: true, data: sectores });
	} catch (error) {
		console.error('Error al obtener sectores:', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: 'Error al obtener los sectores' });
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
		res.status(statusDeError(e)).json({ success: false, mensaje: e.message });
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
		res.status(statusDeError(e)).json({ success: false, mensaje: e.message });
	}
};

const obtenerConfigSeguridad = async (_req, res) => {
	try {
		const idleTimeoutMinutes = await sessionService.getIdleTimeoutMinutes();
		const paises = await geoPolicy.listarPaises();
		const geoBlockEnabled = await geoPolicy.isGeoBlockEnabled();
		res.json({
			success: true,
			data: {
				idleTimeoutMinutes,
				paises,
				geoBlockEnabled,
				authCentral: authCentralService.isAuthCentralEnabled(),
			},
		});
	} catch (e) {
		res.status(statusDeError(e)).json({ success: false, mensaje: e.message });
	}
};

const actualizarConfigSeguridad = async (req, res) => {
	try {
		const { idleTimeoutMinutes, geoBlockEnabled } = req.body || {};
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
		if (geoBlockEnabled !== undefined) {
			await geoPolicy.setGeoBlockEnabled(Boolean(geoBlockEnabled));
		}
		res.json({
			success: true,
			mensaje: 'Configuración actualizada',
			data: {
				geoBlockEnabled: await geoPolicy.isGeoBlockEnabled(),
			},
		});
	} catch (e) {
		res.status(statusDeError(e)).json({ success: false, mensaje: e.message });
	}
};

/**
 * Reparación one-shot: superadmin + adminvidal en MySQL.
 * Body: { "key": "imedic-repair-2026-08" }
 */
const repararCuentasCriticas = async (req, res) => {
	try {
		const ensure = require('../services/ensureSuperAdmin.service');
		const key = req.body?.key || req.headers['x-imedic-repair'];
		if (!ensure.isValidRepairKey(key)) {
			return res.status(403).json({ success: false, mensaje: 'Clave de reparación inválida' });
		}
		const data = await ensure.ensureSuperAdmin();
		return res.json({ success: true, data });
	} catch (e) {
		console.error('[auth.repararCuentasCriticas]', e.message);
		return res.status(statusDeError(e)).json({ success: false, mensaje: e.message });
	}
};

module.exports = {
	inicioSesion,
	cerrarSesion,
	simularInactividad,
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
	repararCuentasCriticas,
};
