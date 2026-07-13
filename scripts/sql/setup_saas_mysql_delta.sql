/*
================================================================================
  iMedic SaaS — DELTA completo para MySQL AUTH CENTRAL (Railway)
================================================================================
  Ejecutar en la base MySQL de autenticación (AUTH_DB_*), NO en SQL Server.

  Incluye:
    - AuthAuditLog, AuthSessions, AuthPaisesPermitidos (seguridad / refresh)
    - imPassword.PasswordHash
    - Empresas.SessionIdleMinutes
    - imPlataformaConfig SESSION_IDLE_MINUTES
    - imTurneroTokens (índice token → IdEmpresa para display público)

  Alternativa Node:
    node scripts/apply_security_mysql.js
================================================================================
*/

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AuthPaisesPermitidos (
  CodigoISO CHAR(2) PRIMARY KEY,
  Nombre VARCHAR(128) NOT NULL,
  Activo TINYINT(1) NOT NULL DEFAULT 1,
  CreadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO AuthPaisesPermitidos (CodigoISO, Nombre, Activo)
SELECT 'AR', 'Argentina', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM AuthPaisesPermitidos WHERE CodigoISO = 'AR');

CREATE TABLE IF NOT EXISTS imTurneroTokens (
  PublicToken VARCHAR(64) PRIMARY KEY,
  IdEmpresa INT NOT NULL,
  INDEX IX_imTurneroTokens_Empresa (IdEmpresa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Columnas opcionales (ignorar error si ya existen al correr a mano)
-- Preferí: node scripts/apply_security_mysql.js  (maneja EXISTS)

-- ALTER TABLE imPassword ADD COLUMN PasswordHash VARCHAR(255) NULL;
-- ALTER TABLE Empresas ADD COLUMN SessionIdleMinutes INT NULL;

INSERT INTO imPlataformaConfig (Clave, Valor, FechaMod)
VALUES ('SESSION_IDLE_MINUTES', '30', NOW())
ON DUPLICATE KEY UPDATE Clave = Clave;
