/**
 * Roles personalizados por empresa (auth central, MySQL en Railway).
 *
 * - Los roles del sistema (IdRol 1..999, IdEmpresa = 0) son de solo lectura.
 * - Los roles personalizados (IdRol >= 1000) pertenecen a UNA empresa y guardan
 *   sus permisos como códigos en `imRolPermisosCustom`.
 * - Toda modificación queda en `imRolesAuditoria`.
 *
 * Los errores esperables llevan `statusCode` (400/403/404/409/503).
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const matriz = require('../utils/permisos');
const { esPermisoRestringido } = require('../utils/permisosDescripciones');
const v = require('../utils/rolesValidacion');
const schema = require('./rolesCustomSchema.service');

const CACHE_TTL_MS = 30 * 1000;
const MAX_ROLES_POR_EMPRESA = 50;
const NIVEL_POR_BASE = { NINGUNO: 10, ADMINISTRATIVO: 20, CARGA_HC: 25, ENFERMERO: 40, MEDICO: 50 };
const BASE_DE_ROL_SISTEMA = {
	MEDICO: 'MEDICO',
	ENFERMERO: 'ENFERMERO',
	ADMINISTRATIVO: 'ADMINISTRATIVO',
	CARGA_HC: 'CARGA_HC',
};

const cache = new Map(); // idRol -> { permisos, expira }

function error(statusCode, mensaje) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

function habilitado() {
	return isAuthCentralEnabled() && String(process.env.ROLES_PERSONALIZADOS_ENABLED || '').toLowerCase() !== 'false';
}

function exigirHabilitado() {
	if (!isAuthCentralEnabled()) {
		throw error(409, 'Los roles personalizados requieren la autenticación central');
	}
	if (!habilitado()) throw error(503, 'Los roles personalizados están deshabilitados');
}

async function consultar(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

function invalidarCache(idRol) {
	if (idRol == null) cache.clear();
	else cache.delete(Number(idRol));
}

const codigosValidos = () => new Set(matriz.todosLosCodigos().map((c) => c.codigo));

// ─── Lectura de permisos (usado por permisos.service) ───────────────────────

/**
 * Permisos vigentes de un rol personalizado. Descarta códigos que ya no existen
 * en el catálogo o que son restringidos. Caché corta (30 s).
 */
async function permisosDeRolCustom(idRol) {
	const id = Number(idRol);
	const hit = cache.get(id);
	if (hit && hit.expira > Date.now()) return [...hit.permisos];
	if (!(await schema.esquemaListo())) return [];

	const rows = await consultar(
		`SELECT rp.Codigo AS codigo
     FROM imRolPermisosCustom rp
     INNER JOIN imRoles r ON r.IdRol = rp.IdRol AND r.Activo = 1
     WHERE rp.IdRol = ?`,
		[id],
	);
	const validos = codigosValidos();
	const permisos = rows
		.map((r) => String(r.codigo || ''))
		.filter((c) => validos.has(c) && !esPermisoRestringido(c));
	cache.set(id, { permisos, expira: Date.now() + CACHE_TTL_MS });
	return [...permisos];
}

// ─── Auditoría ──────────────────────────────────────────────────────────────

async function registrarAuditoria(conn, { idEmpresa, idRol, accion, actor, detalle }) {
	const sql = `INSERT INTO imRolesAuditoria (IdEmpresa, IdRol, Accion, Actor, Fecha, Detalle)
               VALUES (?, ?, ?, ?, NOW(), ?)`;
	const params = [
		Number(idEmpresa),
		idRol == null ? null : Number(idRol),
		accion,
		actor == null ? null : Number(actor),
		detalle == null ? null : JSON.stringify(detalle),
	];
	if (conn) await conn.query(sql, params);
	else await consultar(sql, params);
}

/** Auditoría de una asignación de roles a una persona (no falla si no hay esquema). */
async function registrarAsignacion({ idEmpresa, actor, valorPersonal, antes, despues }) {
	try {
		if (!(await schema.esquemaListo())) return;
		await registrarAuditoria(null, {
			idEmpresa,
			idRol: null,
			accion: 'ASIGNAR_ROLES',
			actor,
			detalle: { valorPersonal: Number(valorPersonal), antes, despues },
		});
	} catch (e) {
		console.warn('[rolesCustom] auditoría de asignación:', e.message);
	}
}

