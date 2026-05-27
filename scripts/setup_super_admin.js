/**
 * Crea tablas de Super Admin / onboarding en la BD plataforma (.env).
 *
 * Uso (desde iMedicWSBack):
 *   node scripts/setup_super_admin.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../src/config/database');

const PACKS_LEGACY_DEFAULT = ['AGENDA', 'INTERNACION', 'FACTURACION'];

async function ejecutarSqlArchivo(pool, relativePath) {
	const filePath = path.join(__dirname, relativePath);
	const sqlText = fs.readFileSync(filePath, 'utf8');
	const batches = sqlText.split(/\nGO\r?\n/gi).filter((b) => b.trim());
	for (const batch of batches) {
		await pool.request().query(batch);
	}
}

async function verificarTablas(pool) {
	const rows = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN (
        'imEmpresaModuloPack',
        'imEmpresaOnboarding',
        'imEmpresaSuscripcion',
        'imPlataformaConfig'
      )
    ORDER BY TABLE_NAME
  `);
	return rows.recordset.map((r) => r.TABLE_NAME);
}

async function backfillPacksLegacy(pool) {
	const rows = await pool.request().query(`
    SELECT e.IDEMPRESA
    FROM dbo.Empresas e
    LEFT JOIN dbo.imEmpresaModuloPack p
      ON p.IdEmpresa = e.IDEMPRESA AND p.Activo = 1
    GROUP BY e.IDEMPRESA
    HAVING COUNT(p.CodigoPack) = 0
    ORDER BY e.IDEMPRESA
  `);

	const empresasSinPacks = (rows.recordset || []).map((r) => Number(r.IDEMPRESA)).filter(Boolean);
	for (const idEmpresa of empresasSinPacks) {
		for (const codigoPack of PACKS_LEGACY_DEFAULT) {
			await pool.request().input('idEmpresa', idEmpresa).input('codigoPack', codigoPack).query(`
        IF NOT EXISTS (
          SELECT 1
          FROM dbo.imEmpresaModuloPack
          WHERE IdEmpresa = @idEmpresa AND CodigoPack = @codigoPack
        )
        INSERT INTO dbo.imEmpresaModuloPack (IdEmpresa, CodigoPack, Activo)
        VALUES (@idEmpresa, @codigoPack, 1)
      `);
		}
	}

	return empresasSinPacks;
}

(async () => {
	console.log('=== Setup Super Admin (BD plataforma) ===\n');

	if (!process.env.DB_SERVER || !process.env.DB_NAME) {
		console.error('Falta DB_SERVER / DB_NAME en .env');
		process.exit(1);
	}

	const pool = await connectDB();
	console.log(`• Conectado a ${process.env.DB_SERVER} / ${process.env.DB_NAME}`);

	console.log('• Aplicando scripts/sql/setup_super_admin.sql …');
	await ejecutarSqlArchivo(pool, 'sql/setup_super_admin.sql');

	const tablas = await verificarTablas(pool);
	console.log('• Tablas presentes:', tablas.join(', ') || '(ninguna)');

	const faltan = ['imEmpresaModuloPack', 'imEmpresaOnboarding', 'imEmpresaSuscripcion'].filter(
		(t) => !tablas.includes(t),
	);
	if (faltan.length) {
		console.error('Faltan tablas:', faltan.join(', '));
		process.exit(1);
	}

	const empresasBackfill = await backfillPacksLegacy(pool);
	if (empresasBackfill.length) {
		console.log(
			`• Packs legacy aplicados a empresas sin configuración modular: ${empresasBackfill.join(', ')}`,
		);
	} else {
		console.log('• Packs legacy: no hubo empresas pendientes de inicialización.');
	}

	console.log('\n=== Listo ===');
	console.log('Reinicie el backend y vuelva a «Activar empresa» en Onboarding.\n');
	process.exit(0);
})().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
