#!/usr/bin/env node
/**
 * Migración idempotente: IdEmpresa en imPassword, imPersonal, imPersonalSectores.
 * PK compuesta para que ids de Railway = ids del servidor físico por empresa.
 *
 * Uso: node scripts/apply_auth_idempresa.js
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.railway.local'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';

const OFFSET_LEGACY = 10_000_000;

(async () => {
	const { getAuthCentralPool } = require('../src/config/authCentralDb');
	const pool = await getAuthCentralPool();

	async function tieneColumna(tabla, col) {
		const [r] = await pool.query(
			`SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
			[tabla, col],
		);
		return Number(r[0].n) > 0;
	}

	async function pkCols(tabla) {
		const [r] = await pool.query(
			`SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
       ORDER BY SEQ_IN_INDEX`,
			[tabla],
		);
		return r.map((x) => String(x.c));
	}

	async function columnas(tabla) {
		const [r] = await pool.query(
			`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
			[tabla],
		);
		return r.map((x) => String(x.c));
	}

	async function limpiarOffsetLegacy() {
		const [emps] = await pool.query(
			`SELECT DISTINCT IdEmpresa FROM \`imPersonalEmpresas\` WHERE IdPersonal >= ?`,
			[OFFSET_LEGACY],
		);
		for (const row of emps) {
			const emp = Number(row.IdEmpresa);
			const base = emp * OFFSET_LEGACY;
			for (const [tabla, col] of [
				['imPersonalSectores', 'idPersonal'],
				['imPersonalEmpresas', 'IdPersonal'],
				['imPassword', 'ValorPersonal'],
				['imPersonal', 'Valor'],
			]) {
				const [del] = await pool.query(
					`DELETE FROM \`${tabla}\` WHERE \`${col}\` >= ? AND \`${col}\` < ?`,
					[base, base + OFFSET_LEGACY],
				);
				if (del.affectedRows) {
					console.log(`✓ Limpieza offset empresa ${emp}: ${tabla} → ${del.affectedRows}`);
				}
			}
		}
	}

	async function migrarTabla({ tabla, colId, pkEsperada, prePk = null }) {
		const pk = await pkCols(tabla);
		const pkOk = pk.length === pkEsperada.length &&
			pk.map((c) => c.toLowerCase()).join(',') === pkEsperada.map((c) => c.toLowerCase()).join(',');
		if (pkOk) {
			console.log(`• ${tabla}: PK ya es (${pkEsperada.join(', ')}).`);
			return;
		}

		if (!(await tieneColumna(tabla, 'IdEmpresa'))) {
			await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`IdEmpresa\` INT NOT NULL DEFAULT 1`);
			console.log(`✓ ${tabla}: columna IdEmpresa agregada.`);
		}

		const [upd1] = await pool.query(
			`
      UPDATE \`${tabla}\` t
      INNER JOIN (
        SELECT IdPersonal AS pid, MIN(IdEmpresa) AS emp
        FROM \`imPersonalEmpresas\`
        GROUP BY IdPersonal
        HAVING COUNT(*) = 1
      ) pe ON pe.pid = t.\`${colId}\`
      SET t.IdEmpresa = pe.emp
      WHERE t.\`${colId}\` IS NOT NULL
      `,
		);
		console.log(`✓ ${tabla}: backfill IdEmpresa (vínculo único) → ${upd1.affectedRows}`);

		const [upd0] = await pool.query(
			`
      UPDATE \`${tabla}\` t
      LEFT JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = t.\`${colId}\`
      SET t.IdEmpresa = 0
      WHERE pe.IdPersonal IS NULL AND t.IdEmpresa = 1 AND t.\`${colId}\` IS NOT NULL
      `,
		);
		if (upd0.affectedRows) {
			console.log(`✓ ${tabla}: sin vínculo → IdEmpresa=0 (${upd0.affectedRows}).`);
		}

		if (typeof prePk === 'function') await prePk();

		const cols = await columnas(tabla);
		const dataCols = cols.filter((c) => c.toLowerCase() !== 'idempresa');
		const insertCols = [...dataCols, 'IdEmpresa'];
		const selectCols = dataCols.map((c) => `t.\`${c}\``).join(', ');
		const [dup] = await pool.query(
			`
      INSERT IGNORE INTO \`${tabla}\` (${insertCols.map((c) => `\`${c}\``).join(', ')})
      SELECT ${selectCols}, pe.IdEmpresa
      FROM \`${tabla}\` t
      INNER JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = t.\`${colId}\`
      WHERE pe.IdEmpresa != t.IdEmpresa AND t.\`${colId}\` IS NOT NULL
      `,
		);
		if (dup.affectedRows) {
			console.log(`✓ ${tabla}: duplicadas multi-empresa → ${dup.affectedRows}.`);
		}

		await pool.query('ALTER TABLE `' + tabla + '` MODIFY `' + colId + '` INT NOT NULL');
		await pool.query(
			`ALTER TABLE \`${tabla}\` DROP PRIMARY KEY, ADD PRIMARY KEY (${pkEsperada.map((c) => `\`${c}\``).join(', ')})`,
		);
		console.log(`✓ ${tabla}: PK → (${pkEsperada.join(', ')}).`);
	}

	async function prePkImPassword() {
		const [fixVp] = await pool.query(
			`
      UPDATE \`imPassword\`
      SET \`ValorPersonal\` = CAST(\`CodOperador\` AS UNSIGNED)
      WHERE \`ValorPersonal\` IS NULL AND \`CodOperador\` REGEXP '^[0-9]+$'
      `,
		);
		if (fixVp.affectedRows) {
			console.log(`✓ imPassword: ValorPersonal ← CodOperador (${fixVp.affectedRows}).`);
		}
		const [delNull] = await pool.query('DELETE FROM `imPassword` WHERE `ValorPersonal` IS NULL');
		if (delNull.affectedRows) {
			console.log(`✓ imPassword: sin ValorPersonal eliminadas (${delNull.affectedRows}).`);
		}
		await pool.query(
			`
      DELETE pw FROM \`imPassword\` pw
      INNER JOIN \`imPassword\` pw2
        ON pw2.IdEmpresa = pw.IdEmpresa AND pw2.ValorPersonal = pw.ValorPersonal
       AND pw2.CodOperador < pw.CodOperador
      `,
		);
		console.log('✓ imPassword: duplicados depurados.');
	}

	console.log('=== Limpieza offset legacy ===');
	await limpiarOffsetLegacy();

	console.log('\n=== imPersonal ===');
	await migrarTabla({ tabla: 'imPersonal', colId: 'Valor', pkEsperada: ['IdEmpresa', 'Valor'] });

	console.log('\n=== imPassword ===');
	await migrarTabla({
		tabla: 'imPassword',
		colId: 'ValorPersonal',
		pkEsperada: ['IdEmpresa', 'ValorPersonal'],
		prePk: prePkImPassword,
	});

	console.log('\n=== imPersonalSectores ===');
	const pkPs = await pkCols('imPersonalSectores');
	if (pkPs.map((c) => c.toLowerCase()).join(',') !== 'idempresa,idpersonal,idsector') {
		if (!(await tieneColumna('imPersonalSectores', 'IdEmpresa'))) {
			await pool.query('ALTER TABLE `imPersonalSectores` ADD COLUMN `IdEmpresa` INT NOT NULL DEFAULT 1');
		}
		const [updPs] = await pool.query(
			`
      UPDATE \`imPersonalSectores\` ps
      INNER JOIN (
        SELECT IdPersonal AS pid, MIN(IdEmpresa) AS emp FROM \`imPersonalEmpresas\`
        GROUP BY IdPersonal HAVING COUNT(*) = 1
      ) pe ON pe.pid = ps.idPersonal
      SET ps.IdEmpresa = pe.emp
      `,
		);
		console.log(`✓ imPersonalSectores: backfill → ${updPs.affectedRows}`);
		const [dupPs] = await pool.query(
			`
      INSERT IGNORE INTO \`imPersonalSectores\` (idPersonal, idSector, IdEmpresa)
      SELECT ps.idPersonal, ps.idSector, pe.IdEmpresa
      FROM \`imPersonalSectores\` ps
      INNER JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = ps.idPersonal
      WHERE pe.IdEmpresa != ps.IdEmpresa
      `,
		);
		if (dupPs.affectedRows) console.log(`✓ imPersonalSectores: multi-empresa → ${dupPs.affectedRows}`);
		await pool.query(
			'ALTER TABLE `imPersonalSectores` DROP PRIMARY KEY, ADD PRIMARY KEY (`IdEmpresa`, `idPersonal`, `idSector`)',
		);
		console.log('✓ imPersonalSectores: PK migrada.');
	} else {
		console.log('• imPersonalSectores: PK ya migrada.');
	}

	const [stats] = await pool.query(
		`SELECT
      (SELECT COUNT(*) FROM imPersonal) AS personal,
      (SELECT COUNT(DISTINCT IdEmpresa) FROM imPersonal) AS emp_personal,
      (SELECT COUNT(*) FROM imPassword) AS passwords,
      (SELECT COUNT(DISTINCT IdEmpresa) FROM imPassword) AS emp_pass`,
	);
	console.log('\nEstado final:', stats[0]);
	await pool.end();
})().catch((e) => {
	console.error('✗ Error:', e.message || e);
	process.exit(1);
});
