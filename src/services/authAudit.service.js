/**
 * Auditoría de eventos de autenticación (append-only en MySQL Railway).
 */
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { usernameHash } = require('../config/security');

let tablesReady = false;

async function ensureTables() {
	if (!isAuthCentralEnabled() || tablesReady) return;
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
      INDEX idx_audit_fecha (Fecha),
      INDEX idx_audit_user (UsernameHash),
      INDEX idx_audit_evento (Evento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	tablesReady = true;
}

async function logEvent({
	ip,
	userAgent,
	username,
	evento,
	resultado,
	idEmpresa = null,
	detalle = null,
}) {
	if (!isAuthCentralEnabled()) return;
	try {
		await ensureTables();
		const pool = await getAuthCentralPool();
		await pool.query(
			`INSERT INTO AuthAuditLog (Ip, UserAgent, UsernameHash, Evento, Resultado, IdEmpresa, Detalle)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				ip ? String(ip).slice(0, 45) : null,
				userAgent ? String(userAgent).slice(0, 512) : null,
				username ? usernameHash(username) : null,
				String(evento || 'UNKNOWN').slice(0, 64),
				String(resultado || 'UNKNOWN').slice(0, 32),
				idEmpresa != null ? Number(idEmpresa) : null,
				detalle ? String(detalle).slice(0, 512) : null,
			],
		);
	} catch (e) {
		console.warn('[authAudit]', e.message);
	}
}

module.exports = { ensureTables, logEvent };