// ─── Consultas ──────────────────────────────────────────────────────────────

async function contarUsuariosPorRol(idEmpresa) {
	const conteo = new Map();
	try {
		const rows = await consultar(
			`SELECT IdRol AS idRol, COUNT(*) AS n FROM imPersonalRoles WHERE IdEmpresa = ? GROUP BY IdRol`,
			[Number(idEmpresa)],
		);
		for (const r of rows) conteo.set(Number(r.idRol), Number(r.n));
	} catch (e) {
		console.warn('[rolesCustom] contar usuarios:', e.message);
	}
	return conteo;
}

/** Roles del sistema + personalizados de la empresa, con sus permisos. */
async function listarMatriz(idEmpresa) {
	if (!isAuthCentralEnabled()) {
		return { soportaPersonalizados: false, esquemaListo: false, sistema: [], personalizados: [] };
	}
	const listo = await schema.esquemaListo();
	const filtroSistema = listo ? 'AND IdEmpresa = 0' : '';
	const filas = await consultar(
		`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel
     FROM imRoles
     WHERE Activo = 1 AND UPPER(TRIM(Nombre)) <> 'SUPER_ADMIN' ${filtroSistema}
     ORDER BY Nivel DESC, Nombre ASC`,
	);
	const usuarios = await contarUsuariosPorRol(idEmpresa);

	const sistema = filas.map((r) => {
		const nombre = String(r.nombre || '').trim().toUpperCase();
		return {
			idRol: Number(r.idRol),
			nombre: String(r.nombre || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			nivel: Number(r.nivel ?? 0),
			esSistema: true,
			editable: false,
			rolBase: BASE_DE_ROL_SISTEMA[nombre] || (nombre === 'ADMIN' ? null : 'NINGUNO'),
			permisos: [...matriz.permisosDeRol(nombre)],
			usuarios: usuarios.get(Number(r.idRol)) || 0,
		};
	});

	let personalizados = [];
	if (listo) {
		const roles = await consultar(
			`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel,
              RolBase AS rolBase, FechaCreacion AS fechaCreacion, FechaModificacion AS fechaModificacion
       FROM imRoles
       WHERE Activo = 1 AND IdEmpresa = ?
       ORDER BY Nombre ASC`,
			[Number(idEmpresa)],
		);
		const ids = roles.map((r) => Number(r.idRol));
		const permisosPorRol = new Map(ids.map((id) => [id, []]));
		if (ids.length) {
			const filasPermisos = await consultar(
				`SELECT IdRol AS idRol, Codigo AS codigo FROM imRolPermisosCustom WHERE IdRol IN (?)`,
				[ids],
			);
			const validos = codigosValidos();
			for (const p of filasPermisos) {
				const c = String(p.codigo || '');
				if (validos.has(c) && !esPermisoRestringido(c)) permisosPorRol.get(Number(p.idRol))?.push(c);
			}
		}
		personalizados = roles.map((r) => ({
			idRol: Number(r.idRol),
			nombre: String(r.nombre || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			nivel: Number(r.nivel ?? 0),
			esSistema: false,
			editable: true,
			rolBase: r.rolBase || 'NINGUNO',
			permisos: permisosPorRol.get(Number(r.idRol)) || [],
			usuarios: usuarios.get(Number(r.idRol)) || 0,
			fechaCreacion: r.fechaCreacion || null,
			fechaModificacion: r.fechaModificacion || null,
		}));
	}

	return {
		soportaPersonalizados: habilitado(),
		esquemaListo: listo,
		sistema,
		personalizados,
	};
}

/** Devuelve un rol personalizado de la empresa o lanza 403/404. */
async function obtenerRolPropio(idRol, idEmpresa) {
	const id = Number(idRol);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Id de rol inválido');
	if (id < v.ID_ROL_PERSONALIZADO_MIN) {
		throw error(403, 'Los roles del sistema no se pueden modificar. Duplicalo para crear uno propio.');
	}
	if (!(await schema.esquemaListo())) throw error(404, 'Rol no encontrado');
	const rows = await consultar(
		`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, RolBase AS rolBase, Nivel AS nivel
     FROM imRoles WHERE IdRol = ? AND IdEmpresa = ? AND Activo = 1 LIMIT 1`,
		[id, Number(idEmpresa)],
	);
	if (!rows.length) throw error(404, 'Rol no encontrado');
	const permisos = await permisosActualesSinCache(id);
	return { ...rows[0], idRol: id, permisos };
}

async function permisosActualesSinCache(idRol) {
	const rows = await consultar(`SELECT Codigo AS codigo FROM imRolPermisosCustom WHERE IdRol = ?`, [Number(idRol)]);
	return rows.map((r) => String(r.codigo));
}

async function insertarPermisos(conn, idRol, permisos) {
	if (!permisos.length) return;
	await conn.query(`INSERT INTO imRolPermisosCustom (IdRol, Codigo) VALUES ?`, [
		permisos.map((c) => [Number(idRol), c]),
	]);
}

function permisosNoOtorgables(nuevos, previos, permisosActor) {
	if (!permisosActor) return [];
	const actor = new Set(permisosActor);
	const ya = new Set(previos);
	return nuevos.filter((c) => !ya.has(c) && !actor.has(c));
}

function mapearErrorSql(e) {
	if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
		return error(409, 'Ya existe un rol con ese nombre en la clínica');
	}
	return e;
}

// ─── Alta ───────────────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {number} p.idEmpresa
 * @param {{ valorPersonal: number, permisos: string[] }} p.actor
 * @param {string} p.nombre
 * @param {string} [p.descripcion]
 * @param {string} [p.rolBase]
 * @param {string[]} [p.permisos]
 * @param {object} [p.origen] datos del rol duplicado (para la auditoría)
 */
async function crearRol({ idEmpresa, actor, nombre, descripcion, rolBase, permisos, origen }) {
	exigirHabilitado();
	if (!Number.isFinite(Number(idEmpresa)) || Number(idEmpresa) <= 0) throw error(400, 'Empresa inválida');

	const n = v.validarNombre(nombre);
	if (!n.ok) throw error(400, n.error);
	const d = v.validarDescripcion(descripcion);
	if (!d.ok) throw error(400, d.error);
	const b = v.validarRolBase(rolBase);
	if (!b.ok) throw error(400, b.error);
	const perm = v.normalizarPermisos(permisos || [], { permisosActor: actor?.permisos });
	if (!perm.ok) throw error(400, perm.errores.join('. '));

	await schema.asegurarEsquema();

	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	let bloqueado = false;
	try {
		const [[lock]] = await conn.query(`SELECT GET_LOCK('imRoles_alta', 10) AS ok`);
		if (!Number(lock.ok)) throw error(503, 'Hay otra alta de rol en curso, reintentá en unos segundos');
		bloqueado = true;

		await conn.beginTransaction();

		const [[cant]] = await conn.query(
			`SELECT COUNT(*) AS n FROM imRoles WHERE IdEmpresa = ? AND Activo = 1`,
			[Number(idEmpresa)],
		);
		if (Number(cant.n) >= MAX_ROLES_POR_EMPRESA) {
			throw error(409, `Se alcanzó el máximo de ${MAX_ROLES_POR_EMPRESA} roles personalizados`);
		}
		const [dup] = await conn.query(
			`SELECT IdRol FROM imRoles WHERE IdEmpresa IN (0, ?) AND Nombre = ? LIMIT 1`,
			[Number(idEmpresa), n.nombre],
		);
		if (dup.length) throw error(409, 'Ya existe un rol con ese nombre');

		const [[mx]] = await conn.query(`SELECT COALESCE(MAX(IdRol), 0) AS m FROM imRoles`);
		const idRol = Math.max(Number(mx.m) + 1, v.ID_ROL_PERSONALIZADO_MIN);

		await conn.query(
			`INSERT INTO imRoles
         (IdRol, Nombre, Descripcion, Nivel, Activo, IdEmpresa, RolBase, CreadoPor, FechaCreacion, FechaModificacion)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, NOW(), NOW())`,
			[
				idRol,
				n.nombre,
				d.descripcion || null,
				NIVEL_POR_BASE[b.rolBase] ?? 10,
				Number(idEmpresa),
				b.rolBase,
				actor?.valorPersonal ?? null,
			],
		);
		await insertarPermisos(conn, idRol, perm.permisos);
		await registrarAuditoria(conn, {
			idEmpresa,
			idRol,
			accion: origen ? 'DUPLICAR' : 'CREAR',
			actor: actor?.valorPersonal,
			detalle: { nombre: n.nombre, rolBase: b.rolBase, permisos: perm.permisos, origen: origen || null },
		});

		await conn.commit();
		invalidarCache(idRol);
		return { idRol, nombre: n.nombre, descripcion: d.descripcion, rolBase: b.rolBase, permisos: perm.permisos, agregadosAuto: perm.agregados };
	} catch (e) {
		try { await conn.rollback(); } catch (_) { /* ya cerrada */ }
		throw mapearErrorSql(e);
	} finally {
		if (bloqueado) {
			try { await conn.query(`SELECT RELEASE_LOCK('imRoles_alta')`); } catch (_) { /* no crítico */ }
		}
		conn.release();
	}
}

// ─── Edición ────────────────────────────────────────────────────────────────

async function actualizarRol(idRol, { idEmpresa, actor, nombre, descripcion, rolBase, permisos }) {
	exigirHabilitado();
	const actual = await obtenerRolPropio(idRol, idEmpresa);

	const cambios = {};
	const sets = [];
	const params = [];

	if (nombre !== undefined && String(nombre).trim() !== String(actual.nombre).trim()) {
		const n = v.validarNombre(nombre);
		if (!n.ok) throw error(400, n.error);
		const dup = await consultar(
			`SELECT IdRol FROM imRoles WHERE IdEmpresa IN (0, ?) AND Nombre = ? AND IdRol <> ? LIMIT 1`,
			[Number(idEmpresa), n.nombre, Number(idRol)],
		);
		if (dup.length) throw error(409, 'Ya existe un rol con ese nombre');
		sets.push('Nombre = ?');
		params.push(n.nombre);
		cambios.nombre = { de: actual.nombre, a: n.nombre };
	}
	if (descripcion !== undefined) {
		const d = v.validarDescripcion(descripcion);
		if (!d.ok) throw error(400, d.error);
		if (d.descripcion !== String(actual.descripcion || '').trim()) {
			sets.push('Descripcion = ?');
			params.push(d.descripcion || null);
			cambios.descripcion = { de: actual.descripcion || '', a: d.descripcion };
		}
	}
	if (rolBase !== undefined) {
		const b = v.validarRolBase(rolBase);
		if (!b.ok) throw error(400, b.error);
		if (b.rolBase !== (actual.rolBase || 'NINGUNO')) {
			sets.push('RolBase = ?', 'Nivel = ?');
			params.push(b.rolBase, NIVEL_POR_BASE[b.rolBase] ?? 10);
			cambios.rolBase = { de: actual.rolBase || 'NINGUNO', a: b.rolBase };
		}
	}

	let nuevosPermisos = null;
	let agregadosAuto = [];
	if (permisos !== undefined) {
		const perm = v.normalizarPermisos(permisos);
		if (!perm.ok) throw error(400, perm.errores.join('. '));
		const noOtorgables = permisosNoOtorgables(perm.permisos, actual.permisos, actor?.permisos);
		if (noOtorgables.length) {
			throw error(400, noOtorgables.map((c) => `No podés otorgar el permiso ${c} porque no lo tenés`).join('. '));
		}
		nuevosPermisos = perm.permisos;
		agregadosAuto = perm.agregados;
		const antes = new Set(actual.permisos);
		const despues = new Set(nuevosPermisos);
		const agregados = nuevosPermisos.filter((c) => !antes.has(c));
		const quitados = actual.permisos.filter((c) => !despues.has(c));
		if (agregados.length || quitados.length) cambios.permisos = { agregados, quitados };
	}

	if (!Object.keys(cambios).length) {
		return { idRol: Number(idRol), sinCambios: true, agregadosAuto };
	}

	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		await conn.query(
			`UPDATE imRoles SET ${[...sets, 'FechaModificacion = NOW()'].join(', ')} WHERE IdRol = ? AND IdEmpresa = ?`,
			[...params, Number(idRol), Number(idEmpresa)],
		);
		if (nuevosPermisos && cambios.permisos) {
			await conn.query(`DELETE FROM imRolPermisosCustom WHERE IdRol = ?`, [Number(idRol)]);
			await insertarPermisos(conn, idRol, nuevosPermisos);
		}
		await registrarAuditoria(conn, {
			idEmpresa,
			idRol,
			accion: 'EDITAR',
			actor: actor?.valorPersonal,
			detalle: cambios,
		});
		await conn.commit();
	} catch (e) {
		try { await conn.rollback(); } catch (_) { /* ya cerrada */ }
		throw mapearErrorSql(e);
	} finally {
		conn.release();
	}
	invalidarCache(idRol);
	return { idRol: Number(idRol), sinCambios: false, cambios, agregadosAuto };
}

