/**
 * Matriz de permisos en SQL Server (LOCAL_DEV_ONLY / sin auth central MySQL).
 * Misma forma de respuesta que rolesCustom.service para que la UI no cambie.
 */
const { executeQuery } = require('../models/db');
const matriz = require('../utils/permisos');
const { esPermisoRestringido } = require('../utils/permisosDescripciones');
const v = require('../utils/rolesValidacion');

const MAX_ROLES_POR_EMPRESA = 50;
const NIVEL_POR_BASE = { NINGUNO: 10, ADMINISTRATIVO: 20, CARGA_HC: 25, ENFERMERO: 40, MEDICO: 50 };
const BASE_DE_ROL_SISTEMA = {
	MEDICO: 'MEDICO',
	ENFERMERO: 'ENFERMERO',
	ADMINISTRATIVO: 'ADMINISTRATIVO',
	CARGA_HC: 'CARGA_HC',
};

function error(statusCode, mensaje) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

function plantillasCongeladas() {
	return String(process.env.ROLES_PLANTILLAS_CONGELADAS || 'true').toLowerCase() !== 'false';
}

function personalizadosHabilitados() {
	return String(process.env.ROLES_PERSONALIZADOS_ENABLED || 'true').toLowerCase() !== 'false';
}

function codigosValidos() {
	return new Set(matriz.todosLosCodigos().map((c) => c.codigo));
}

function permisosNoOtorgables(nuevos, actuales, permisosActor) {
	if (!Array.isArray(permisosActor)) return [];
	const actor = new Set(permisosActor);
	const antes = new Set(actuales || []);
	return (nuevos || []).filter((c) => !antes.has(c) && !actor.has(c));
}

async function columnaExiste(tabla, columna) {
	const rows = await executeQuery(
		`SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @p0 AND COLUMN_NAME = @p1`,
		[
			{ value: tabla, type: 'VarChar' },
			{ value: columna, type: 'VarChar' },
		],
	);
	return rows.length > 0;
}

async function tablaExiste(tabla) {
	const rows = await executeQuery(
		`SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @p0`,
		[{ value: tabla, type: 'VarChar' }],
	);
	return rows.length > 0;
}

let _esquemaCache = { at: 0, listo: false };

async function esquemaListo() {
	const ahora = Date.now();
	if (ahora - _esquemaCache.at < 30_000) return _esquemaCache.listo;
	const listo =
		(await columnaExiste('imRoles', 'IdEmpresa')) &&
		(await tablaExiste('imRolPermisosCustom')) &&
		(await tablaExiste('imPersonalPermisosOverride'));
	_esquemaCache = { at: ahora, listo };
	return listo;
}

function invalidarEsquemaCache() {
	_esquemaCache = { at: 0, listo: false };
}

async function contarUsuariosPorRol() {
	const conteo = new Map();
	try {
		const rows = await executeQuery(
			`SELECT TRY_CAST(LTRIM(RTRIM(Rol)) AS INT) AS idRol, COUNT(*) AS n
       FROM dbo.imPersonal
       WHERE Rol IS NOT NULL AND LTRIM(RTRIM(Rol)) <> ''
         AND TRY_CAST(LTRIM(RTRIM(Rol)) AS INT) IS NOT NULL
       GROUP BY TRY_CAST(LTRIM(RTRIM(Rol)) AS INT)`,
		);
		for (const r of rows) conteo.set(Number(r.idRol), Number(r.n));
	} catch (e) {
		console.warn('[rolesMatrizLocal] contar usuarios:', e.message);
	}
	return conteo;
}

async function permisosPlantillaSistema(ids) {
	const mapa = new Map(ids.map((id) => [id, null]));
	if (!ids.length) return mapa;
	try {
		const rows = await executeQuery(
			`SELECT rp.IdRol AS idRol, p.Codigo AS codigo
       FROM dbo.imRolPermisos rp
       INNER JOIN dbo.imPermisos p ON p.IdPermiso = rp.IdPermiso
       WHERE rp.IdRol IN (${ids.map((_, i) => `@p${i}`).join(',')})
       ORDER BY p.Codigo`,
			ids.map((id) => ({ value: Number(id), type: 'Int' })),
		);
		const validos = codigosValidos();
		for (const f of rows) {
			const id = Number(f.idRol);
			const c = String(f.codigo || '');
			if (!validos.has(c)) continue;
			if (!mapa.get(id)) mapa.set(id, []);
			mapa.get(id).push(c);
		}
	} catch (e) {
		console.warn('[rolesMatrizLocal] permisosPlantillaSistema:', e.message);
	}
	return mapa;
}

