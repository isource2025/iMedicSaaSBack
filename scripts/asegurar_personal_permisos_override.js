#!/usr/bin/env node
/**
 * Crea imPersonalPermisosOverride si no existe (idempotente, sólo lectura si ya está).
 *   node scripts/asegurar_personal_permisos_override.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { DDL } = require('../src/services/personalPermisos.service');

(async () => {
	const uri = process.env.ESQUEMA_DB_URL || process.env.MYSQL_PUBLIC_URL;
	if (!uri) {
		console.error('Falta ESQUEMA_DB_URL o MYSQL_PUBLIC_URL');
		process.exit(2);
	}
	const conn = await mysql.createConnection({ uri, connectTimeout: 20000 });
	try {
		const [[{ base }]] = await conn.query('SELECT DATABASE() AS base');
		await conn.query(DDL);
		const [cols] = await conn.query(
			`SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imPersonalPermisosOverride'
       ORDER BY ORDINAL_POSITION`,
		);
		const [[cnt]] = await conn.query('SELECT COUNT(*) AS n FROM imPersonalPermisosOverride');
		console.log(`Base: ${base}`);
		console.log('Tabla imPersonalPermisosOverride OK');
		for (const c of cols) console.log(`  ${c.COLUMN_NAME}\t${c.COLUMN_TYPE}`);
		console.log(`Filas: ${cnt.n}`);
	} finally {
		await conn.end();
	}
})().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