// ─── Duplicar ───────────────────────────────────────────────────────────────

async function duplicarRol(idOrigen, { idEmpresa, actor, nombre, descripcion }) {
	exigirHabilitado();
	const id = Number(idOrigen);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Id de rol inválido');

	let origen;
	if (id < v.ID_ROL_PERSONALIZADO_MIN) {
		const filtro = (await schema.esquemaListo()) ? 'AND IdEmpresa = 0' : '';
		const rows = await consultar(
			`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion
       FROM imRoles WHERE IdRol = ? AND Activo = 1 ${filtro} LIMIT 1`,
			[id],
		);
		if (!rows.length) throw error(404, 'Rol no encontrado');
		const nombreSistema = String(rows[0].nombre || '').trim().toUpperCase();
		if (nombreSistema === 'SUPER_ADMIN') throw error(403, 'Este rol no se puede duplicar');
		origen = {
			nombre: rows[0].nombre,
			descripcion: rows[0].descripcion,
			rolBase: BASE_DE_ROL_SISTEMA[nombreSistema] || 'NINGUNO',
			// Se descartan permisos restringidos (p. ej. la matriz de permisos del Admin)
			permisos: matriz.permisosDeRol(nombreSistema).filter((c) => !esPermisoRestringido(c)),
		};
	} else {
		const propio = await obtenerRolPropio(id, idEmpresa);
		origen = {
			nombre: propio.nombre,
			descripcion: propio.descripcion,
			rolBase: propio.rolBase || 'NINGUNO',
			permisos: propio.permisos,
		};
	}

	return crearRol({
		idEmpresa,
		actor,
		nombre: nombre || `${origen.nombre} (copia)`,
		descripcion: descripcion !== undefined ? descripcion : origen.descripcion || '',
		rolBase: origen.rolBase,
		permisos: origen.permisos,
		origen: { idRol: id, nombre: origen.nombre },
	});
}

