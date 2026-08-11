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
	const { isReservedUsername, PLATFORM_EMPRESA_ID } = require('../config/tenantIdentity');
	const u = String(
		userData.NombreRed || userData.Nombrered || userData.nombrered || '',
	)
		.trim()
		.toLowerCase();
	const idEmp = Number(userData.IdEmpresa);
	const esPlataforma =
		idEmp === PLATFORM_EMPRESA_ID || isReservedUsername(u);

	// Plataforma: Rol SUPER_ADMIN desde join o Grupo 11 con usuario de plataforma
	const rolNombre = String(userData.RolNombre || '').trim().toUpperCase();
	if (userData.RolId != null || rolNombre) {
		const id =
			userData.RolId != null
				? Number(userData.RolId)
				: rolNombre === 'SUPER_ADMIN'
					? 5
					: rolNombre === 'ADMIN'
						? 1
						: 0;
		const nombre = rolNombre || String(userData.RolNombre || '').trim();
		// RolId sin nombre útil: no cortar el fallback de Grupo 11
		if (nombre) {
			return {
				id: id || Number(userData.RolId) || 0,
				nombre,
				nivel: Number(
					userData.RolNivel ||
						(nombre === 'SUPER_ADMIN' ? 200 : nombre === 'ADMIN' ? 100 : 0),
				),
			};
		}
	}

	// imPersonal.Rol numérico sin join (roles desalineados)
	const personalRol = String(userData.PersonalRol || '').trim();
	if (personalRol === '5' || personalRol.toUpperCase() === 'SUPER_ADMIN') {
		return { id: 5, nombre: 'SUPER_ADMIN', nivel: 200 };
	}
	if (personalRol === '1' || personalRol.toUpperCase() === 'ADMIN') {
		return { id: 1, nombre: 'ADMIN', nivel: 100 };
	}

	if (Number(userData.Grupo) === 11) {
		if (esPlataforma) {
			return { id: 5, nombre: 'SUPER_ADMIN', nivel: 200 };
		}
		return { id: 1, nombre: 'ADMIN', nivel: 100 };
	}

	// Cuentas hospital “admin*” de provisión (adminvidal, etc.) → ADMIN
	if (/^admin[a-z0-9._-]*$/i.test(u) && !esPlataforma) {
		return { id: 1, nombre: 'ADMIN', nivel: 100 };
	}

	return null;
}

function buildDisplayName(usuario, username) {
	let nombre = String(usuario?.Nombres || '').trim();
	let apellido = String(usuario?.Apellido || '').trim();
	if (/^\d+$/.test(nombre)) nombre = '';
	if (/^\d+$/.test(apellido)) apellido = '';
	const full = [nombre, apellido].filter(Boolean).join(' ').trim();
	if (full) return { nombre, apellido, full };
	const red = String(
		usuario?.NombreRed ||
			usuario?.Nombrered ||
			usuario?.nombrered ||
			username ||
			'',
	).trim();
	return { nombre: red || 'Usuario', apellido: '', full: red || 'Usuario' };
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
	// Propagar al usuario para exención de sector y permisos (Grupo 11 / admin*)
	if (rolPreliminar) {
		if (!usuario.RolNombre) usuario.RolNombre = rolPreliminar.nombre;
		if (usuario.RolId == null) usuario.RolId = rolPreliminar.id;
		if (usuario.RolNivel == null) usuario.RolNivel = rolPreliminar.nivel;
	}
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

	let rol = rolPreliminar;

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
	let roles = [];
	try {
		const cargarPermisos = async () => {
			if (idEmpresaEfectiva != null && Number.isFinite(Number(idEmpresaEfectiva))) {
				const r = await permisosService.permisosDeUsuario(usuario.ValorPersonal);
				if (r?.permisos?.length || r?.roles?.length) return r;
			}
			if (rolPreliminar?.id != null) {
				const p = await permisosService.permisosDeRol(rolPreliminar.id, rolPreliminar.nombre);
				return {
					rol: rolPreliminar,
					roles: [{ ...rolPreliminar, esPrincipal: true }],
					permisos: p,
				};
			}
			return { rol: null, roles: [], permisos: [] };
		};
		let pack;
		if (idEmpresaEfectiva != null && Number.isFinite(Number(idEmpresaEfectiva))) {
			pack = await runWithTenant(Number(idEmpresaEfectiva), cargarPermisos);
		} else {
			pack = await cargarPermisos();
		}
		permisos = pack?.permisos || [];
		roles = pack?.roles || [];
		if (pack?.rol) {
			rol = {
				id: pack.rol.id,
				nombre: pack.rol.nombre,
				nivel: pack.rol.nivel ?? rolPreliminar?.nivel ?? 0,
			};
		}
	} catch (e) {
		console.error('[auth.login] Error al cargar permisos:', e.message);
	}

	return {
		success: true,
		step: 'COMPLETE',
		mensaje: 'Inicio de sesión exitoso',
		usuario: (() => {
			const display = buildDisplayName(usuario, username);
			return {
				idCodOperador: usuario.CodOperador,
				idValorpersonal: usuario.ValorPersonal,
				matricula:
					usuario.Matricula != null && Number(usuario.Matricula) > 0
						? Number(usuario.Matricula)
						: null,
				nombre: display.nombre,
				apellido: display.apellido,
				nombreRed:
					usuario.Nombrered ||
					usuario.nombrered ||
					usuario.NombreRed ||
					String(username || '').trim() ||
					null,
			};
		})(),
		rol,
		roles,
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
