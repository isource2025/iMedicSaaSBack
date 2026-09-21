/**
 * Restaura Patch desde backup del 20/09 para filas Clarion tocadas por el masivo.
 * NO toca filas SaaS (PatchServidor en E:\adjuntos o E:\imagenes\vidal).
 *
 *   node scripts/revertir_patch_desde_backup.js --empresa 1 --dry-run
 *   node scripts/revertir_patch_desde_backup.js --empresa 1 --apply
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

const BAK = 'E:\\Backups\\iSource_20260920_20000.bak';
const TMP_DB = 'iSource_revert_20260920';
const MIN_ID = 156573; // cursor final del masivo (inclusive rango tocado)

function isSaasPs(ps) {
	const p = String(ps || '').replace(/\//g, '\\');
	return (
		/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(p) ||
		/^[A-Za-z]:\\imagenes\\vidal\\/i.test(p)
	);
}

(async () => {
	console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY-RUN');
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=?', [EMPRESA]);
	const emp = normalizeEmpresaRow(er[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	const pool = await sql.connect({
		server: String(emp.DbServer).trim(),
		port: Number(emp.DbPort) || 1433,
		database: 'master',
		user: String(emp.DbUser).trim(),
		password,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 600000,
	});

	const q = async (t, inputs = []) => {
		const req = pool.request();
		for (const [n, type, v] of inputs) req.input(n, type, v);
		return (await req.query(t)).recordset;
	};

	console.log('1) FILELISTONLY backup…');
	const files = await q(`RESTORE FILELISTONLY FROM DISK = N'${BAK}'`);
	console.table(
		files.map((f) => ({
			LogicalName: f.LogicalName,
			Type: f.Type,
			PhysicalName: f.PhysicalName,
		})),
	);

	const data = files.find((f) => f.Type === 'D');
	const log = files.find((f) => f.Type === 'L');
	if (!data || !log) throw new Error('No se encontraron logical names data/log en el bak');

	// Mismos directorios que el físico actual, nombres distintos
	const dataDir = String(data.PhysicalName).replace(/[^\\]+$/, '');
	const logDir = String(log.PhysicalName).replace(/[^\\]+$/, '');
	const newData = `${dataDir}${TMP_DB}.mdf`;
	const newLog = `${logDir}${TMP_DB}_log.ldf`;

	const exists = await q(`SELECT name FROM sys.databases WHERE name = N'${TMP_DB}'`);
	if (exists.length) {
		console.log(`2) ${TMP_DB} ya existe — la reuso (no restauro de nuevo)`);
	} else {
		console.log('2) Restaurando backup como', TMP_DB);
		console.log('   data →', newData);
		console.log('   log  →', newLog);
		await pool.request().query(`
			RESTORE DATABASE [${TMP_DB}]
			FROM DISK = N'${BAK}'
			WITH
				MOVE N'${data.LogicalName}' TO N'${newData}',
				MOVE N'${log.LogicalName}' TO N'${newLog}',
				NORECOVERY, REPLACE, STATS = 10
		`);
		await pool.request().query(`RESTORE DATABASE [${TMP_DB}] WITH RECOVERY`);
		console.log('   Restore OK');
	}

	console.log('3) Comparar Patch live vs backup (muestra)…');
	const sample = await q(`
		SELECT TOP 10
			live.IdAdjunto,
			LEFT(bak.Patch, 70) AS PatchBackup,
			LEFT(live.Patch, 70) AS PatchLive,
			LEFT(live.PatchServidor, 70) AS PatchServidor
		FROM [${TMP_DB}].dbo.imPedidosEstudiosAdjuntos bak
		INNER JOIN [iSource].dbo.imPedidosEstudiosAdjuntos live
			ON live.IdAdjunto = bak.IdAdjunto
		WHERE live.IdAdjunto >= ${MIN_ID}
		  AND (
		    live.Patch LIKE '\\\\SERVER\\Imagenes\\%'
		    OR live.Patch LIKE '\\\\server\\Imagenes\\%'
		  )
		  AND ISNULL(bak.Patch, '') <> ISNULL(live.Patch, '')
		ORDER BY live.IdAdjunto DESC
	`);
	console.table(sample);

	const counts = await q(`
		SELECT
			COUNT(*) AS candidatas,
			SUM(CASE WHEN bak.Patch LIKE '[A-Z]:\\%' OR bak.Patch LIKE '\\\\192.%' THEN 1 ELSE 0 END) AS bakLocalOIp,
			SUM(CASE WHEN live.PatchServidor LIKE '[A-Z]:\\adjuntos\\%'
			          OR live.PatchServidor LIKE '[A-Z]:\\imedic\\adjuntos\\%'
			          OR live.PatchServidor LIKE '[A-Z]:\\imagenes\\vidal\\%' THEN 1 ELSE 0 END) AS saasDisk
		FROM [${TMP_DB}].dbo.imPedidosEstudiosAdjuntos bak
		INNER JOIN [iSource].dbo.imPedidosEstudiosAdjuntos live
			ON live.IdAdjunto = bak.IdAdjunto
		WHERE live.IdAdjunto >= ${MIN_ID}
		  AND (
		    live.Patch LIKE '\\\\SERVER\\Imagenes\\%'
		    OR live.Patch LIKE '\\\\server\\Imagenes\\%'
		  )
		  AND ISNULL(bak.Patch, '') <> ISNULL(live.Patch, '')
		  AND LTRIM(RTRIM(ISNULL(bak.Patch, ''))) <> ''
		  AND NOT (
		    live.PatchServidor LIKE '[A-Z]:\\adjuntos\\%'
		    OR live.PatchServidor LIKE '[A-Z]:\\imedic\\adjuntos\\%'
		    OR live.PatchServidor LIKE '[A-Z]:\\imagenes\\vidal\\%'
		  )
	`);
	console.log('Candidatas a revertir (Clarion, no SaaS):', counts[0]);

	if (!APPLY) {
		console.log('\nDry-run OK. Para aplicar: --apply');
		console.log(`Luego dropear: DROP DATABASE [${TMP_DB}]`);
		await pool.close();
		await mp.end();
		return;
	}

	console.log('4) Revirtiendo Patch desde backup (excluye SaaS)…');
	const result = await pool.request().query(`
		UPDATE live
		SET live.Patch = bak.Patch
		FROM [iSource].dbo.imPedidosEstudiosAdjuntos live
		INNER JOIN [${TMP_DB}].dbo.imPedidosEstudiosAdjuntos bak
			ON bak.IdAdjunto = live.IdAdjunto
		WHERE live.IdAdjunto >= ${MIN_ID}
		  AND (
		    live.Patch LIKE '\\\\SERVER\\Imagenes\\%'
		    OR live.Patch LIKE '\\\\server\\Imagenes\\%'
		  )
		  AND ISNULL(bak.Patch, '') <> ISNULL(live.Patch, '')
		  AND LTRIM(RTRIM(ISNULL(bak.Patch, ''))) <> ''
		  AND NOT (
		    live.PatchServidor LIKE '[A-Z]:\\adjuntos\\%'
		    OR live.PatchServidor LIKE '[A-Z]:\\imedic\\adjuntos\\%'
		    OR live.PatchServidor LIKE '[A-Z]:\\imagenes\\vidal\\%'
		  )
	`);
	console.log('rowsAffected:', result.rowsAffected);

	const after = await q(`
		SELECT TOP 5
			live.IdAdjunto,
			LEFT(live.Patch, 80) AS Patch,
			LEFT(live.PatchServidor, 80) AS PS
		FROM [iSource].dbo.imPedidosEstudiosAdjuntos live
		WHERE live.IdAdjunto IN (166818, 166817, 166819, 161472)
		ORDER BY live.IdAdjunto DESC
	`);
	console.log('Verificación post-revert:');
	console.table(after);

	console.log(`\n5) DROP DATABASE [${TMP_DB}]…`);
	await pool.request().query(`
		ALTER DATABASE [${TMP_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
		DROP DATABASE [${TMP_DB}];
	`);
	console.log('Listo.');

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
