#!/usr/bin/env node
/**
 * Migración idempotente de tablas y columnas de seguridad en MySQL Railway.
 * Uso: node scripts/apply_security_mysql.js [--env-file .env.railway.local]
 */
require('dotenv').config();
const args = process.argv.slice(2);
const envIdx = args.indexOf('--env-file');
if (envIdx >= 0 && args[envIdx + 1]) {
	require('dotenv').config({ path: args[envIdx + 1], override: true });
}

const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');

async function columnExists(pool, table, column) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[table, column],
	);
	return rows.length > 0;
}

async function main() {
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 requerido');
		process.exit(1);
	}
	const pool = await getAuthCentralPool();

	await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthAuditLog (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      Fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Ip VARCHAR(45) NULL,
      UserAgent VARCHAR(512) NULL,
      UsernameHash VARCHAR(64) NULL,
      Evento VARCHAR(64) NOT NULL,
      Resultado VARCHAR(32) NOT NULL,
      IdEmpresa INT NULL,
      Detalle VARCHAR(512) NULL,
      INDEX idx_audit_fecha (Fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	console.log('✓ AuthAuditLog');

	await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthSessions (
      SessionId VARCHAR(36) PRIMARY KEY,
      ValorPersonal INT NOT NULL,
      Username VARCHAR(128) NOT NULL,
      IdEmpresa INT NULL,
      RefreshTokenHash VARCHAR(128) NOT NULL,
      LastActivityAt DATETIME NOT NULL,
      ExpiresAt DATETIME NOT NULL,
      Revoked TINYINT(1) NOT NULL DEFAULT 0,
      UserAgent VARCHAR(512) NULL,
      Ip VARCHAR(45) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_vp (ValorPersonal)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	console.log('✓ AuthSessions');

	await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthPaisesPermitidos (
      CodigoISO CHAR(2) PRIMARY KEY,
      Nombre VARCHAR(128) NOT NULL,
      Activo TINYINT(1) NOT NULL DEFAULT 1,
      CreadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	const [pc] = await pool.query(`SELECT COUNT(*) AS c FROM AuthPaisesPermitidos`);
	if (Number(pc[0]?.c || 0) === 0) {
		await pool.query(
			`INSERT INTO AuthPaisesPermitidos (CodigoISO, Nombre, Activo) VALUES ('AR', 'Argentina', 1)`,
		);
	}
	console.log('✓ AuthPaisesPermitidos (AR por defecto)');

	if (!(await columnExists(pool, 'imPassword', 'PasswordHash'))) {
		await pool.query(`ALTER TABLE imPassword ADD COLUMN PasswordHash VARCHAR(255) NULL`);
		console.log('✓ imPassword.PasswordHash');
	} else {
		console.log('• imPassword.PasswordHash ya existe');
	}

	try {
		if (!(await columnExists(pool, 'Empresas', 'SessionIdleMinutes'))) {
			await pool.query(`ALTER TABLE Empresas ADD COLUMN SessionIdleMinutes INT NULL`);
			console.log('✓ Empresas.SessionIdleMinutes');
		}
	} catch (e) {
		console.warn('• Empresas.SessionIdleMinutes:', e.message);
	}

	await pool.query(
		`INSERT INTO imPlataformaConfig (Clave, Valor, FechaMod)
     VALUES ('SESSION_IDLE_MINUTES', '30', NOW())
     ON DUPLICATE KEY UPDATE Clave = Clave`,
	);
	console.log('✓ SESSION_IDLE_MINUTES default 30');
	console.log('\nMigración de seguridad completada.');
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
