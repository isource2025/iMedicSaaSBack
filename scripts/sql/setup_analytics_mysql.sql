-- ============================================================
-- Product analytics (plataforma MySQL / AUTH_DB)
-- Idempotente. También se crea sola en runtime (analytics.service).
--
-- NO va en SQL Server del tenant: no es dato clínico.
-- No guarda userId ni username: solo UserHash (HMAC de ValorPersonal).
-- ============================================================

CREATE TABLE IF NOT EXISTS `AnalyticsEvents` (
  `Id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `EventType` VARCHAR(64) NOT NULL,
  `UserHash` VARCHAR(64) NULL,
  `IdEmpresa` INT NULL,
  `Role` VARCHAR(40) NULL,
  `SessionId` VARCHAR(36) NULL,
  `Metadata` JSON NULL,
  `UserAgent` VARCHAR(512) NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_analytics_type_created` (`EventType`, `CreatedAt`),
  INDEX `idx_analytics_empresa_created` (`IdEmpresa`, `CreatedAt`),
  INDEX `idx_analytics_session_type` (`SessionId`, `EventType`),
  INDEX `idx_analytics_userhash` (`UserHash`),
  INDEX `idx_analytics_role` (`Role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