async function listarMatriz(idEmpresa) {
	const listo = await esquemaListo();
	const filtroEmpresa = listo ? 'AND ISNULL(IdEmpresa, 0) = 0' : '';
	const filas = await executeQuery(
		`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel
     FROM dbo.imRoles
     WHERE Activo = 1 AND UPPER(LTRIM(RTRIM(Nombre))) <> 'SUPER_ADMIN'
       AND IdRol < @p0
       ${filtroEmpresa}
     ORDER BY Nivel DESC, Nombre ASC`,
		[{ value: v.ID_ROL_PERSONALIZADO_MIN, type: 'Int' }],
	);
	const usuarios = await contarUsuariosPorRol();
	const idsSistema = filas.map((r) => Number(r.idRol));
	const permisosBd = await permisosPlantillaSistema(idsSistema);

	const sistema = filas.map((r) => {
		const nombre = String(r.nombre || '').trim().toUpperCase();
		const id = Number(r.idRol);
		const deBd = permisosBd.get(id);
		return {
			idRol: id,
			nombre: String(r.nombre || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			nivel: Number(r.nivel ?? 0),
			esSistema: true,
			editable: true,
			rolBase: BASE_DE_ROL_SISTEMA[nombre] || (nombre === 'ADMIN' ? null : 'NINGUNO'),
			permisos: deBd && deBd.length ? deBd : [...matriz.permisosDeRol(nombre)],
			usuarios: usuarios.get(id) || 0,
		};
	});

	let personalizados = [];
	if (listo && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
		const roles = await executeQuery(
			`SELECT IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel,
              RolBase AS rolBase, FechaCreacion AS fechaCreacion, FechaModificacion AS fechaModificacion
       FROM dbo.imRoles
       WHERE Activo = 1 AND IdEmpresa = @p0
       ORDER BY Nombre ASC`,
			[{ value: Number(idEmpresa), type: 'Int' }],
		);
		const ids = roles.map((r) => Number(r.idRol));
		const permisosPorRol = new Map(ids.map((id) => [id, []]));
		if (ids.length) {
			const filasPermisos = await executeQuery(
				`SELECT IdRol AS idRol, Codigo AS codigo FROM dbo.imRolPermisosCustom
         WHERE IdRol IN (${ids.map((_, i) => `@p${i}`).join(',')})`,
				ids.map((id) => ({ value: Number(id), type: 'Int' })),
			);
			const validos = codigosValidos();
			for (const p of filasPermisos) {
				const c = String(p.codigo || '');
				if (validos.has(c) && !esPermisoRestringido(c)) {
					permisosPorRol.get(Number(p.idRol))?.push(c);
				}
			}
		}
		const congeladas = plantillasCongeladas();
		personalizados = roles.map((r) => ({
			idRol: Number(r.idRol),
			nombre: String(r.nombre || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			nivel: Number(r.nivel ?? 0),
			esSistema: false,
			editable: !congeladas,
			rolBase: r.rolBase || 'NINGUNO',
			permisos: permisosPorRol.get(Number(r.idRol)) || [],
			usuarios: usuarios.get(Number(r.idRol)) || 0,
			fechaCreacion: r.fechaCreacion || null,
			fechaModificacion: r.fechaModificacion || null,
		}));
	}

	const congeladas = plantillasCongeladas();
	const flagOn = personalizadosHabilitados() && listo;
	return {
		soportaPersonalizados: flagOn && !congeladas,
		plantillasCongeladas: congeladas,
		esquemaListo: listo,
		sistema,
		personalizados,
	};
}

async function obtenerRolSistema(idRol) {
	const id = Number(idRol);
	if (!Number.isFinite(id) || id <= 0 || id >= v.ID_ROL_PERSONALIZADO_MIN) {
		throw error(400, 'Id de rol inválido');
	}
	const rows = await executeQuery(
		`SELECT TOP 1 IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel
     FROM dbo.imRoles
     WHERE IdRol = @p0 AND Activo = 1`,
		[{ value: id, type: 'Int' }],
	);
	if (!rows.length) throw error(404, 'Rol no encontrado');
	const nombre = String(rows[0].nombre || '').trim().toUpperCase();
	if (nombre === 'SUPER_ADMIN') throw error(403, 'Este rol no se puede modificar');
	const deBd = await permisosPlantillaSistema([id]);
	const permisos = deBd.get(id)?.length ? deBd.get(id) : [...matriz.permisosDeRol(nombre)];
	return {
		idRol: id,
		nombre: String(rows[0].nombre || '').trim(),
		descripcion: rows[0].descripcion,
		permisos,
	};
}

async function asegurarCodigos(codigos) {
	const unicos = [...new Set(codigos.map((c) => String(c || '').trim()).filter(Boolean))];
	const mapa = new Map();
	for (const codigo of unicos) {
		const [mod, sub, acc] = codigo.split('.');
		const rows = await executeQuery(
			`IF NOT EXISTS (SELECT 1 FROM dbo.imPermisos WHERE Codigo = @p0)
         INSERT INTO dbo.imPermisos (Codigo, Modulo, Submodulo, Accion, Descripcion)
         VALUES (@p0, @p1, @p2, @p3, NULL);
       SELECT IdPermiso AS idPermiso FROM dbo.imPermisos WHERE Codigo = @p0;`,
			[
				{ value: codigo, type: 'VarChar' },
				{ value: mod || '', type: 'VarChar' },
				{ value: sub || '', type: 'VarChar' },
				{ value: acc || '', type: 'VarChar' },
			],
		);
		if (rows[0]?.idPermiso != null) mapa.set(codigo, Number(rows[0].idPermiso));
	}
	return mapa;
}

async function sincronizarImRolPermisos(idRol, permisos) {
	const mapa = await asegurarCodigos(permisos);
	await executeQuery(`DELETE FROM dbo.imRolPermisos WHERE IdRol = @p0`, [
		{ value: Number(idRol), type: 'Int' },
	]);
	for (const c of permisos) {
		const idPermiso = mapa.get(c);
		if (idPermiso == null) continue;
		await executeQuery(
			`INSERT INTO dbo.imRolPermisos (IdRol, IdPermiso) VALUES (@p0, @p1)`,
			[
				{ value: Number(idRol), type: 'Int' },
				{ value: idPermiso, type: 'Int' },
			],
		);
	}
}

async function registrarAuditoria({ idEmpresa, idRol, accion, actor, detalle }) {
	if (!(await tablaExiste('imAuditoria'))) return;
	try {
		await executeQuery(
			`INSERT INTO dbo.imAuditoria (IdEmpresa, Modulo, Entidad, IdEntidad, Accion, Actor, Detalle, Fecha)
       VALUES (@p0, 'ROLES', 'ROL', @p1, @p2, @p3, @p4, GETDATE())`,
			[
				{ value: Number(idEmpresa) || 0, type: 'Int' },
				{ value: Number(idRol), type: 'Int' },
				{ value: String(accion || ''), type: 'VarChar' },
				{ value: actor != null ? Number(actor) : null, type: 'Int' },
				{ value: detalle ? JSON.stringify(detalle) : null, type: 'NVarChar' },
			],
		);
	} catch (e) {
		console.warn('[rolesMatrizLocal] auditoria:', e.message);
	}
}

async function actualizarPlantillaSistema(idRol, { idEmpresa, actor, permisos }) {
	if (permisos === undefined) throw error(400, 'Indicá los permisos de la plantilla');
	const actual = await obtenerRolSistema(idRol);
	const nombreUpper = String(actual.nombre || '').trim().toUpperCase();
	const perm = v.normalizarPermisos(permisos, {
		permitirRestringidos: nombreUpper === 'ADMIN',
	});
	if (!perm.ok) throw error(400, perm.errores.join('. '));

	const noOtorgables = permisosNoOtorgables(perm.permisos, actual.permisos, actor?.permisos);
	if (noOtorgables.length) {
		throw error(400, noOtorgables.map((c) => `No podés otorgar el permiso ${c} porque no lo tenés`).join('. '));
	}

	const antes = new Set(actual.permisos);
	const despues = new Set(perm.permisos);
	const agregados = perm.permisos.filter((c) => !antes.has(c));
	const quitados = actual.permisos.filter((c) => !despues.has(c));
	if (!agregados.length && !quitados.length) {
		return { idRol: Number(idRol), sinCambios: true, agregadosAuto: perm.agregados };
	}

	await sincronizarImRolPermisos(idRol, perm.permisos);
	await registrarAuditoria({
		idEmpresa,
		idRol,
		accion: 'EDITAR',
		actor: actor?.valorPersonal,
		detalle: { plantillaSistema: true, nombre: actual.nombre, permisos: { agregados, quitados } },
	});

	try {
		require('./permisos.service').invalidarCache(idRol);
	} catch (_) {
		/* no crítico */
	}

	return {
		idRol: Number(idRol),
		sinCambios: false,
		cambios: { permisos: { agregados, quitados } },
		agregadosAuto: perm.agregados,
	};
}

async function exigirPersonalizados(idEmpresa) {
	if (!personalizadosHabilitados()) {
		throw error(503, 'Los roles personalizados están deshabilitados');
	}
	if (!(await esquemaListo())) {
		throw error(
			409,
			'La gestión de roles personalizados todavía no está instalada en este entorno. Corré scripts/setup_matriz_local.js',
		);
	}
	if (plantillasCongeladas()) {
		throw error(
			403,
			'Las plantillas de roles están congeladas. El ajuste fino de permisos se hace por persona en Personal.',
		);
	}
	if (!Number.isFinite(Number(idEmpresa)) || Number(idEmpresa) <= 0) {
		throw error(400, 'Se requiere una empresa activa');
	}
}

async function obtenerRolPropio(idRol, idEmpresa) {
	const id = Number(idRol);
	if (!Number.isFinite(id) || id < v.ID_ROL_PERSONALIZADO_MIN) throw error(404, 'Rol no encontrado');
	const rows = await executeQuery(
		`SELECT TOP 1 IdRol AS idRol, Nombre AS nombre, Descripcion AS descripcion, Nivel AS nivel,
            RolBase AS rolBase
     FROM dbo.imRoles
     WHERE IdRol = @p0 AND Activo = 1 AND IdEmpresa = @p1`,
		[
			{ value: id, type: 'Int' },
			{ value: Number(idEmpresa), type: 'Int' },
		],
	);
	if (!rows.length) throw error(404, 'Rol no encontrado');
	const permRows = await executeQuery(
		`SELECT Codigo AS codigo FROM dbo.imRolPermisosCustom WHERE IdRol = @p0`,
		[{ value: id, type: 'Int' }],
	);
	const validos = codigosValidos();
	const permisos = permRows
		.map((r) => String(r.codigo || ''))
		.filter((c) => validos.has(c) && !esPermisoRestringido(c));
	return {
		idRol: id,
		nombre: String(rows[0].nombre || '').trim(),
		descripcion: String(rows[0].descripcion || '').trim(),
		rolBase: rows[0].rolBase || 'NINGUNO',
		permisos,
	};
}

async function insertarPermisosCustom(idRol, permisos) {
	for (const c of permisos) {
		await executeQuery(
			`IF NOT EXISTS (SELECT 1 FROM dbo.imRolPermisosCustom WHERE IdRol = @p0 AND Codigo = @p1)
         INSERT INTO dbo.imRolPermisosCustom (IdRol, Codigo) VALUES (@p0, @p1)`,
			[
				{ value: Number(idRol), type: 'Int' },
				{ value: c, type: 'VarChar' },
			],
		);
	}
}

async function crearRol({ idEmpresa, actor, nombre, descripcion, rolBase, permisos, origen = null }) {
	await exigirPersonalizados(idEmpresa);
	const n = v.validarNombre(nombre);
	if (!n.ok) throw error(400, n.error);
	const d = v.validarDescripcion(descripcion);
	if (!d.ok) throw error(400, d.error);
	const b = v.validarRolBase(rolBase);
	if (!b.ok) throw error(400, b.error);
	const perm = v.normalizarPermisos(permisos || []);
	if (!perm.ok) throw error(400, perm.errores.join('. '));
	const noOtorgables = permisosNoOtorgables(perm.permisos, [], actor?.permisos);
	if (noOtorgables.length) {
		throw error(400, noOtorgables.map((c) => `No podés otorgar el permiso ${c} porque no lo tenés`).join('. '));
	}

	const existentes = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imRoles WHERE Activo = 1 AND IdEmpresa = @p0`,
		[{ value: Number(idEmpresa), type: 'Int' }],
	);
	if (Number(existentes[0]?.n || 0) >= MAX_ROLES_POR_EMPRESA) {
		throw error(400, `Máximo ${MAX_ROLES_POR_EMPRESA} roles personalizados por clínica`);
	}
	const dup = await executeQuery(
		`SELECT TOP 1 IdRol FROM dbo.imRoles
     WHERE Activo = 1 AND Nombre = @p0 AND (IdEmpresa = 0 OR IdEmpresa = @p1)`,
		[
			{ value: n.nombre, type: 'VarChar' },
			{ value: Number(idEmpresa), type: 'Int' },
		],
	);
	if (dup.length) throw error(409, 'Ya existe un rol con ese nombre');

	const maxRows = await executeQuery(
		`SELECT COALESCE(MAX(IdRol), ${v.ID_ROL_PERSONALIZADO_MIN - 1}) AS m FROM dbo.imRoles WHERE IdRol >= @p0`,
		[{ value: v.ID_ROL_PERSONALIZADO_MIN, type: 'Int' }],
	);
	const idRol = Math.max(v.ID_ROL_PERSONALIZADO_MIN, Number(maxRows[0]?.m || 0) + 1);
	const nivel = NIVEL_POR_BASE[b.rolBase] ?? 10;

	await executeQuery(
		`INSERT INTO dbo.imRoles
       (IdRol, Nombre, Descripcion, Nivel, Activo, FechaCreacion, IdEmpresa, RolBase, CreadoPor, FechaModificacion)
     VALUES
       (@p0, @p1, @p2, @p3, 1, GETDATE(), @p4, @p5, @p6, GETDATE())`,
		[
			{ value: idRol, type: 'Int' },
			{ value: n.nombre, type: 'VarChar' },
			{ value: d.descripcion || null, type: 'VarChar' },
			{ value: nivel, type: 'Int' },
			{ value: Number(idEmpresa), type: 'Int' },
			{ value: b.rolBase, type: 'VarChar' },
			{ value: actor?.valorPersonal != null ? Number(actor.valorPersonal) : null, type: 'Int' },
		],
	);
	await insertarPermisosCustom(idRol, perm.permisos);
	await registrarAuditoria({
		idEmpresa,
		idRol,
		accion: origen ? 'DUPLICAR' : 'CREAR',
		actor: actor?.valorPersonal,
		detalle: { nombre: n.nombre, rolBase: b.rolBase, permisos: perm.permisos, origen },
	});
	return {
		idRol,
		nombre: n.nombre,
		descripcion: d.descripcion,
		rolBase: b.rolBase,
		permisos: perm.permisos,
		agregadosAuto: perm.agregados,
	};
}

async function actualizarRol(idRol, { idEmpresa, actor, nombre, descripcion, rolBase, permisos }) {
	const id = Number(idRol);
	if (Number.isFinite(id) && id > 0 && id < v.ID_ROL_PERSONALIZADO_MIN) {
		return actualizarPlantillaSistema(id, { idEmpresa, actor, permisos });
	}
	await exigirPersonalizados(idEmpresa);
	const actual = await obtenerRolPropio(id, idEmpresa);
	const cambios = {};
	const sets = [];
	const params = [];
	let pi = 0;

	if (nombre !== undefined && String(nombre).trim() !== String(actual.nombre).trim()) {
		const n = v.validarNombre(nombre);
		if (!n.ok) throw error(400, n.error);
		const dup = await executeQuery(
			`SELECT TOP 1 IdRol FROM dbo.imRoles
       WHERE Activo = 1 AND Nombre = @p0 AND IdRol <> @p1 AND (IdEmpresa = 0 OR IdEmpresa = @p2)`,
			[
				{ value: n.nombre, type: 'VarChar' },
				{ value: id, type: 'Int' },
				{ value: Number(idEmpresa), type: 'Int' },
			],
		);
		if (dup.length) throw error(409, 'Ya existe un rol con ese nombre');
		sets.push(`Nombre = @p${pi}`);
		params.push({ value: n.nombre, type: 'VarChar' });
		pi += 1;
		cambios.nombre = { de: actual.nombre, a: n.nombre };
	}
	if (descripcion !== undefined) {
		const d = v.validarDescripcion(descripcion);
		if (!d.ok) throw error(400, d.error);
		if (d.descripcion !== String(actual.descripcion || '').trim()) {
			sets.push(`Descripcion = @p${pi}`);
			params.push({ value: d.descripcion || null, type: 'VarChar' });
			pi += 1;
			cambios.descripcion = { de: actual.descripcion || '', a: d.descripcion };
		}
	}
	if (rolBase !== undefined) {
		const b = v.validarRolBase(rolBase);
		if (!b.ok) throw error(400, b.error);
		if (b.rolBase !== (actual.rolBase || 'NINGUNO')) {
			sets.push(`RolBase = @p${pi}`);
			params.push({ value: b.rolBase, type: 'VarChar' });
			pi += 1;
			sets.push(`Nivel = @p${pi}`);
			params.push({ value: NIVEL_POR_BASE[b.rolBase] ?? 10, type: 'Int' });
			pi += 1;
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
		return { idRol: id, sinCambios: true, agregadosAuto };
	}

	if (sets.length) {
		params.push({ value: id, type: 'Int' });
		params.push({ value: Number(idEmpresa), type: 'Int' });
		await executeQuery(
			`UPDATE dbo.imRoles SET ${sets.join(', ')}, FechaModificacion = GETDATE()
       WHERE IdRol = @p${pi} AND IdEmpresa = @p${pi + 1}`,
			params,
		);
	}
	if (nuevosPermisos && cambios.permisos) {
		await executeQuery(`DELETE FROM dbo.imRolPermisosCustom WHERE IdRol = @p0`, [
			{ value: id, type: 'Int' },
		]);
		await insertarPermisosCustom(id, nuevosPermisos);
	}
	await registrarAuditoria({
		idEmpresa,
		idRol: id,
		accion: 'EDITAR',
		actor: actor?.valorPersonal,
		detalle: cambios,
	});
	return { idRol: id, sinCambios: false, cambios, agregadosAuto };
}

async function duplicarRol(idOrigen, { idEmpresa, actor, nombre, descripcion, rolBase }) {
	await exigirPersonalizados(idEmpresa);
	const id = Number(idOrigen);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Id de rol inválido');

	let origen;
	if (id < v.ID_ROL_PERSONALIZADO_MIN) {
		origen = await obtenerRolSistema(id);
		origen.rolBase = BASE_DE_ROL_SISTEMA[String(origen.nombre).toUpperCase()] || 'NINGUNO';
	} else {
		origen = await obtenerRolPropio(id, idEmpresa);
	}
	return crearRol({
		idEmpresa,
		actor,
		nombre: nombre || `${origen.nombre} (copia)`,
		descripcion: descripcion ?? origen.descripcion,
		rolBase: rolBase || origen.rolBase || 'NINGUNO',
		permisos: origen.permisos,
		origen: { idRol: id, nombre: origen.nombre },
	});
}

async function eliminarRol(idRol, { idEmpresa, actor }) {
	await exigirPersonalizados(idEmpresa);
	const actual = await obtenerRolPropio(idRol, idEmpresa);
	const usuarios = await contarUsuariosPorRol();
	if ((usuarios.get(Number(idRol)) || 0) > 0) {
		throw error(409, 'No se puede eliminar un rol con usuarios asignados');
	}
	await executeQuery(
		`UPDATE dbo.imRoles SET Activo = 0, FechaModificacion = GETDATE()
     WHERE IdRol = @p0 AND IdEmpresa = @p1`,
		[
			{ value: Number(idRol), type: 'Int' },
			{ value: Number(idEmpresa), type: 'Int' },
		],
	);
	await registrarAuditoria({
		idEmpresa,
		idRol,
		accion: 'ELIMINAR',
		actor: actor?.valorPersonal,
		detalle: { nombre: actual.nombre },
	});
	return { idRol: Number(idRol) };
}

async function usuariosDeRol(idRol) {
	const id = Number(idRol);
	if (!Number.isFinite(id) || id <= 0) throw error(400, 'Id de rol inválido');
	try {
		const rows = await executeQuery(
			`SELECT Valor AS valor, LTRIM(RTRIM(ISNULL(ApellidoNombre, ''))) AS nombre
       FROM dbo.imPersonal
       WHERE TRY_CAST(LTRIM(RTRIM(Rol)) AS INT) = @p0
       ORDER BY ApellidoNombre ASC`,
			[{ value: id, type: 'Int' }],
		);
		return rows.map((r) => ({
			valor: Number(r.valor),
			nombre: String(r.nombre || '').trim(),
			esPrincipal: true,
		}));
	} catch (e) {
		console.warn('[rolesMatrizLocal] usuariosDeRol:', e.message);
		return [];
	}
}

async function auditoriaDeRol(idRol, idEmpresa, limite = 100) {
	if (!(await tablaExiste('imAuditoria'))) return [];
	const id = Number(idRol);
	if (id >= v.ID_ROL_PERSONALIZADO_MIN) await obtenerRolPropio(id, idEmpresa);
	else await obtenerRolSistema(id);
	const rows = await executeQuery(
		`SELECT TOP (@p0)
        Id AS id, Accion AS accion, Actor AS actor, Fecha AS fecha, Detalle AS detalle
     FROM dbo.imAuditoria
     WHERE IdEmpresa = @p1 AND Modulo = 'ROLES' AND Entidad = 'ROL' AND IdEntidad = @p2
     ORDER BY Fecha DESC, Id DESC`,
		[
			{ value: Math.min(Number(limite) || 100, 500), type: 'Int' },
			{ value: Number(idEmpresa) || 0, type: 'Int' },
			{ value: id, type: 'Int' },
		],
	);
	return rows.map((r) => {
		let detalle = null;
		if (r.detalle) {
			try {
				detalle = typeof r.detalle === 'string' ? JSON.parse(r.detalle) : r.detalle;
			} catch {
				detalle = { raw: String(r.detalle) };
			}
		}
		return {
			id: Number(r.id),
			accion: String(r.accion || ''),
			actor: r.actor != null ? Number(r.actor) : null,
			actorNombre: '',
			fecha: r.fecha,
			detalle,
		};
	});
}

async function permisosDeRolCustom(idRol) {
	if (!(await esquemaListo())) return [];
	const rows = await executeQuery(
		`SELECT rp.Codigo AS codigo
     FROM dbo.imRolPermisosCustom rp
     INNER JOIN dbo.imRoles r ON r.IdRol = rp.IdRol AND r.Activo = 1
     WHERE rp.IdRol = @p0`,
		[{ value: Number(idRol), type: 'Int' }],
	);
	const validos = codigosValidos();
	return rows
		.map((r) => String(r.codigo || ''))
		.filter((c) => validos.has(c) && !esPermisoRestringido(c));
}

module.exports = {
	listarMatriz,
	crearRol,
	actualizarRol,
	duplicarRol,
	eliminarRol,
	usuariosDeRol,
	auditoriaDeRol,
	obtenerRolPropio,
	obtenerRolSistema,
	actualizarPlantillaSistema,
	permisosDeRolCustom,
	esquemaListo,
	invalidarEsquemaCache,
	plantillasCongeladas,
	BASE_DE_ROL_SISTEMA,
	NIVEL_POR_BASE,
};
