/**
 * Crea/actualiza vistas e imHCInterconsulta en la BD **tenant** (conexión dinámica Empresas),
 * no solo en DB_* del .env.
 *
 * Uso:
 *   node scripts/ejecutar_vw_pedidos_estudios.js
 *   EMPRESA_ID=1 node scripts/ejecutar_vw_pedidos_estudios.js
 *
 * Con AUTH_DB_ENABLED=1 recorre empresas del catálogo MySQL (agrupadas por conexión SQL).
 * Sin MySQL usa EMPRESA_ID / BOT_EMPRESA_ID / 1 contra tenantDb + fallback .env.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../src/config/database');
const authCentralService = require('../src/services/authCentral.service');
const {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
} = require('../src/config/tenantDb');

const FILTER_EMPRESA = process.env.EMPRESA_ID
	? Number(process.env.EMPRESA_ID)
	: Number(process.env.BOT_EMPRESA_ID || process.env.DEFAULT_EMPRESA_ID || 1);

const SQL_FILES = [
	'sql/create_vw_pedidos_estudios.sql',
	'sql/create_imhc_interconsulta.sql',
];

async function ejecutarSqlArchivo(pool, relativePath) {
	const filePath = path.join(__dirname, relativePath);
	if (!fs.existsSync(filePath)) throw new Error(`No existe ${relativePath}`);
	const sqlText = fs.readFileSync(filePath, 'utf8');
	const batches = sqlText.split(/\r?\nGO\r?\n/i).map((b) => b.trim()).filter(Boolean);
	for (const batch of batches) {
		await pool.request().query(batch);
	}
}

async function listarEmpresas() {
	if (authCentralService.isAuthCentralEnabled()) {
		const { getAuthCentralPool } = require('../config/authCentralDb');
		const pool = await getAuthCentralPool();
		const [rows] = await pool.query(
			`SELECT IDEMPRESA, DESCRIPCION FROM Empresas ORDER BY IDEMPRESA`,
		);
		return (rows || []).map((r) => ({
			idEmpresa: Number(r.IDEMPRESA),
			descripcion: r.DESCRIPCION,
		}));
	}

	try {
		const platformPool = await connectDB();
		const r = await platformPool.request().query(`
			SELECT IDEMPRESA, DESCRIPCION FROM dbo.Empresas ORDER BY IDEMPRESA
		`);
		return (r.recordset || []).map((row) => ({
			idEmpresa: Number(row.IDEMPRESA),
			descripcion: row.DESCRIPCION,
		}));
	} catch {
		return [{ idEmpresa: FILTER_EMPRESA, descripcion: '(env fallback)' }];
	}
}

function filtrarEmpresas(empresas) {
	if (process.env.EMPRESA_ID && Number.isFinite(FILTER_EMPRESA)) {
		return empresas.filter((e) => e.idEmpresa === FILTER_EMPRESA);
	}
	if (empresas.length) return empresas;
	return [{ idEmpresa: FILTER_EMPRESA, descripcion: '(default)' }];
}

async function agruparPorConexionTenant(empresas) {
	const groups = new Map();
	for (const emp of empresas) {
		try {
			const row = await loadEmpresaConnectionRow(emp.idEmpresa);
			const cfg = rowToSqlConfig(row);
			const key = configCacheKey(cfg);
			if (!groups.has(key)) {
				groups.set(key, {
					probeId: emp.idEmpresa,
					server: cfg.server,
					database: cfg.database,
					empresas: [],
				});
			}
			groups.get(key).empresas.push(emp);
		} catch (e) {
			console.warn(`  ! Empresa ${emp.idEmpresa}: sin conexión tenant (${e.message})`);
		}
	}
	return groups;
}

async function migrarTenant(probeId, meta) {
	console.log(
		`\n=== Tenant SQL: ${meta.server}/${meta.database} (probe empresa ${probeId}: ${meta.empresas.map((e) => e.idEmpresa).join(', ')}) ===`,
	);
	const pool = await getTenantPool(probeId);
	for (const rel of SQL_FILES) {
		console.log(`  • ${rel}`);
		await ejecutarSqlArchivo(pool, rel);
	}
	const check = await pool.request().query(`
		SELECT 'imagen' AS vista, COUNT(*) AS cnt FROM dbo.vw_iMedic_PedidosEstudiosImagen
		UNION ALL
		SELECT 'interconsultas', COUNT(*) FROM dbo.vw_iMedic_PedidosInterconsultas
	`);
	console.log('  Vistas OK:', check.recordset);
	const tab = await pool.request().query(`
		SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
		WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='imHCInterconsulta'
	`);
	console.log('  Tabla imHCInterconsulta:', Number(tab.recordset[0]?.n) > 0 ? 'existe' : 'NO existe');
}

(async () => {
	const empresas = filtrarEmpresas(await listarEmpresas());
	if (!empresas.length) {
		console.error('No hay empresas para migrar.');
		process.exit(1);
	}
	console.log(
		'Migración estudios/interconsultas en BD tenant (dinámica Empresas.DbServer/DbName)',
	);
	const groups = await agruparPorConexionTenant(empresas);
	if (!groups.size) {
		console.error('Ningún tenant con conexión SQL válida.');
		process.exit(1);
	}
	for (const [, meta] of groups) {
		await migrarTenant(meta.probeId, meta);
	}
	console.log('\nListo.');
	process.exit(0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
