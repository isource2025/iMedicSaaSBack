/**
 * Fase 3: migrar asignaciones de roles personalizados → rol(es) de sistema + overrides.
 *
 * NO borra roles custom ni filas de imRolPermisosCustom: sólo reasigna personas
 * y escribe imPersonalPermisosOverride para conservar el mismo permiso efectivo.
 *
 * Efectivos previos = (unión plantillas roles actuales ∪ grants) − denies
 * Destino = roles de sistema según RolBase (+ los de sistema que ya tenía)
 * Overrides nuevos = diff(plantilla_destino, efectivos_previos)
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const matriz = require('../utils/permisos');
const { esPermisoRestringido } = require('../utils/permisosDescripciones');
const v = require('../utils/rolesValidacion');
const personalPermisos = require('./personalPermisos.service');
const authCentral = require('./authCentral.service');
const permisosService = require('./permisos.service');

const ID_MIN = v.ID_ROL_PERSONALIZADO_MIN;

/** RolBase → nombre de rol de sistema (imRoles IdEmpresa=0). */
const SISTEMA_POR_BASE = Object.freeze({
	MEDICO: 'MEDICO',
	ENFERMERO: 'ENFERMERO',
	ADMINISTRATIVO: 'ADMINISTRATIVO',
	CARGA_HC: 'CARGA_HC',
	NINGUNO: 'ADMINISTRATIVO',
});

const NIVEL = Object.freeze({
	ADMIN: 100,
	SUPER_ADMIN: 200,
	MEDICO: 50,
	ENFERMERO: 40,
	ADMINISTRATIVO: 20,
	CARGA_HC: 25,
	PANEL_DATOS: 15,
});

