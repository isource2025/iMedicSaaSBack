const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');

/**
 * Esquema de dbo.imNotificaciones por tenant.
 * Cada hospital tiene su SQL: no se puede cachear ni crear la tabla "una sola vez"
 * a nivel proceso (eso cruzaba esquemas y terminaba en 500).
 */

const cacheByTenant = new Map();
const ensuredByTenant = new Map();
const inflightByTenant = new Map();

const EXTRA_COLUMNS = [
	['ValorPersonal', 'INT NULL'],
	['TipoNotificacion', 'VARCHAR(50) NULL'],
	['DescNotificacion', 'VARCHAR(250) NULL'],
	['EntidadTipo', 'VARCHAR(50) NULL'],
	['EntidadId', 'INT NULL'],
	['DatosJSON', 'NVARCHAR(MAX) NULL'],
	['Leida', 'BIT NULL'],
	['FechaCarga', 'DATETIME NULL'],
	['MostrarHasta', 'DATETIME NULL'],
	['Marca', 'VARCHAR(20) NULL'],
];

function tenantKey() {
	const id = getTenantId();
	return id != null && Number.isFinite(Number(id)) && Number(id) > 0 ? String(id) : 'default';
}

function sqlEscapeIdent(name) {
	const n = String(name || '').replace(/]/g, '');
	if (!n) throw new Error('Nombre de columna vacío');
	return `[${n}]`;
}

function hasName(names, want) {
	if (!want || !names || !names.length) return false;
	const l = String(want).toLowerCase();
	return names.some((n) => String(n).toLowerCase() === l);
}

function pick(names, predicates) {
	const lower = names.map((n) => ({ n, l: String(n).toLowerCase() }));
	for (const pred of predicates) {
		const hit = lower.find((x) => pred(x.l, x.n));
		if (hit) return hit.n;
	}
	return null;
}

function exactOr(names, canonical) {
	const hit = (names || []).find((n) => String(n).toLowerCase() === String(canonical).toLowerCase());
	return hit || null;
}

async function tablaExiste() {
	try {
		const rows = await executeQuery(`SELECT OBJECT_ID(N'dbo.imNotificaciones', N'U') AS Id`);
		const row = rows?.[0] || {};
		return row.Id != null || row.id != null || row.ID != null;
	} catch (e) {
		console.warn('[notificaciones] No se pudo chequear imNotificaciones:', e.message);
		return false;
	}
}

async function ensureMissingColumns() {
	if (!(await tablaExiste())) return;
	for (const [name, ddl] of EXTRA_COLUMNS) {
		try {
			await executeQuery(`
				IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NOT NULL
				AND COL_LENGTH(N'dbo.imNotificaciones', N'${name}') IS NULL
					ALTER TABLE dbo.imNotificaciones ADD ${sqlEscapeIdent(name)} ${ddl};
			`);
		} catch (e) {
			console.warn(`[notificaciones] No se pudo agregar ${name}:`, e.message);
		}
	}
	const indexes = [
		['IX_imNotificaciones_ValorPersonal', 'ValorPersonal'],
		['IX_imNotificaciones_Leida', 'Leida'],
		['IX_imNotificaciones_FechaCarga', 'FechaCarga'],
	];
	for (const [ixName, col] of indexes) {
		try {
			await executeQuery(`
				IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NOT NULL
				AND COL_LENGTH(N'dbo.imNotificaciones', N'${col}') IS NOT NULL
				AND NOT EXISTS (
					SELECT 1 FROM sys.indexes
					WHERE object_id = OBJECT_ID(N'dbo.imNotificaciones') AND name = N'${ixName}'
				)
					CREATE INDEX ${sqlEscapeIdent(ixName)} ON dbo.imNotificaciones (${sqlEscapeIdent(col)});
			`);
		} catch (e) {
			console.warn(`[notificaciones] Índice ${ixName} omitido:`, e.message);
		}
	}
}

