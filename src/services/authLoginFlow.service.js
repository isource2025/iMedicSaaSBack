/**
 * Flujo de login post-autenticación: empresa, sector automático, sesión y cookies.
 */
const authService = require('./auth.service');
const permisosService = require('./permisos.service');
const empresaService = require('./empresa.service');
const superAdminService = require('./superAdmin.service');
const sessionService = require('./session.service');
const { runWithTenant } = require('../context/tenantContext');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ACCESS_TOKEN_EXPIRATION } = require('../config/jwt');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

function resolverRol(userData) {
	if (userData.RolId != null) {
		return {
			id: Number(userData.RolId),
			nombre: String(userData.RolNombre || '').trim(),
			nivel: Number(userData.RolNivel || 0),
		};
	}
	if (Number(userData.Grupo) === 11) {
		return { id: 1, nombre: 'ADMIN', nivel: 100 };
	}
	return null;
}

function buildJwtPayload(userData, idEmpresa, rol) {
	const matricula =
		userData.Matricula != null && Number(userData.Matricula) > 0
			? Number(userData.Matricula)
			: null;
	return {
		usuario: {
			id: userData.ValorPersonal,
			username: userData.NombreRed || userData.Nombrered || userData.nombrered,
			nombre: userData.Nombres,
			apellido: userData.Apellido,
			codOperador: userData.CodOperador,
			matricula,
		},
		rol,
		idEmpresa:
			idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
				? Number(idEmpresa)
				: null,
	};
}

async function resolverSectorAutomatico(username, idEmpresaSesion, usuario, esSuperAdmin) {
	if (esSuperAdmin || authService.eximeSeleccionSectorPorUsuario(usuario)) {
		return {
			idPersonal: usuario.ValorPersonal,
			idSector: '',
			descripcion: esSuperAdmin ? 'Plataforma' : 'Administración',
		};
	}
	const sectores = await authService.obtenerSectoresPorUsuarioConTenant(username, idEmpresaSesion);
	if (sectores.length >= 1) {
		const s = sectores[0];
		return {
			idPersonal: s.idPersonal,
			idSector: s.idSector,
			descripcion: s.descripcionSector || 'Sector',
		};
	}
	return {
		idPersonal: usuario.ValorPersonal,
		idSector: '',
		descripcion: '',
	};
}

