/**
 * Esquema de roles personalizados (auth central, MySQL en Railway).
 *
 * Es ADITIVO e idempotente:
 *   - imRoles: columnas nuevas con valores por defecto (los roles existentes
 *     quedan como "del sistema": IdEmpresa = 0).
 *   - imRolPermisosCustom: permisos de cada rol personalizado (por código).
 *   - imAuditoria (auditoria.service): historial general; los roles sólo lo usan
 *     con Modulo = ROLES, no tienen tabla propia.
 *   - imFeatureFlags (featureFlags.service): activación por empresa.
 *
 * La instalación es EXPLÍCITA: la corre una persona con `scripts/esquema_roles.js`
 * (estado / simulación / aplicar / revertir). El servidor NUNCA modifica el esquema
 * por su cuenta. Mientras no esté instalado, todo el sistema usa las consultas de
 * siempre (`esquemaListo()` devuelve false).
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const auditoria = require('./auditoria.service');
const featureFlags = require('./featureFlags.service');

const REVISAR_CADA_MS = 60 * 1000;

const COLUMNAS = [
	['IdEmpresa', 'INT NOT NULL DEFAULT 0'],
	['RolBase', 'VARCHAR(30) NULL'],
	['CreadoPor', 'INT NULL'],
	['FechaCreacion', 'DATETIME NULL'], // en producción ya existe: no se crea ni se borra al revertir
	['FechaModificacion', 'DATETIME NULL'],
];
// Columnas que esta migración agrega de verdad (FechaCreacion ya existía antes)
const COLUMNAS_A_REVERTIR = ['IdEmpresa', 'RolBase', 'CreadoPor', 'FechaModificacion'];

const INDICE_EMPRESA_NOMBRE = 'UQ_imRoles_Empresa_Nombre';
const INDICE_NOMBRE_ORIGINAL = 'UQ_imRoles_Nombre';

const DDL_PERMISOS_CUSTOM = `
    CREATE TABLE IF NOT EXISTS \`imRolPermisosCustom\` (
      \`IdRol\` INT NOT NULL,
      \`Codigo\` VARCHAR(120) NOT NULL,
      PRIMARY KEY (\`IdRol\`, \`Codigo\`)
    ) ENGINE = InnoDB
  `;

let listo = false;
let ultimoChequeo = 0;

async function consultarPool(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

// ─── Introspección (sólo lectura) ───────────────────────────────────────────

async function existeColumna(consultar, tabla, columna) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[tabla, columna],
	);
	return rows.length > 0;
}

async function existeTabla(consultar, tabla) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
		[tabla],
	);
	return rows.length > 0;
}

async function indiceExiste(consultar, tabla, indice) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
		[tabla, indice],
	);
	return rows.length > 0;
}

/** Nombres de índices UNIQUE de una sola columna `Nombre` en imRoles. */
async function indicesUnicosSoloNombre(consultar) {
	const rows = await consultar(
		`SELECT INDEX_NAME AS nombre, COUNT(*) AS columnas,
            SUM(CASE WHEN COLUMN_NAME = 'Nombre' THEN 1 ELSE 0 END) AS conNombre
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imRoles' AND NON_UNIQUE = 0
       AND INDEX_NAME <> 'PRIMARY'
     GROUP BY INDEX_NAME`,
	);
	return rows
		.filter((r) => Number(r.columnas) === 1 && Number(r.conNombre) === 1)
		.map((r) => String(r.nombre));
}

function errorEstado(statusCode, mensaje) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

/** Condiciones que deben cumplirse ANTES de tocar nada. Devuelve la lista de problemas. */
async function precondiciones(consultar = consultarPool) {
	const problemas = [];
	if (!(await existeTabla(consultar, 'imRoles'))) problemas.push('No existe la tabla imRoles');
	if (!(await existeTabla(consultar, 'imPersonalRoles'))) problemas.push('No existe la tabla imPersonalRoles');
	return problemas;
}

/**
 * Plan de instalación, en orden. Cada paso indica si ya está aplicado.
 * No modifica nada.
 * @returns {Promise<Array<{id:string, descripcion:string, sql:string, aplicado:boolean}>>}
 */