async function ensureImNotificacionesTable() {
	const key = tenantKey();
	if (ensuredByTenant.get(key)) return true;

	if (!(await tablaExiste())) {
		try {
			await executeQuery(`
				IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NULL
				BEGIN
					CREATE TABLE dbo.imNotificaciones (
						IdNotificacion INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
						ValorPersonal INT NOT NULL,
						TipoNotificacion VARCHAR(50) NULL,
						DescNotificacion VARCHAR(250) NULL,
						EntidadTipo VARCHAR(50) NULL,
						EntidadId INT NULL,
						DatosJSON NVARCHAR(MAX) NULL,
						Leida BIT NOT NULL DEFAULT (0),
						FechaCarga DATETIME NOT NULL DEFAULT (GETDATE()),
						MostrarHasta DATETIME NULL,
						Marca VARCHAR(20) NULL
					);
				END
			`);
		} catch (e) {
			console.warn('[notificaciones] No se pudo crear imNotificaciones:', e.message);
		}
	}

	await ensureMissingColumns();
	const ok = await tablaExiste();
	if (ok) ensuredByTenant.set(key, true);
	return ok;
}

async function loadColumnsFromDb() {
	try {
		const rows = await executeQuery(
			`
			SELECT COLUMN_NAME AS c
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imNotificaciones'
			ORDER BY ORDINAL_POSITION
			`,
			[],
		);
		return (rows || []).map((r) => r.c).filter(Boolean);
	} catch (e) {
		console.warn('[notificacionesColumns] No se pudo leer INFORMATION_SCHEMA:', e.message);
		return null;
	}
}

function mapColumns(names) {
	const id =
		pick(names, [
			(l) => l === 'idnotificacion',
			(l) => l.startsWith('id') && l.includes('notif'),
			(l) => l === 'id',
		]) || exactOr(names, 'IdNotificacion');

	const valorPersonal = pick(names, [
		(l) => l === 'valorpersonal',
		(l) => l === 'idvalorpersonal' || l === 'valor_personal' || l === 'id_usuario_destino',
		(l) => l.includes('valor') && l.includes('personal'),
		(l) => l === 'vp' || l === 'idusuario' || l === 'id_usuario',
		(l) => l.includes('destinatario'),
		(l) =>
			(l.includes('usuario') || l.includes('operador') || l.includes('personal')) &&
			!l.includes('fecha') &&
			!l.includes('carga') &&
			!l.includes('notificacion') &&
			l !== 'idnotificacion',
	]);

	const leida = pick(names, [
		(l) => l === 'leida' || l === 'leido',
		(l) => l.includes('leida') || l.includes('leido'),
		(l) => l === 'visto' || l === 'leido_notif',
		(l) => l.includes('read') && !l.includes('thread') && !l.includes('already'),
	]);

	const fechaCarga =
		pick(names, [
			(l) => l === 'fechacarga' || l === 'fecha_carga',
			(l) => l.includes('fechacarga'),
			(l) => l.includes('fecha') && (l.includes('alta') || l.includes('crea')),
			(l) => l === 'fecha' || l === 'fechahora',
		]) || exactOr(names, 'FechaCarga');

	const descNotificacion =
		pick(names, [
			(l) => l === 'descnotificacion' || l === 'descripcion',
			(l) => l.includes('desc') && l.includes('notif'),
			(l) => l === 'mensaje' || l === 'texto' || l === 'detalle',
		]) || exactOr(names, 'DescNotificacion');

	const tipoNotificacion =
		pick(names, [
			(l) => l === 'tiponotificacion' || l === 'tipo_notificacion',
			(l) => l.includes('tipo') && l.includes('notif'),
			(l) => l === 'tipo',
		]) || exactOr(names, 'TipoNotificacion');

	const entidadTipo =
		pick(names, [(l) => l === 'entidadtipo' || l === 'tipoentidad', (l) => l.includes('entidad') && l.includes('tipo')]) ||
		exactOr(names, 'EntidadTipo');

	const entidadId =
		pick(names, [(l) => l === 'entidadid' || l === 'identidad', (l) => l.includes('entidad') && l.includes('id')]) ||
		exactOr(names, 'EntidadId');

	const datosJson =
		pick(names, [
			(l) => l === 'datosjson' || l === 'datos_json',
			(l) => l.includes('json'),
			(l) => l.includes('datos') && l.includes('extra'),
		]) || exactOr(names, 'DatosJSON');

	return {
		id,
		valorPersonal,
		leida,
		fechaCarga,
		descNotificacion,
		tipoNotificacion,
		entidadTipo,
		entidadId,
		datosJson,
	};
}

