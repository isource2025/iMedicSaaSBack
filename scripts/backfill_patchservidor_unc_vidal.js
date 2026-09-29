/**
 * Alinea PatchServidor de adjuntos web Vidal al UNC que Clarion sabe abrir.
 * No toca filas Clarion nativas (Patch en D:\ / F:\ / \\192.168).
 *
 *   node scripts/backfill_patchservidor_unc_vidal.js --empresa 1 --dry-run
 *   node scripts/backfill_patchservidor_unc_vidal.js --empresa 1 --apply
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EMPRESA = Number(
	(() => {
		const i = args.indexOf('--empresa');
		return i >= 0 ? args[i + 1] : 1;
	})(),
);

(async () => {
	console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY-RUN');
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=?', [EMPRESA]);
	const emp = normalizeEmpresaRow(er[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	const pool = await sql.connect({
		server: String(emp.DbServer).trim(),
		port: Number(emp.DbPort) || 1433,
		database: String(emp.DbName).trim(),
		user: String(emp.DbUser).trim(),
		password,
		options: { encrypt: false, trustServerCertificate: true },
	});

	const preview = (
		await pool.request().query(`
      SELECT TOP 15
        IdAdjunto, NumeroVisita,
        LEFT(Patch, 90) AS Patch,
        LEFT(PatchServidor, 90) AS PatchServidor
      FROM dbo.imPedidosEstudiosAdjuntos
      WHERE (
          Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
        )
        AND (
          PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
          OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE 'E:\\adjuntos\\%'
        )
      ORDER BY IdAdjunto DESC
    `)
	).recordset;

	const count = (
		await pool.request().query(`
      SELECT COUNT(*) AS n
      FROM dbo.imPedidosEstudiosAdjuntos
      WHERE (
          Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
        )
        AND (
          PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
          OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE 'E:\\adjuntos\\%'
        )
    `)
	).recordset[0];

	console.log(`Candidatas: ${count.n}`);
	console.table(preview);

	if (!APPLY) {
		console.log('\nDry-run OK. Repetí con --apply');
		await pool.close();
		await mp.end();
		return;
	}

	const result = await pool.request().query(`
    UPDATE dbo.imPedidosEstudiosAdjuntos
    SET PatchServidor = Patch
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND (
        PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
        OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE 'E:\\adjuntos\\%'
      )
  `);
	console.log('rowsAffected:', result.rowsAffected);

	const check = await pool.request().query(`
    SELECT IdAdjunto, LEFT(Patch, 90) AS Patch, LEFT(PatchServidor, 90) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE IdAdjunto IN (167660, 167678, 161472)
  `);
	console.log('Verificación:');
	console.table(check.recordset);

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