// ─── Baja ───────────────────────────────────────────────────────────────────

async function contarAsignados(idEmpresa, idRol) {
	let n = 0;
	try {
		const a = await consultar(
			`SELECT COUNT(*) AS n FROM imPersonalRoles WHERE IdEmpresa = ? AND IdRol = ?`,
			[Number(idEmpresa), Number(idRol)],
		);
		n = Math.max(n, Number(a[0]?.n || 0));
	} catch (_) { /* tabla aún inexistente */ }
	try {
		const b = await consultar(
			`SELECT COUNT(*) AS n FROM imPersonal WHERE IdEmpresa = ? AND TRIM(Rol) = ?`,
			[Number(idEmpresa), String(Number(idRol))],
		);
		n = Math.max(n, Number(b[0]?.n || 0));
	} catch (_) { /* columna/tabla ausente */ }
	return n;
}

async function eliminarRol(idRol, { idEmpresa, actor }) {
	exigirHabilitado();
	const actual = await obtenerRolPropio(idRol, idEmpresa);
	const asignados = await contarAsignados(idEmpresa, idRol);
	if (asignados > 0) {
		const e = error(
			409,
			`No se puede eliminar: ${asignados} usuario${asignados === 1 ? '' : 's'} tiene${asignados === 1 ? '' : 'n'} este rol. Reasignalos primero.`,
		);
		e.usuarios = asignados;
		throw e;
	}
	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		// Baja lógica. El nombre se libera para poder reutilizarlo.
		await conn.query(
			`UPDATE imRoles
       SET Activo = 0, Nombre = LEFT(CONCAT(LEFT(Nombre, 30), ' [baja #', IdRol, ']'), 50), FechaModificacion = NOW()
       WHERE IdRol = ? AND IdEmpresa = ?`,
			[Number(idRol), Number(idEmpresa)],
		);
		await registrarAuditoria(conn, {
			idEmpresa,
			idRol,
			accion: 'ELIMINAR',
			actor: actor?.valorPersonal,
			detalle: { nombre: actual.nombre, permisos: actual.permisos },
		});
		await conn.commit();
	} catch (e) {
		try { await conn.rollback(); } catch (_) { /* ya cerrada */ }
		throw e;
	} finally {
		conn.release();
	}
	invalidarCache(idRol);
	return { idRol: Number(idRol) };
}

