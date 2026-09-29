/**
 * Esquema de roles personalizados (auth central, MySQL en Railway).
 *
 * Es ADITIVO e idempotente:
 *   - imRoles: columnas nuevas con valores por defecto (los roles existentes
 *     quedan como "del sistema": IdEmpresa = 0).
 *   - imRolPermisosCustom: permisos de cada rol personalizado (por código).
 *   - imRolesAuditoria: quién cambió qué.
 *
 * La migración NO se ejecuta al arrancar: sólo cuando un administrador crea el
 * primer rol personalizado (`asegurarEsquema`). Mientras no exista, todo el
 * sistema usa las consultas de siempre (`esquemaListo()` devuelve false).
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

const REVISAR_CADA_MS = 60 * 1000;

let listo = false;
let ultimoChequeo = 0;
let enCurso = null;

async function consultar(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function existeColumna(tabla, columna) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[tabla, columna],
	);
	return rows.length > 0;
}

async function existeTabla(tabla) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
		[tabla],
	);
	return rows.length > 0;
}

/**
 * ¿Está creado el esquema? Sólo lee information_schema (sin DDL).
 * Si es false se reconsulta como máximo una vez por minuto (otra instancia
 * puede haber migrado).
 */
async function esquemaListo() {
	if (!isAuthCentralEnabled()) return false;
	if (listo) return true;
	const ahora = Date.now();
	if (ultimoChequeo && ahora - ultimoChequeo < REVISAR_CADA_MS) return false;
	ultimoChequeo = ahora;
	try {
		const ok =
			(await existeColumna('imRoles', 'IdEmpresa')) &&
			(await existeColumna('imRoles', 'RolBase')) &&
			(await existeTabla('imRolPermisosCustom')) &&
			(await existeTabla('imRolesAuditoria'));
		listo = !!ok;
	} catch (e) {
		console.warn('[rolesCustomSchema] no se pudo verificar el esquema:', e.message);
		listo = false;
	}
	return listo;
}

/** Nombres de índices UNIQUE de una sola columna `Nombre` en imRoles. */
async function indicesUnicosSoloNombre() {
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

async function indiceExiste(tabla, indice) {
	const rows = await consultar(
		`SELECT 1 AS ok FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
		[tabla, indice],
	);
	return rows.length > 0;
}

async function migrar() {
	// 1) Columnas nuevas en imRoles (los roles existentes quedan como "sistema")
	const columnas = [
		['IdEmpresa', 'INT NOT NULL DEFAULT 0'],
		['RolBase', 'VARCHAR(30) NULL'],
		['CreadoPor', 'INT NULL'],
		['FechaCreacion', 'DATETIME NULL'],
		['FechaModificacion', 'DATETIME NULL'],
	];
	for (const [nombre, definicion] of columnas) {
		if (!(await existeColumna('imRoles', nombre))) {
			await consultar(`ALTER TABLE \`imRoles\` ADD COLUMN \`${nombre}\` ${definicion}`);
		}
	}

	// 2) Unicidad del nombre: por empresa (dos clínicas pueden repetir un nombre)
	if (!(await indiceExiste('imRoles', 'UQ_imRoles_Empresa_Nombre'))) {
		await consultar(
			'ALTER TABLE `imRoles` ADD UNIQUE INDEX `UQ_imRoles_Empresa_Nombre` (`IdEmpresa`, `Nombre`)',
		);
	}
	for (const indice of await indicesUnicosSoloNombre()) {
		await consultar(`ALTER TABLE \`imRoles\` DROP INDEX \`${indice}\``);
	}

	// 3) Permisos de roles personalizados (por código)
	await consultar(`
    CREATE TABLE IF NOT EXISTS \`imRolPermisosCustom\` (
      \`IdRol\` INT NOT NULL,
      \`Codigo\` VARCHAR(120) NOT NULL,
      PRIMARY KEY (\`IdRol\`, \`Codigo\`)
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

	// 4) Auditoría de cambios de roles y de asignaciones
	await consultar(`
    CREATE TABLE IF NOT EXISTS \`imRolesAuditoria\` (
      \`IdAuditoria\` BIGINT NOT NULL AUTO_INCREMENT,
      \`IdEmpresa\` INT NOT NULL,
      \`IdRol\` INT NULL,
      \`Accion\` VARCHAR(30) NOT NULL,
      \`Actor\` INT NULL,
      \`Fecha\` DATETIME NOT NULL,
      \`Detalle\` TEXT NULL,
      PRIMARY KEY (\`IdAuditoria\`),
      KEY \`IX_imRolesAuditoria_Rol\` (\`IdEmpresa\`, \`IdRol\`, \`Fecha\`)
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);
}

/** Crea el esquema si falta. Seguro de llamar varias veces y en paralelo. */
async function asegurarEsquema() {
	if (!isAuthCentralEnabled()) {
		const e = new Error('Los roles personalizados requieren la autenticación central');
		e.statusCode = 409;
		throw e;
	}
	if (listo) return true;
	if (!enCurso) {
		enCurso = migrar()
			.then(() => {
				listo = true;
				return true;
			})
			.finally(() => {
				enCurso = null;
			});
	}
	return enCurso;
}

/** Sólo para tests. */
function _reiniciarCache() {
	listo = false;
	ultimoChequeo = 0;
	enCurso = null;
}

module.exports = { esquemaListo, asegurarEsquema, _reiniciarCache };
