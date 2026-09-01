#!/usr/bin/env node
/**
 * Audita (solo lectura) el mapeo de columnas de la HC de ingreso del front
 * contra las columnas reales de dbo.imHCI de un tenant.
 *
 *   node scripts/auditar_mapeo_hci.js            # empresa 1
 *   node scripts/auditar_mapeo_hci.js 101
 *
 * Reporta dos clases de error:
 *   - columnas que el front LEE y no existen     -> el campo aparece vacío en el formulario
 *   - columnas que el front ESCRIBE y no existen -> el backend las descarta con warning
 *
 * Desde que el backend valida contra INFORMATION_SCHEMA, una columna inventada
 * ya no rompe el guardado entero: se descarta y el resto se guarda igual.
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const {
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const ID_EMPRESA = Number(process.argv[2] || 1);
const HELPERS = path.resolve(
	__dirname,
	'../../iMedicSaaSFront/src/app/utils/examenFisicoHelpers.ts',
);

// El backend traduce nombres del cliente a columnas reales (COLUMN_NAME_MAP en
// hcIngreso.service.js); acá alcanza el único que usa el front actual.
const COLUMN_NAME_MAP = { SN_PARESCRANEANOS: 'SN _PARESCRANEANOS' };

(async () => {
	if (!fs.existsSync(HELPERS)) throw new Error(`No encuentro ${HELPERS}`);
	const src = fs.readFileSync(HELPERS, 'utf8');
	const iRead = src.indexOf('mapearHCIaExamenFisico');
	const iWrite = src.indexOf('mapearExamenFisicoAHCI');
	const iEnd = src.indexOf('export const getEmptyExamenFisico');
	if (iRead < 0 || iWrite < 0 || iEnd < 0) throw new Error('No pude ubicar los mapeos en el helper');

	const lee = new Set();
	for (const m of src.slice(iRead, iWrite).matchAll(/record\.([A-Za-z0-9_]+)/g)) lee.add(m[1]);
	const escribe = new Set();
	for (const m of src.slice(iWrite, iEnd).matchAll(/datos\.([A-Za-z0-9_]+)\s*=/g)) escribe.add(m[1]);

	const mysql = await getAuthCentralPool();
	const [emps] = await mysql.query(`SELECT * FROM Empresas WHERE IDEMPRESA = ?`, [ID_EMPRESA]);
	await mysql.end();
	if (!emps.length) throw new Error(`Empresa ${ID_EMPRESA} no encontrada`);
	const emp = normalizeEmpresaRow(emps[0]);

	const pool = await new sql.ConnectionPool({
		server: String(emp.DbServer),
		port: Number(emp.DbPort) || 1433,
		user: String(emp.DbUser),
		password: resolvePasswordFromEmpresaRow(emp),
		database: String(emp.DbName),
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 20000,
		requestTimeout: 120000,
	}).connect();

	const cols = (
		await pool.request().query(
			`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imHCI'`,
		)
	).recordset.map((r) => r.COLUMN_NAME);
	await pool.close();

	const real = new Set(cols);
	const existe = (k) => real.has(COLUMN_NAME_MAP[k] || k);

	console.log(`=== ${emp.DESCRIPCION} (empresa ${ID_EMPRESA}) / ${emp.DbName}.dbo.imHCI ===`);
	console.log(`columnas reales: ${cols.length} | front lee: ${lee.size} | front escribe: ${escribe.size}\n`);

	const leeMal = [...lee].filter((k) => !existe(k) && !k.startsWith('CTRL_')).sort();
	const escribeMal = [...escribe].filter((k) => !existe(k)).sort();

	console.log(`LEE columnas inexistentes (${leeMal.length}) -> el campo siempre se ve vacío:`);
	console.log(`  ${leeMal.join(', ') || '(ninguna)'}\n`);
	console.log(`ESCRIBE columnas inexistentes (${escribeMal.length}) -> el backend las descarta:`);
	console.log(`  ${escribeMal.join(', ') || '(ninguna)'}`);

	const problemas = leeMal.length + escribeMal.length;
	console.log(`\n${problemas === 0 ? 'OK: mapeo consistente.' : `${problemas} problemas de mapeo.`}`);
	process.exit(problemas === 0 ? 0 : 1);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(2);
});
