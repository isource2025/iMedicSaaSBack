#!/usr/bin/env node
/**
 * Aplica de forma idempotente la migración multi-tenant de imSectores en Railway:
 *   1) agrega columna IdEmpresa (default 1) si no existe
 *   2) backfillea filas sin empresa → 1
 *   3) reemplaza la PK (Valor) por (IdEmpresa, Valor)
 *
 * Uso (local contra Railway público):
 *   node scripts/apply_imsectores_idempresa.js
 * Requiere .env.railway.local con host/puerto/credenciales públicas de MySQL.
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.railway.local'), override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';

(async () => {
	const { getAuthCentralPool } = require('../src/config/authCentralDb');
	const pool = await getAuthCentralPool();

	async function tieneColumna(col) {
		const [r] = await pool.query(
			`SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imSectores' AND COLUMN_NAME = ?`,
			[col],
		);
		return Number(r[0].n) > 0;
	}

	async function pkCols() {
		const [r] = await pool.query(
			`SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imSectores' AND INDEX_NAME = 'PRIMARY'
       ORDER BY SEQ_IN_INDEX`,
		);
		return r.map((x) => String(x.c));
	}

	// 1) columna
	if (await tieneColumna('IdEmpresa')) {
		console.log('• Columna IdEmpresa ya existe, se omite ADD COLUMN.');
	} else {
		await pool.query('ALTER TABLE `imSectores` ADD COLUMN `IdEmpresa` INT NOT NULL DEFAULT 1');
		console.log('✓ Columna IdEmpresa agregada (default 1).');
	}

	// 2) backfill
	const [upd] = await pool.query(
		'UPDATE `imSectores` SET `IdEmpresa` = 1 WHERE `IdEmpresa` IS NULL OR `IdEmpresa` = 0',
	);
	console.log(`✓ Backfill IdEmpresa=1: ${upd.affectedRows} fila(s) ajustadas.`);

	// 3) PK compuesta
	const pk = await pkCols();
	const yaCompuesta = pk.length === 2 && pk.map((c) => c.toLowerCase()).join(',') === 'idempresa,valor';
	if (yaCompuesta) {
		console.log('• PK ya es (IdEmpresa, Valor), se omite cambio de PK.');
	} else {
		await pool.query('ALTER TABLE `imSectores` DROP PRIMARY KEY, ADD PRIMARY KEY (`IdEmpresa`, `Valor`)');
		console.log('✓ PK cambiada a (IdEmpresa, Valor).');
	}

	const [check] = await pool.query(
		`SELECT COUNT(*) AS n, COUNT(DISTINCT IdEmpresa) AS empresas FROM \`imSectores\``,
	);
	console.log(`\nEstado imSectores: ${check[0].n} filas, ${check[0].empresas} empresa(s).`);
	console.log('PK final:', (await pkCols()).join(', '));
	await pool.end();
	process.exit(0);
})().catch((e) => {
	console.error('✗ Error aplicando migración:', e.message || e);
	process.exit(1);
});