async function resolveForTenant() {
	await ensureImNotificacionesTable();

	const names = await loadColumnsFromDb();
	if (!names || names.length === 0) {
		console.warn('[notificaciones] Tabla dbo.imNotificaciones no encontrada o sin columnas.');
		return { usable: false };
	}

	const envId = process.env.NOTIFICACIONES_COL_ID;
	const envVp = process.env.NOTIFICACIONES_COL_VALOR_PERSONAL;
	const envLeida = process.env.NOTIFICACIONES_COL_LEIDA;
	const envFecha = process.env.NOTIFICACIONES_COL_FECHA;
	const envDesc = process.env.NOTIFICACIONES_COL_DESC;
	const envTipo = process.env.NOTIFICACIONES_COL_TIPO;
	const envEntTipo = process.env.NOTIFICACIONES_COL_ENTIDAD_TIPO;
	const envEntId = process.env.NOTIFICACIONES_COL_ENTIDAD_ID;
	const envJson = process.env.NOTIFICACIONES_COL_DATOS_JSON;

	const discovered = mapColumns(names);

	const valorPersonal =
		envVp && hasName(names, envVp) ? names.find((n) => String(n).toLowerCase() === envVp.toLowerCase()) : discovered.valorPersonal;
	const leida =
		envLeida && hasName(names, envLeida)
			? names.find((n) => String(n).toLowerCase() === envLeida.toLowerCase())
			: discovered.leida;

	if (!valorPersonal || !leida) {
		console.warn(
			'[notificaciones] imNotificaciones sin columnas reconocidas para usuario/leída. Defina NOTIFICACIONES_COL_VALOR_PERSONAL y NOTIFICACIONES_COL_LEIDA en .env',
		);
		return { usable: false, names };
	}

	const pickEnv = (envVal, discoveredVal) =>
		envVal && hasName(names, envVal)
			? names.find((n) => String(n).toLowerCase() === envVal.toLowerCase())
			: discoveredVal;

	return {
		usable: true,
		names,
		id: pickEnv(envId, discovered.id),
		valorPersonal,
		leida,
		fechaCarga: pickEnv(envFecha, discovered.fechaCarga),
		descNotificacion: pickEnv(envDesc, discovered.descNotificacion),
		tipoNotificacion: pickEnv(envTipo, discovered.tipoNotificacion),
		entidadTipo: pickEnv(envEntTipo, discovered.entidadTipo),
		entidadId: pickEnv(envEntId, discovered.entidadId),
		datosJson: pickEnv(envJson, discovered.datosJson),
	};
}

async function resolveImNotificacionesColumns() {
	const key = tenantKey();
	if (cacheByTenant.has(key)) return cacheByTenant.get(key);
	if (inflightByTenant.has(key)) return inflightByTenant.get(key);

	const pending = resolveForTenant()
		.then((cols) => {
			cacheByTenant.set(key, cols);
			return cols;
		})
		.catch((e) => {
			console.warn('[notificaciones] resolve esquema:', e.message);
			const fallback = { usable: false };
			cacheByTenant.set(key, fallback);
			return fallback;
		})
		.finally(() => {
			inflightByTenant.delete(key);
		});

	inflightByTenant.set(key, pending);
	return pending;
}

module.exports = {
	resolveImNotificacionesColumns,
	sqlEscapeIdent,
	ensureImNotificacionesTable,
};