async function planificar(consultar = consultarPool) {
	const pasos = [];

	for (const [nombre, definicion] of COLUMNAS) {
		pasos.push({
			id: `columna:${nombre}`,
			descripcion: `Agregar columna imRoles.${nombre}`,
			sql: `ALTER TABLE \`imRoles\` ADD COLUMN \`${nombre}\` ${definicion}`,
			aplicado: await existeColumna(consultar, 'imRoles', nombre),
		});
	}

	// Primero el índice por empresa+nombre; recién después se borra el viejo (nunca sin protección).
	pasos.push({
		id: `indice:${INDICE_EMPRESA_NOMBRE}`,
		descripcion: 'Crear índice único por empresa y nombre (imRoles)',
		sql: `ALTER TABLE \`imRoles\` ADD UNIQUE INDEX \`${INDICE_EMPRESA_NOMBRE}\` (\`IdEmpresa\`, \`Nombre\`)`,
		aplicado: await indiceExiste(consultar, 'imRoles', INDICE_EMPRESA_NOMBRE),
	});
	for (const indice of await indicesUnicosSoloNombre(consultar)) {
		pasos.push({
			id: `quitar-indice:${indice}`,
			descripcion: `Eliminar índice único sólo por nombre (${indice})`,
			sql: `ALTER TABLE \`imRoles\` DROP INDEX \`${indice}\``,
			aplicado: false,
		});
	}

	const tablas = [
		['imRolPermisosCustom', 'Crear tabla imRolPermisosCustom', DDL_PERMISOS_CUSTOM],
		['imAuditoria', 'Crear tabla imAuditoria (historial general)', auditoria.DDL_TABLA],
		['imFeatureFlags', 'Crear tabla imFeatureFlags (activación por empresa)', featureFlags.DDL_TABLA],
	];
	for (const [tabla, descripcion, sql] of tablas) {
		pasos.push({
			id: `tabla:${tabla}`,
			descripcion,
			sql: sql.trim(),
			aplicado: await existeTabla(consultar, tabla),
		});
	}
	return pasos;
}

/**
 * Instala el esquema. Idempotente: si se corta a mitad, se puede volver a correr.
 * @param {Function} consultar función (sql, params) => rows
 * @param {{ simular?: boolean }} opciones con `simular` no ejecuta nada
 */
async function aplicar(consultar = consultarPool, { simular = false } = {}) {
	const problemas = await precondiciones(consultar);
	if (problemas.length) throw errorEstado(409, `Precondiciones no cumplidas: ${problemas.join('; ')}`);

	const pasos = await planificar(consultar);
	const ejecutados = [];
	const yaAplicados = [];

	for (const paso of pasos) {
		if (paso.aplicado) {
			yaAplicados.push(paso.id);
			continue;
		}
		if (paso.id.startsWith('quitar-indice:')) {
			// Red de seguridad: jamás quitar la unicidad vieja si la nueva no está.
			const hayNuevo =
				pasos.find((p) => p.id === `indice:${INDICE_EMPRESA_NOMBRE}`)?.aplicado ||
				ejecutados.includes(`indice:${INDICE_EMPRESA_NOMBRE}`);
			if (!hayNuevo) throw errorEstado(500, 'Se aborta: falta el índice nuevo antes de quitar el anterior');
		}
		if (!simular) await consultar(paso.sql);
		ejecutados.push(paso.id);
	}
	if (!simular) _reiniciarCache();
	return { simulado: simular, ejecutados, yaAplicados };
}

/**
 * Revierte lo específico de roles personalizados. Sólo si NO hay roles personalizados
 * ni permisos guardados. Deja imAuditoria e imFeatureFlags (son generales).
 */