async function consultar(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function mapaRolesSistema() {
	const rows = await consultar(
		`SELECT IdRol AS idRol, Nombre AS nombre
     FROM imRoles WHERE Activo = 1 AND IdEmpresa = 0 AND IdRol < ?`,
		[ID_MIN],
	);
	const porNombre = new Map();
	const porId = new Map();
	for (const r of rows) {
		const nombre = String(r.nombre || '').trim().toUpperCase();
		const id = Number(r.idRol);
		porNombre.set(nombre, id);
		porId.set(id, nombre);
	}
	return { porNombre, porId };
}

function idSistemaDeBase(rolBase, porNombre) {
	const clave = SISTEMA_POR_BASE[String(rolBase || 'NINGUNO').toUpperCase()] || 'ADMINISTRATIVO';
	const id = porNombre.get(clave);
	if (!id) {
		const e = new Error(`No hay rol de sistema para base ${rolBase} (${clave})`);
		e.statusCode = 500;
		throw e;
	}
	return id;
}

/**
 * Plan por persona (puro salvo lecturas ya hechas).
 * @returns {null | object} null si no hay nada que migrar
 */
function planearPersona({
	valor,
	nombre,
	rolesAsignados, // [{ idRol, nombre, rolBase, esPrincipal, esCustom, permisos[] }]
	overrides, // { grants, denies }
	porNombreSistema,
}) {
	const custom = rolesAsignados.filter((r) => r.esCustom);
	if (!custom.length) return null;

	const sistemaActual = rolesAsignados.filter((r) => !r.esCustom);
	const idsDestino = new Set(sistemaActual.map((r) => Number(r.idRol)));

	for (const r of custom) {
		idsDestino.add(idSistemaDeBase(r.rolBase || 'NINGUNO', porNombreSistema));
	}

	const principalOld = rolesAsignados.find((r) => r.esPrincipal) || rolesAsignados[0];
	let idPrincipal;
	if (principalOld && !principalOld.esCustom) {
		idPrincipal = Number(principalOld.idRol);
	} else if (principalOld?.esCustom) {
		idPrincipal = idSistemaDeBase(principalOld.rolBase || 'NINGUNO', porNombreSistema);
	} else {
		idPrincipal = [...idsDestino][0];
	}
	if (!idsDestino.has(idPrincipal)) idPrincipal = [...idsDestino][0];

	// Efectivos previos
	const baseOld = new Set();
	for (const r of rolesAsignados) {
		for (const c of r.permisos || []) {
			if (!esPermisoRestringido(c)) baseOld.add(c);
		}
	}
	const efectivosPrevios = personalPermisos.aplicar(
		[...baseOld],
		overrides?.grants || [],
		overrides?.denies || [],
	);

	// Base destino = plantillas de sistema
	const baseNueva = new Set();
	const destinos = [];
	for (const id of idsDestino) {
		const nombreSis = [...porNombreSistema.entries()].find(([, i]) => i === id)?.[0];
		const perms = nombreSis ? matriz.permisosDeRol(nombreSis).filter((c) => !esPermisoRestringido(c)) : [];
		destinos.push({ idRol: id, nombre: nombreSis, permisos: perms });
		for (const c of perms) baseNueva.add(c);
	}

	const { grants, denies } = personalPermisos.diff([...baseNueva], efectivosPrevios);
	const efectivosNuevos = personalPermisos.aplicar([...baseNueva], grants, denies);

	const mismos =
		efectivosPrevios.length === efectivosNuevos.length &&
		efectivosPrevios.every((c) => efectivosNuevos.includes(c));

	return {
		valor: Number(valor),
		nombre: nombre || '',
		rolesAntes: rolesAsignados.map((r) => ({
			idRol: r.idRol,
			nombre: r.nombre,
			esCustom: r.esCustom,
			esPrincipal: !!r.esPrincipal,
			rolBase: r.rolBase || null,
		})),
		rolesDespues: destinos.map((d) => ({
			idRol: d.idRol,
			nombre: d.nombre,
			esPrincipal: d.idRol === idPrincipal,
		})),
		idRolPrincipal: idPrincipal,
		efectivosPrevios,
		baseNueva: [...baseNueva],
		grants,
		denies,
		efectivosNuevos,
		permisosConservados: mismos,
	};
}

async function cargarRolesCustomMeta(idEmpresa) {
	const rows = await consultar(
		`SELECT IdRol AS idRol, Nombre AS nombre, RolBase AS rolBase
     FROM imRoles WHERE Activo = 1 AND IdEmpresa = ?`,
		[Number(idEmpresa)],
	);
	const meta = new Map();
	for (const r of rows) {
		meta.set(Number(r.idRol), {
			idRol: Number(r.idRol),
			nombre: String(r.nombre || '').trim(),
			rolBase: String(r.rolBase || 'NINGUNO').toUpperCase(),
		});
	}
	// permisos custom
	const ids = [...meta.keys()];
	if (ids.length) {
		const perms = await consultar(
			`SELECT IdRol AS idRol, Codigo AS codigo FROM imRolPermisosCustom WHERE IdRol IN (?)`,
			[ids],
		);
		const validos = new Set(matriz.todosLosCodigos().map((c) => c.codigo));
		for (const p of perms) {
			const m = meta.get(Number(p.idRol));
			if (!m) continue;
			if (!m.permisos) m.permisos = [];
			const c = String(p.codigo || '');
			if (validos.has(c) && !esPermisoRestringido(c)) m.permisos.push(c);
		}
	}
	for (const m of meta.values()) if (!m.permisos) m.permisos = [];
	return meta;
}

async function inventariarEmpresa(idEmpresa) {
	if (!isAuthCentralEnabled()) {
		const e = new Error('Requiere auth central');
		e.statusCode = 409;
		throw e;
	}
	const emp = Number(idEmpresa);
	const { porNombre, porId } = await mapaRolesSistema();
	const customMeta = await cargarRolesCustomMeta(emp);

	const asignaciones = await consultar(
		`SELECT pr.Valor AS valor, pr.IdRol AS idRol, pr.EsPrincipal AS esPrincipal,
            p.ApellidoNombre AS nombre
     FROM imPersonalRoles pr
     LEFT JOIN imPersonal p ON p.IdEmpresa = pr.IdEmpresa AND p.Valor = pr.Valor
     WHERE pr.IdEmpresa = ?
     ORDER BY pr.Valor, pr.EsPrincipal DESC`,
		[emp],
	);

	const porPersona = new Map();
	for (const a of asignaciones) {
		const vp = Number(a.valor);
		if (!porPersona.has(vp)) {
			porPersona.set(vp, { valor: vp, nombre: String(a.nombre || '').trim(), roles: [] });
		}
		const idRol = Number(a.idRol);
		const esCustom = idRol >= ID_MIN;
		const custom = customMeta.get(idRol);
		const nombreSis = porId.get(idRol);
		porPersona.get(vp).roles.push({
			idRol,
			nombre: esCustom ? custom?.nombre || `#${idRol}` : nombreSis || `#${idRol}`,
			rolBase: esCustom ? custom?.rolBase || 'NINGUNO' : null,
			esPrincipal: Number(a.esPrincipal) === 1,
			esCustom,
			permisos: esCustom
				? custom?.permisos || []
				: nombreSis
					? matriz.permisosDeRol(nombreSis).filter((c) => !esPermisoRestringido(c))
					: [],
		});
	}

	const planes = [];
	let conCustom = 0;
	let soloCustom = 0;
	for (const p of porPersona.values()) {
		const tieneCustom = p.roles.some((r) => r.esCustom);
		if (!tieneCustom) continue;
		conCustom += 1;
		if (p.roles.every((r) => r.esCustom)) soloCustom += 1;
		const ov = await personalPermisos.listarOverrides(emp, p.valor);
		const plan = planearPersona({
			valor: p.valor,
			nombre: p.nombre,
			rolesAsignados: p.roles,
			overrides: ov,
			porNombreSistema: porNombre,
		});
		if (plan) planes.push(plan);
	}

	return {
		idEmpresa: emp,
		rolesCustomActivos: customMeta.size,
		personasConCustom: conCustom,
		personasSoloCustom: soloCustom,
		planes,
		sinConservarPermisos: planes.filter((p) => !p.permisosConservados).length,
	};
}

/** Aplica un plan ya calculado. No borra roles custom. */
async function aplicarPlan(idEmpresa, plan) {
	const emp = Number(idEmpresa);
	const ids = plan.rolesDespues.map((r) => r.idRol);
	await authCentral.asignarRolesDeValorPersonal(emp, plan.valor, ids, plan.idRolPrincipal);
	try {
		await consultar(`UPDATE imPersonal SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`, [
			String(plan.idRolPrincipal),
			emp,
			plan.valor,
		]);
	} catch (e) {
		console.warn('[migrarRolesCustom] espejo imPersonal.Rol:', e.message);
	}
	await persistirOverridesMigracion(emp, plan);
	for (const id of ids) permisosService.invalidarCache(id);
	personalPermisos.invalidar(emp, plan.valor);
	return { valor: plan.valor, ok: true };
}

async function aplicarInventario(idEmpresa, inventario, { limite = Infinity } = {}) {
	const aplicados = [];
	const errores = [];
	let n = 0;
	for (const plan of inventario.planes) {
		if (n >= limite) break;
		try {
			// Bypass de actor: la migración es operación de soporte
			const emp = Number(idEmpresa);
			const ids = plan.rolesDespues.map((r) => r.idRol);
			await authCentral.asignarRolesDeValorPersonal(emp, plan.valor, ids, plan.idRolPrincipal);
			try {
				await consultar(`UPDATE imPersonal SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`, [
					String(plan.idRolPrincipal),
					emp,
					plan.valor,
				]);
			} catch (_) {
				/* no crítico */
			}

			// Persistir overrides sin validar actor (script de soporte)
			await persistirOverridesMigracion(emp, plan);

			for (const id of ids) permisosService.invalidarCache(id);
			personalPermisos.invalidar(emp, plan.valor);
			aplicados.push(plan.valor);
			n += 1;
		} catch (e) {
			errores.push({ valor: plan.valor, mensaje: e.message });
		}
	}
	return { aplicados, errores };
}

async function persistirOverridesMigracion(idEmpresa, plan) {
	const { grants, denies } = personalPermisos.diff(plan.baseNueva, plan.efectivosPrevios);
	if (!(await personalPermisos.asegurarTabla())) {
		const e = new Error('No se pudo asegurar imPersonalPermisosOverride');
		e.statusCode = 503;
		throw e;
	}
	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	const emp = Number(idEmpresa);
	const vp = Number(plan.valor);
	try {
		await conn.beginTransaction();
		await conn.query(`DELETE FROM imPersonalPermisosOverride WHERE IdEmpresa = ? AND Valor = ?`, [
			emp,
			vp,
		]);
		const filas = [
			...grants.map((c) => [emp, vp, c, 'GRANT', null]),
			...denies.map((c) => [emp, vp, c, 'DENY', null]),
		];
		if (filas.length) {
			await conn.query(
				`INSERT INTO imPersonalPermisosOverride
           (IdEmpresa, Valor, Codigo, Efecto, FechaModificacion, ModificadoPor)
         VALUES ?`,
				[filas.map((f) => [f[0], f[1], f[2], f[3], new Date(), f[4]])],
			);
		}
		await conn.commit();
	} catch (e) {
		try {
			await conn.rollback();
		} catch (_) {
			/* */
		}
		throw e;
	} finally {
		conn.release();
	}
	personalPermisos.invalidar(emp, vp);
	return { grants, denies };
}

/** Gates post-migración (sólo lectura). */
async function verificarGates(idEmpresa) {
	const emp = Number(idEmpresa);
	const [[{ nAsig }]] = await (
		await getAuthCentralPool()
	).query(`SELECT COUNT(*) AS nAsig FROM imPersonalRoles WHERE IdEmpresa = ? AND IdRol >= ?`, [
		emp,
		ID_MIN,
	]);
	const [[{ nRol }]] = await (
		await getAuthCentralPool()
	).query(
		`SELECT COUNT(*) AS nRol FROM imPersonal
     WHERE IdEmpresa = ? AND Rol REGEXP '^[0-9]+$' AND CAST(Rol AS UNSIGNED) >= ?`,
		[emp, ID_MIN],
	);
	const inv = await inventariarEmpresa(emp);
	return {
		idEmpresa: emp,
		asignacionesCustom: Number(nAsig),
		personalRolCustom: Number(nRol),
		personasSoloCustom: inv.personasSoloCustom,
		personasConCustom: inv.personasConCustom,
		ok: Number(nAsig) === 0 && inv.personasSoloCustom === 0 && inv.personasConCustom === 0,
	};
}

/** Fase 5 (sin borrar): qué quedaría por deprecar. */
async function inventarioDeprecacion() {
	const roles = await consultar(
		`SELECT IdEmpresa AS idEmpresa, COUNT(*) AS roles
     FROM imRoles WHERE Activo = 1 AND IdEmpresa > 0 GROUP BY IdEmpresa ORDER BY IdEmpresa`,
	);
	const [[{ permisosCustom }]] = await (
		await getAuthCentralPool()
	).query(`SELECT COUNT(*) AS permisosCustom FROM imRolPermisosCustom`);
	const [[{ asignaciones }]] = await (
		await getAuthCentralPool()
	).query(`SELECT COUNT(*) AS asignaciones FROM imPersonalRoles WHERE IdRol >= ?`, [ID_MIN]);
	return {
		mensaje:
			'Inventario de deprecación (NO se borró nada). Cuando asignaciones=0 se puede planear el retiro de código/tablas.',
		rolesCustomPorEmpresa: roles.map((r) => ({
			idEmpresa: Number(r.idEmpresa),
			roles: Number(r.roles),
		})),
		filasImRolPermisosCustom: Number(permisosCustom),
		asignacionesCustomPendientes: Number(asignaciones),
		listoParaRetirarCodigo: Number(asignaciones) === 0,
	};
}

module.exports = {
	SISTEMA_POR_BASE,
	NIVEL,
	planearPersona,
	inventariarEmpresa,
	aplicarPlan,
	aplicarInventario,
	verificarGates,
	inventarioDeprecacion,
	persistirOverridesMigracion,
	mapaRolesSistema,
	idSistemaDeBase,
};