// ─── Usuarios y auditoría de un rol ─────────────────────────────────────────

async function usuariosDeRol(idRol, idEmpresa) {
	const id = Number(idRol);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Id de rol inválido');
	if (id >= v.ID_ROL_PERSONALIZADO_MIN) await obtenerRolPropio(id, idEmpresa);
	try {
		const rows = await consultar(
			`SELECT pr.Valor AS valor, pr.EsPrincipal AS esPrincipal, p.ApellidoNombre AS nombre
       FROM imPersonalRoles pr
       LEFT JOIN imPersonal p ON p.IdEmpresa = pr.IdEmpresa AND p.Valor = pr.Valor
       WHERE pr.IdEmpresa = ? AND pr.IdRol = ?
       ORDER BY p.ApellidoNombre ASC`,
			[Number(idEmpresa), id],
		);
		return rows.map((r) => ({
			valor: Number(r.valor),
			nombre: String(r.nombre || '').trim(),
			esPrincipal: Number(r.esPrincipal) === 1,
		}));
	} catch (e) {
		console.warn('[rolesCustom] usuariosDeRol:', e.message);
		return [];
	}
}

async function auditoriaDeRol(idRol, idEmpresa, limite = 100) {
	if (!(await schema.esquemaListo())) return [];
	const id = Number(idRol);
	if (id >= v.ID_ROL_PERSONALIZADO_MIN) await obtenerRolPropio(id, idEmpresa);
	const rows = await consultar(
		`SELECT a.IdAuditoria AS id, a.Accion AS accion, a.Actor AS actor, a.Fecha AS fecha, a.Detalle AS detalle,
            p.ApellidoNombre AS actorNombre
     FROM imRolesAuditoria a
     LEFT JOIN imPersonal p ON p.IdEmpresa = a.IdEmpresa AND p.Valor = a.Actor
     WHERE a.IdEmpresa = ? AND a.IdRol = ?
     ORDER BY a.Fecha DESC, a.IdAuditoria DESC
     LIMIT ?`,
		[Number(idEmpresa), id, Math.min(Math.max(Number(limite) || 100, 1), 500)],
	);
	return rows.map((r) => {
		let detalle = null;
		try { detalle = r.detalle ? JSON.parse(r.detalle) : null; } catch (_) { detalle = null; }
		return {
			id: Number(r.id),
			accion: r.accion,
			actor: r.actor == null ? null : Number(r.actor),
			actorNombre: String(r.actorNombre || '').trim(),
			fecha: r.fecha,
			detalle,
		};
	});
}

module.exports = {
	permisosDeRolCustom,
	invalidarCache,
	listarMatriz,
	crearRol,
	actualizarRol,
	duplicarRol,
	eliminarRol,
	usuariosDeRol,
	auditoriaDeRol,
	registrarAsignacion,
	obtenerRolPropio,
};