async function completarLogin({
	res,
	username,
	usuario,
	idEmpresaSesion,
	idEmpresaBody,
	ip,
	userAgent,
}) {
	const rolPreliminar = resolverRol(usuario);
	let esSuperAdmin =
		rolPreliminar?.nombre === 'SUPER_ADMIN' || Number(rolPreliminar?.id) === 5;
	if (!esSuperAdmin && idEmpresaSesion == null) {
		try {
			esSuperAdmin = await authService.esSuperAdminPorUsername(username);
		} catch (e) {
			console.warn('[auth.login] esSuperAdminPorUsername:', e.message);
		}
	}

	const sectorInfo = await resolverSectorAutomatico(
		username,
		idEmpresaSesion,
		usuario,
		esSuperAdmin,
	);

	let empresaSeleccionada = null;
	let modulosEmpresa = null;
	let idEmpresaEfectiva = idEmpresaSesion;
	let empresasUsuario = [];

	try {
		empresasUsuario = esSuperAdmin
			? await authService.obtenerTodasEmpresas()
			: await authService.obtenerEmpresasPorUsuario(username, idEmpresaSesion);

		idEmpresaEfectiva = await authService.resolverIdEmpresaLogin({
			idEmpresaSesion,
			idEmpresaBody,
			empresasUsuario,
			esSuperAdmin,
		});

		if (
			!esSuperAdmin &&
			empresasUsuario.length > 1 &&
			(!idEmpresaEfectiva || !Number.isFinite(idEmpresaEfectiva))
		) {
			const e = new Error('MULTI_EMPRESA');
			e.statusCode = 200;
			e.empresas = empresasUsuario.map((x) => ({
				idEmpresa: x.idEmpresa,
				descripcionEmpresa: x.descripcionEmpresa || x.descripcion,
			}));
			throw e;
		}

		if (idEmpresaEfectiva && Number.isFinite(idEmpresaEfectiva)) {
			const permitida =
				esSuperAdmin ||
				empresasUsuario.length === 0 ||
				empresasUsuario.some((e) => Number(e.idEmpresa) === idEmpresaEfectiva);
			if (empresasUsuario.length > 0 && !permitida) {
				const err = new Error('La empresa seleccionada no está asociada a su usuario');
				err.statusCode = 403;
				throw err;
			}
			const cargarEmpresaTenant = async () => {
				empresaSeleccionada = await empresaService.obtenerInfoEmpresaPorId(idEmpresaEfectiva);
				modulosEmpresa = await superAdminService.obtenerModulosEmpresaActiva(idEmpresaEfectiva);
			};
			if (idEmpresaSesion != null) {
				await cargarEmpresaTenant();
			} else {
				await runWithTenant(idEmpresaEfectiva, cargarEmpresaTenant);
			}
		}
	} catch (empErr) {
		if (empErr.message === 'MULTI_EMPRESA') throw empErr;
		console.error('[auth.login] Error al resolver empresa:', empErr.message);
	}

	if (idEmpresaEfectiva == null) {
		idEmpresaEfectiva = await authService.resolverIdEmpresaLogin({
			idEmpresaSesion,
			idEmpresaBody,
			empresasUsuario,
			esSuperAdmin,
		});
	}

	if (
		!esSuperAdmin &&
		idEmpresaSesion != null &&
		Number.isFinite(Number(idEmpresaSesion)) &&
		Number(idEmpresaSesion) > 0
	) {
		idEmpresaEfectiva = Number(idEmpresaSesion);
	}

	const rol = rolPreliminar;

	// Matricula del JWT debe coincidir con imPersonal del tenant (horarios/agenda).
	if (
		idEmpresaEfectiva != null &&
		Number.isFinite(Number(idEmpresaEfectiva)) &&
		usuario?.ValorPersonal != null
	) {
		try {
			const { resolverMatriculaTenant } = require('../utils/matriculaTenant');
			const tenantMat = await runWithTenant(Number(idEmpresaEfectiva), () =>
				resolverMatriculaTenant(usuario.ValorPersonal),
			);
			if (tenantMat) {
				usuario.Matricula = tenantMat;
			}
		} catch (e) {
			console.warn('[auth.login] Matricula tenant:', e.message);
		}
	}

	const jwtPayload = buildJwtPayload(usuario, idEmpresaEfectiva, rol);

	let token = null;
	if (isAuthCentralEnabled()) {
		const { accessToken, refreshToken } = await sessionService.createSession({
			valorPersonal: usuario.ValorPersonal,
			username,
			idEmpresa: idEmpresaEfectiva,
			ip,
			userAgent,
			jwtPayload,
		});
		sessionService.setAuthCookies(res, accessToken, refreshToken);
		token = accessToken;
	} else {
		token = jwt.sign({ ...jwtPayload, sessionId: null }, JWT_SECRET, {
			expiresIn: ACCESS_TOKEN_EXPIRATION,
		});
	}

	let permisos = [];
	try {
		const cargarPermisos = async () => {
			if (idEmpresaEfectiva != null && Number.isFinite(Number(idEmpresaEfectiva))) {
				const r = await permisosService.permisosDeUsuario(usuario.ValorPersonal);
				if (r?.permisos?.length) return r.permisos;
			}
			if (rol?.id != null) {
				return permisosService.permisosDeRol(rol.id, rol.nombre);
			}
			return [];
		};
		if (idEmpresaEfectiva != null && Number.isFinite(Number(idEmpresaEfectiva))) {
			permisos = await runWithTenant(Number(idEmpresaEfectiva), cargarPermisos);
		} else {
			permisos = await cargarPermisos();
		}
	} catch (e) {
		console.error('[auth.login] Error al cargar permisos:', e.message);
	}

	return {
		success: true,
		step: 'COMPLETE',
		mensaje: 'Inicio de sesión exitoso',
		usuario: {
			idCodOperador: usuario.CodOperador,
			idValorpersonal: usuario.ValorPersonal,
			matricula:
				usuario.Matricula != null && Number(usuario.Matricula) > 0
					? Number(usuario.Matricula)
					: null,
			nombre: usuario.Nombres,
			apellido: usuario.Apellido,
			nombreRed:
				usuario.Nombrered ||
				usuario.nombrered ||
				usuario.NombreRed ||
				String(username || '').trim() ||
				null,
		},
		rol,
		permisos,
		idEmpresa: idEmpresaEfectiva,
		sectorSeleccionado: {
			idPersonal: sectorInfo.idPersonal,
			idSector: sectorInfo.idSector || '',
			descripcion: sectorInfo.descripcion || '',
		},
		empresaSeleccionada,
		modulosEmpresa,
		token,
		fuente: 'db',
	};
}

module.exports = {
	resolverRol,
	completarLogin,
};
