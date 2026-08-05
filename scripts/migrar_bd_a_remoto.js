#!/usr/bin/env node
/**
 * Backup / restore de una base SQL Server para migrarla a otra PC.
 *
 * 1) En la PC origen (esta máquina):
 *    node scripts/migrar_bd_a_remoto.js backup
 *    node scripts/migrar_bd_a_remoto.js backup --db Sarmiento --out C:\backups
 *
 * 2) Copiá el .bak a la PC remota (USB / red / RDP).
 *
 * 3) En la PC remota (con SQL Server y este repo + .env apuntando al SQL remoto):
 *    node scripts/migrar_bd_a_remoto.js restore --bak "D:\backups\Sarmiento_YYYYMMDD.bak"
 *    node scripts/migrar_bd_a_remoto.js restore --bak "..." --db Sarmiento --data-dir "C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\DATA"
 *
 * Variables (.env origen / remoto):
 *   DB_SERVER, DB_PORT, DB_USER, DB_PASSWORD
 *   DB_NAME (default de --db)
 *
 * Notas:
 *   - El backup se hace en el filesystem del SERVIDOR SQL (no del cliente Node).
 *     Si SQL es local, --out puede ser una carpeta local (ej. C:\backups).
 *   - En restore, --data-dir debe existir en el servidor remoto y ser escribible por el servicio SQL.
 *   - Después del restore en remoto: node scripts/ejecutar_setup_saas_tenant.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return fallback;
}

function hasFlag(name) {
	return process.argv.includes(name);
}

const cmd = process.argv[2];
const DB_NAME = arg('--db', process.env.DB_NAME || 'Sarmiento');

function sqlCfg(database = 'master') {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database,
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 30000,
		requestTimeout: 0, // backup/restore pueden tardar
	};
}

function stamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function cmdBackup() {
	const outDir = arg('--out', path.join(process.cwd(), 'backups'));
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

	const bakName = `${DB_NAME}_${stamp()}.bak`;
	const bakPath = path.join(outDir, bakName);
	// SQL Server en Windows espera path con backslashes
	const bakSql = bakPath.replace(/\//g, '\\');

	console.log(`=== BACKUP ${DB_NAME} ===`);
	console.log(`Servidor: ${process.env.DB_SERVER || 'localhost'}`);
	console.log(`Destino:  ${bakSql}\n`);

	const pool = await sql.connect(sqlCfg('master'));
	try {
		const exists = await pool
			.request()
			.input('db', sql.NVarChar, DB_NAME)
			.query(`SELECT 1 AS ok FROM sys.databases WHERE name = @db`);
		if (!exists.recordset.length) {
			throw new Error(`No existe la base [${DB_NAME}] en el servidor`);
		}

		await pool.request().query(`
      BACKUP DATABASE [${DB_NAME}]
      TO DISK = N'${bakSql.replace(/'/g, "''")}'
      WITH COPY_ONLY, INIT, STATS = 10,
           NAME = N'iMedic backup ${DB_NAME}';
    `);

		const size = fs.existsSync(bakPath) ? (fs.statSync(bakPath).size / (1024 * 1024)).toFixed(1) : '?';
		console.log(`\n✓ Backup OK (${size} MB)`);
		console.log(`  Archivo: ${bakPath}`);
		console.log('\nSiguiente:');
		console.log('  1) Copiá el .bak a la PC remota');
		console.log(
			`  2) En remoto: node scripts/migrar_bd_a_remoto.js restore --bak "RUTA\\${bakName}" --db ${DB_NAME}`,
		);
	} finally {
		await pool.close();
		sql.close();
	}
}

async function defaultDataDir(pool) {
	const r = await pool.request().query(`
    SELECT TOP 1 physical_name
    FROM sys.master_files
    WHERE database_id = DB_ID('master') AND type_desc = 'ROWS'
  `);
	const p = r.recordset[0]?.physical_name || '';
	const dir = p.replace(/[^\\\/]+$/, '');
	return dir || `C:\\Program Files\\Microsoft SQL Server\\MSSQL15.MSSQLSERVER\\MSSQL\\DATA\\`;
}

async function cmdRestore() {
	const bak = arg('--bak', null);
	if (!bak) {
		throw new Error('Falta --bak "ruta\\al\\archivo.bak"');
	}
	const bakSql = path.resolve(bak).replace(/\//g, '\\');
	if (!fs.existsSync(bakSql)) {
		console.warn(`⚠ No se ve el archivo desde Node: ${bakSql}`);
		console.warn('  Si el .bak está en el servidor SQL (no en este cliente), igual se intentará restore.');
	}

	const replace = hasFlag('--replace');
	console.log(`=== RESTORE → [${DB_NAME}] ===`);
	console.log(`Servidor: ${process.env.DB_SERVER || 'localhost'}`);
	console.log(`Desde:    ${bakSql}`);
	console.log(`Replace:  ${replace ? 'sí' : 'no (falla si ya existe)'}\n`);

	const pool = await sql.connect(sqlCfg('master'));
	try {
		const exists = await pool
			.request()
			.input('db', sql.NVarChar, DB_NAME)
			.query(`SELECT 1 AS ok FROM sys.databases WHERE name = @db`);
		if (exists.recordset.length && !replace) {
			throw new Error(
				`Ya existe [${DB_NAME}]. Usá --replace para sobrescribir, o elegí otro --db.`,
			);
		}

		const fileList = await pool.request().query(`
      RESTORE FILELISTONLY FROM DISK = N'${bakSql.replace(/'/g, "''")}'
    `);
		const logical = fileList.recordset || [];
		if (!logical.length) throw new Error('RESTORE FILELISTONLY no devolvió archivos lógicos');

		const dataDir = arg('--data-dir', await defaultDataDir(pool)).replace(/[\\\/]+$/, '') + '\\';
		const moves = logical.map((f) => {
			const logicalName = String(f.LogicalName);
			const isLog = String(f.Type).toUpperCase() === 'L' || Number(f.Type) === 1;
			const ext = isLog ? '_log.ldf' : '.mdf';
			const dest = `${dataDir}${DB_NAME}${ext}`.replace(/'/g, "''");
			return `MOVE N'${logicalName.replace(/'/g, "''")}' TO N'${dest}'`;
		});

		if (exists.recordset.length && replace) {
			await pool.request().query(`
        ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      `);
		}

		const withOpts = [
			...moves,
			'NOUNLOAD',
			'STATS = 10',
			replace || exists.recordset.length ? 'REPLACE' : null,
		]
			.filter(Boolean)
			.join(',\n      ');

		await pool.request().query(`
      RESTORE DATABASE [${DB_NAME}]
      FROM DISK = N'${bakSql.replace(/'/g, "''")}'
      WITH
      ${withOpts};
    `);

		await pool.request().query(`
      ALTER DATABASE [${DB_NAME}] SET MULTI_USER;
    `);

		console.log(`\n✓ Restore OK → [${DB_NAME}]`);
		console.log('\nPost-pasos recomendados:');
		console.log(`  1) En .env: DB_NAME=${DB_NAME}`);
		console.log('  2) node scripts/ejecutar_setup_saas_tenant.js');
		console.log('  3) node scripts/comparar_esquema_sql.js --ref iSource --tgt ' + DB_NAME);
	} finally {
		await pool.close();
		sql.close();
	}
}

function usage() {
	console.log(`Uso:
  node scripts/migrar_bd_a_remoto.js backup [--db Sarmiento] [--out C:\\backups]
  node scripts/migrar_bd_a_remoto.js restore --bak "C:\\backups\\Sarmiento_....bak" [--db Sarmiento] [--replace] [--data-dir "C:\\...\\DATA"]
`);
}

(async () => {
	if (cmd === 'backup') await cmdBackup();
	else if (cmd === 'restore') await cmdRestore();
	else {
		usage();
		process.exit(cmd ? 1 : 0);
	}
})().catch((e) => {
	console.error('\nError:', e.message || e);
	const pe = e.precedingErrors || e.originalError?.precedingErrors || [];
	for (const x of pe) {
		console.error(`  → (${x.number}) ${x.message}`);
	}
	if (String(e.message || '').includes('terminating abnormally')) {
		console.error('\nTip: el .bak se escribe en el disco del SERVIDOR SQL.');
		console.error('     Si dice "espacio insuficiente", usá --out en un disco con lugar,');
		console.error('     p.ej. --out D:\\backups  (la cuenta del servicio SQL debe poder escribir ahí).');
	}
	process.exit(1);
});
