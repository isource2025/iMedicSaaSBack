/**
 * Deja listo el login multi-empresa:
 * 1) DDL en Empresas + imUsuarioEmpresaLogin
 * 2) Conexión SQL por empresa desde .env
 * 3) Contraseña SQL cifrada (DbPasswordEnc)
 * 4) Índice de usuarios para descubrimiento rápido
 * 5) (opcional) Segunda empresa demo para probar selector
 *
 * Uso (desde iMedicWSBack):
 *   node scripts/setup_empresa_conexion.js
 *
 * Opciones:
 *   SEED_EMPRESA_DEMO=1   crea 2ª empresa apuntando a la misma BD (prueba multi-selector)
 *   SKIP_INDEX=1          no reconstruye imUsuarioEmpresaLogin
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../src/config/database');
const { encrypt } = require('../src/utils/dbCrypto');
const {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
	testTenantConnection,
} = require('../src/config/tenantDb');

const SEED_DEMO = process.env.SEED_EMPRESA_DEMO === '1' || process.env.SEED_EMPRESA_DEMO === 'true';
const SKIP_INDEX = process.env.SKIP_INDEX === '1';

function envConnection() {
	// DbInstance NULL: conexión remota por puerto (igual que database.js)
	return {
		dbServer: process.env.DB_SERVER,
		dbPort: parseInt(process.env.DB_PORT, 10) || 1433,
		dbInstance: null,
		dbName: process.env.DB_NAME,
		dbUser: process.env.DB_USER,
		dbPassword: process.env.DB_PASSWORD,
	};
}

async function ejecutarSqlArchivo(pool, relativePath) {
	const filePath = path.join(__dirname, relativePath);
	const sqlText = fs.readFileSync(filePath, 'utf8');
	const batches = sqlText.split(/\nGO\r?\n/gi).filter((b) => b.trim());
	for (const batch of batches) {
		await pool.request().query(batch);
	}
}

async function quitarColumnasObsoletas(pool) {
	try {
		await ejecutarSqlArchivo(pool, 'sql/drop_empresa_dbactivo_codigo.sql');
		console.log('• Columnas DbActivo / CodigoEmpresa eliminadas (si existían).');
	} catch (err) {
		console.warn('• Aviso al quitar columnas obsoletas:', err.message);
	}
}

async function asegurarColumnas(pool) {
	await quitarColumnasObsoletas(pool);

	const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas'
      AND COLUMN_NAME IN ('DbServer','DbPort','DbInstance','DbName','DbUser','DbPasswordEnc')
  `);
	const names = new Set(cols.recordset.map((r) => r.COLUMN_NAME));
	const required = ['DbServer', 'DbPort', 'DbInstance', 'DbName', 'DbUser', 'DbPasswordEnc'];
	const missing = required.filter((c) => !names.has(c));
	if (missing.length) {
		console.log('• Aplicando DDL (faltan columnas:', missing.join(', '), ')...');
		await ejecutarSqlArchivo(pool, 'sql/setup_empresa_conexion.sql');
	} else {
		console.log('• Columnas de conexión ya existen en Empresas.');
	}

	const idx = await pool.request().query(`
    SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imUsuarioEmpresaLogin'
  `);
	if (!idx.recordset.length) {
		console.log('• Creando tabla imUsuarioEmpresaLogin...');
		await ejecutarSqlArchivo(pool, 'sql/setup_empresa_conexion.sql');
	} else {
		console.log('• Tabla imUsuarioEmpresaLogin OK.');
	}
}

const DEMO_DESCRIPCION = 'iMedic — Empresa demo (misma BD)';

async function listarEmpresas(pool) {
	const r = await pool.request().query(`
    SELECT IDEMPRESA, DESCRIPCION, DbServer, DbName
    FROM dbo.Empresas ORDER BY IDEMPRESA
  `);
	return r.recordset || [];
}

async function actualizarConexionEmpresa(pool, idEmpresa, conn, passwordEnc) {
	await pool
		.request()
		.input('id', idEmpresa)
		.input('srv', conn.dbServer)
		.input('port', conn.dbPort)
		.input('inst', conn.dbInstance || null)
		.input('db', conn.dbName)
		.input('usr', conn.dbUser)
		.input('pwd', passwordEnc)
		.query(`
    UPDATE dbo.Empresas SET
      DbServer = @srv,
      DbPort = @port,
      DbInstance = @inst,
      DbName = @db,
      DbUser = @usr,
      DbPasswordEnc = @pwd
    WHERE IDEMPRESA = @id
  `);
}

async function crearEmpresaDemo(pool, conn, passwordEnc) {
	const existe = await pool.request().input('desc', DEMO_DESCRIPCION).query(`
    SELECT TOP 1 IDEMPRESA FROM dbo.Empresas WHERE DESCRIPCION = @desc
  `);
	if (existe.recordset.length) {
		console.log('• Empresa demo ya existe (IdEmpresa', existe.recordset[0].IDEMPRESA, ').');
		return Number(existe.recordset[0].IDEMPRESA);
	}

	const next = await pool.request().query(`SELECT ISNULL(MAX(IDEMPRESA), 0) + 1 AS NuevoId FROM dbo.Empresas`);
	const nuevoId = Number(next.recordset[0].NuevoId);

	await pool
		.request()
		.input('id', nuevoId)
		.input('desc', DEMO_DESCRIPCION)
		.input('srv', conn.dbServer)
		.input('port', conn.dbPort)
		.input('inst', conn.dbInstance || null)
		.input('db', conn.dbName)
		.input('usr', conn.dbUser)
		.input('pwd', passwordEnc)
		.query(`
    INSERT INTO dbo.Empresas (
      IDEMPRESA, DESCRIPCION,
      DbServer, DbPort, DbInstance, DbName, DbUser, DbPasswordEnc
    ) VALUES (
      @id, @desc,
      @srv, @port, @inst, @db, @usr, @pwd
    )
  `);

	console.log(`• Empresa demo creada: IdEmpresa=${nuevoId} (misma BD para probar selector).`);
	return nuevoId;
}

async function reconstruirIndiceLogin(pool) {
	const empresas = await listarEmpresas(pool);
	const groups = new Map();

	for (const emp of empresas) {
		const row = await loadEmpresaConnectionRow(emp.IDEMPRESA);
		const key = configCacheKey(rowToSqlConfig(row));
		if (!groups.has(key)) groups.set(key, emp.IDEMPRESA);
	}

	await pool.request().query(`DELETE FROM dbo.imUsuarioEmpresaLogin`);

	let total = 0;
	for (const probeId of groups.values()) {
		try {
			const tenantPool = await getTenantPool(probeId);
			const users = await tenantPool.request().query(`
        SELECT
          LTRIM(RTRIM(ISNULL(pw.NombreRed, pw.nombrered))) AS NombreRed,
          pe.IdEmpresa,
          pw.ValorPersonal
        FROM dbo.imPassword pw
        INNER JOIN dbo.imPersonalEmpresas pe ON pe.IdPersonal = pw.ValorPersonal
        WHERE ISNULL(LTRIM(RTRIM(ISNULL(pw.NombreRed, pw.nombrered))), '') <> ''
      `);

			for (const u of users.recordset || []) {
				const nombre = String(u.NombreRed || '').trim();
				if (!nombre) continue;
				await pool
					.request()
					.input('u', nombre)
					.input('e', Number(u.IdEmpresa))
					.input('v', Number(u.ValorPersonal))
					.query(`
            IF NOT EXISTS (
              SELECT 1 FROM dbo.imUsuarioEmpresaLogin
              WHERE NombreRed = @u AND IdEmpresa = @e
            )
              INSERT INTO dbo.imUsuarioEmpresaLogin (NombreRed, IdEmpresa, ValorPersonal)
              VALUES (@u, @e, @v)
          `);
				total += 1;
			}
			console.log(`  - Conexión (probe ${probeId}): ${users.recordset?.length || 0} asignaciones indexadas`);
		} catch (err) {
			console.warn(`  ! Conexión probe ${probeId}: ${err.message}`);
		}
	}

	console.log(`• Índice imUsuarioEmpresaLogin (solo imPersonalEmpresas): ${total} filas.`);
}

async function verificar(pool) {
	console.log('\n--- Verificación ---');
	const empresas = await listarEmpresas(pool);
	for (const e of empresas) {
		let test = { ok: false };
		try {
			test = await testTenantConnection(Number(e.IDEMPRESA));
		} catch (err) {
			test = { ok: false, error: err.message };
		}
		console.log(
			`  [${e.IDEMPRESA}] ${String(e.DESCRIPCION || '').trim()} | ${e.DbServer}/${e.DbName} | conexión: ${test.ok ? 'OK' : 'FALLO'}`,
		);
	}

	const muestra = await pool.request().query(`
    SELECT TOP 5 NombreRed, IdEmpresa, ValorPersonal FROM dbo.imUsuarioEmpresaLogin ORDER BY NombreRed
  `);
	console.log('\nMuestra índice login:');
	for (const r of muestra.recordset || []) {
		console.log(`  ${r.NombreRed} → empresa ${r.IdEmpresa} (personal ${r.ValorPersonal})`);
	}

	const dup = await pool.request().query(`
    SELECT NombreRed, COUNT(*) AS N
    FROM dbo.imUsuarioEmpresaLogin
    GROUP BY NombreRed
    HAVING COUNT(*) > 1
  `);
	if (dup.recordset?.length) {
		console.log('\nUsuarios en más de una empresa (probar selector en login):');
		for (const d of dup.recordset) {
			console.log(`  ${d.NombreRed} (${d.N} empresas)`);
		}
	}
}

(async () => {
	console.log('=== Setup login multi-empresa ===\n');

	if (!process.env.DB_SERVER || !process.env.DB_NAME) {
		console.error('Falta DB_SERVER / DB_NAME en .env');
		process.exit(1);
	}

	const pool = await connectDB();
	await asegurarColumnas(pool);

	try {
		const saPath = path.join(__dirname, 'sql/setup_super_admin.sql');
		if (fs.existsSync(saPath)) {
			console.log('• Tablas Super Admin (onboarding / packs / suscripción)…');
			await ejecutarSqlArchivo(pool, 'sql/setup_super_admin.sql');
		}
	} catch (err) {
		console.warn('• Aviso setup_super_admin:', err.message);
	}

	const conn = envConnection();
	const passwordEnc = encrypt(conn.dbPassword);
	console.log('• Contraseña SQL cifrada con PLATFORM_DB_SECRET / JWT_SECRET.');

	const empresas = await listarEmpresas(pool);
	if (!empresas.length) {
		console.warn('No hay filas en dbo.Empresas. Cree al menos una desde Super Admin o INSERT manual.');
	} else {
		for (const e of empresas) {
			await actualizarConexionEmpresa(pool, Number(e.IDEMPRESA), conn, passwordEnc);
		}
		console.log(`• Conexión .env aplicada a ${empresas.length} empresa(s).`);
	}

	if (SEED_DEMO) {
		await crearEmpresaDemo(pool, conn, passwordEnc);
	} else if (empresas.length < 2) {
		console.log('\nTip: para probar selector con 2 empresas en la misma BD:');
		console.log('  set SEED_EMPRESA_DEMO=1 && node scripts/setup_empresa_conexion.js\n');
	}

	if (!SKIP_INDEX) {
		console.log('\n• Reconstruyendo índice de login...');
		await reconstruirIndiceLogin(pool);
	}

	await verificar(pool);

	console.log('\n=== Listo para testear ===');
	console.log('1) Reiniciar backend (npm run dev)');
	console.log('2) Login: escribir usuario, esperar 2s → loader → empresa/sectores');
	console.log('3) Super Admin: wizard Datos → Conexión SQL (si cambia la BD)\n');
	process.exit(0);
})().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