async function revertir(consultar = consultarPool, { simular = false } = {}) {
	if (await existeColumna(consultar, 'imRoles', 'IdEmpresa')) {
		const [{ n }] = await consultar('SELECT COUNT(*) AS n FROM imRoles WHERE IdEmpresa <> 0');
		if (Number(n) > 0) {
			throw errorEstado(409, `No se puede revertir: hay ${n} rol(es) personalizado(s). Eliminalos primero.`);
		}
	}
	if (await existeTabla(consultar, 'imRolPermisosCustom')) {
		const [{ n }] = await consultar('SELECT COUNT(*) AS n FROM imRolPermisosCustom');
		if (Number(n) > 0) {
			throw errorEstado(409, 'No se puede revertir: imRolPermisosCustom tiene permisos guardados.');
		}
	}

	const pasos = [];
	if (!(await indiceExiste(consultar, 'imRoles', INDICE_NOMBRE_ORIGINAL))) {
		pasos.push({
			id: `indice:${INDICE_NOMBRE_ORIGINAL}`,
			sql: `ALTER TABLE \`imRoles\` ADD UNIQUE INDEX \`${INDICE_NOMBRE_ORIGINAL}\` (\`Nombre\`)`,
		});
	}
	if (await indiceExiste(consultar, 'imRoles', INDICE_EMPRESA_NOMBRE)) {
		pasos.push({
			id: `quitar-indice:${INDICE_EMPRESA_NOMBRE}`,
			sql: `ALTER TABLE \`imRoles\` DROP INDEX \`${INDICE_EMPRESA_NOMBRE}\``,
		});
	}
	for (const col of COLUMNAS_A_REVERTIR) {
		if (await existeColumna(consultar, 'imRoles', col)) {
			pasos.push({ id: `quitar-columna:${col}`, sql: `ALTER TABLE \`imRoles\` DROP COLUMN \`${col}\`` });
		}
	}
	if (await existeTabla(consultar, 'imRolPermisosCustom')) {
		pasos.push({ id: 'quitar-tabla:imRolPermisosCustom', sql: 'DROP TABLE `imRolPermisosCustom`' });
	}

	if (!simular) {
		for (const p of pasos) await consultar(p.sql);
		_reiniciarCache();
	}
	return { simulado: simular, ejecutados: pasos.map((p) => p.id) };
}

/** Estado actual, para informes. Sólo lectura. */
async function diagnosticar(consultar = consultarPool) {
	const pasos = await planificar(consultar);
	const [rolesTotal] = await consultar('SELECT COUNT(*) AS n FROM imRoles');
	let personalizados = 0;
	if (await existeColumna(consultar, 'imRoles', 'IdEmpresa')) {
		const [r] = await consultar('SELECT COUNT(*) AS n FROM imRoles WHERE IdEmpresa <> 0');
		personalizados = Number(r.n);
	}
	return {
		// Los pasos "quitar-indice" sólo existen mientras el índice viejo sigue presente.
		instalado: pasos.every((p) => p.aplicado),
		pasos,
		rolesTotal: Number(rolesTotal.n),
		rolesPersonalizados: personalizados,
	};
}

// ─── Uso en tiempo de ejecución (sólo lectura) ──────────────────────────────

/**
 * ¿Está instalado el esquema? Sólo lee information_schema (sin DDL).
 * Si es false se reconsulta como máximo una vez por minuto (otra persona puede
 * haber instalado mientras tanto).
 */
async function esquemaListo() {
	if (!isAuthCentralEnabled()) return false;
	if (listo) return true;
	const ahora = Date.now();
	if (ultimoChequeo && ahora - ultimoChequeo < REVISAR_CADA_MS) return false;
	ultimoChequeo = ahora;
	try {
		const ok =
			(await existeColumna(consultarPool, 'imRoles', 'IdEmpresa')) &&
			(await existeColumna(consultarPool, 'imRoles', 'RolBase')) &&
			(await existeTabla(consultarPool, 'imRolPermisosCustom')) &&
			(await auditoria.esquemaListo());
		listo = !!ok;
	} catch (e) {
		console.warn('[rolesCustomSchema] no se pudo verificar el esquema:', e.message);
		listo = false;
	}
	return listo;
}

/** Sólo para tests. */
function _reiniciarCache() {
	listo = false;
	ultimoChequeo = 0;
	auditoria._reiniciarCache();
}

module.exports = {
	COLUMNAS_A_REVERTIR,
	precondiciones,
	planificar,
	aplicar,
	revertir,
	diagnosticar,
	esquemaListo,
	_reiniciarCache,
};
