#!/usr/bin/env node
/**
 * Graba Empresas.PacsUrl en Super Admin (MySQL platform).
 *
 *   node scripts/tunnel/set-pacs-url.js --empresa 101 --url https://pacs-sarmiento.imedic.com.ar
 *   node scripts/tunnel/set-pacs-url.js --clinica sarmiento --url https://pacs-sarmiento.imedic.com.ar
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const publicUrl = process.env.MYSQL_PUBLIC_URL || '';
if (publicUrl.startsWith('mysql://')) {
	const u = new URL(publicUrl);
	process.env.AUTH_DB_HOST = u.hostname;
	process.env.AUTH_DB_PORT = u.port || '3306';
	process.env.AUTH_DB_USER = decodeURIComponent(u.username);
	process.env.AUTH_DB_PASSWORD = decodeURIComponent(u.password);
	process.env.AUTH_DB_NAME = (u.pathname || '/railway').replace(/^\//, '') || 'railway';
}
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const args = process.argv.slice(2);
function flag(name) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : '';
}

const clinica = String(flag('clinica') || '').trim().toLowerCase();
const url = String(flag('url') || '').trim().replace(/\/+$/, '');
const empresaFlag = flag('empresa');

if (!url || !/^https:\/\//i.test(url)) {
	console.error('Falta --url https://pacs-<clinica>.imedic.com.ar');
	process.exit(1);
}

const platformMysql = require('../../src/services/platformMysql.service');
const { getAuthCentralPool } = require('../../src/config/authCentralDb');

async function resolverEmpresaId(pool) {
	if (empresaFlag) {
		const id = Number(empresaFlag);
		if (!Number.isFinite(id) || id <= 0) throw new Error(`--empresa invalido: ${empresaFlag}`);
		return id;
	}
	if (!clinica) throw new Error('Falta --clinica <slug> o --empresa <id>');
	const [rows] = await pool.query(
		`SELECT IDEMPRESA, DESCRIPCION FROM Empresas
     WHERE LOWER(TRIM(DESCRIPCION)) LIKE ?
        OR LOWER(TRIM(DESCRIPCION)) = ?
     ORDER BY IDEMPRESA`,
		[`%${clinica}%`, clinica],
	);
	if (!rows.length) throw new Error(`No hay empresa que coincida con "${clinica}".`);
	if (rows.length > 1) {
		console.log('Varias coincidencias:');
		for (const r of rows) console.log(`  ${r.IDEMPRESA}  ${r.DESCRIPCION}`);
		throw new Error('Ambiguo: pasa --empresa <id>.');
	}
	return Number(rows[0].IDEMPRESA);
}

async function main() {
	const pool = await getAuthCentralPool();
	const id = await resolverEmpresaId(pool);
	const antes = await platformMysql.obtenerEmpresaRow(id);
	if (!antes) throw new Error(`Empresa ${id} no existe`);

	await platformMysql.guardarConexionEmpresa(id, { pacsUrl: url });
	const despues = await platformMysql.obtenerEmpresaRow(id);
	console.log(`OK empresa ${id} (${antes.DESCRIPCION})`);
	console.log(`  PacsUrl: ${despues.PacsUrl || '(vacio)'}`);
	process.exit(0);
}

main().catch((e) => {
	console.error(e.message || e);
	process.exit(1);
});
