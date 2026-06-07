-- MySQL central (Railway auth) — WhatsApp por empresa
-- Ejecutar en la BD MySQL donde está la tabla Empresas.
-- Idempotente (compatible MySQL 5.7+ / 8.x).

-- WhatsAppPhoneNumberId
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'WhatsAppPhoneNumberId'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `WhatsAppPhoneNumberId` VARCHAR(32) NULL COMMENT ''Meta Phone Number ID — enruta webhook a IDEMPRESA'' AFTER `DbPasswordEnc`',
  'SELECT ''WhatsAppPhoneNumberId ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- WhatsAppWabaId
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'WhatsAppWabaId'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `WhatsAppWabaId` VARCHAR(32) NULL COMMENT ''WhatsApp Business Account ID'' AFTER `WhatsAppPhoneNumberId`',
  'SELECT ''WhatsAppWabaId ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- WhatsAppAccessTokenEnc
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'WhatsAppAccessTokenEnc'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `WhatsAppAccessTokenEnc` TEXT NULL COMMENT ''Token Graph API cifrado (PLATFORM_DB_SECRET)'' AFTER `WhatsAppWabaId`',
  'SELECT ''WhatsAppAccessTokenEnc ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice único por número (permite NULL; en MySQL varios NULL no chocan)
SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND INDEX_NAME = 'UX_Empresas_WhatsAppPhone'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX UX_Empresas_WhatsAppPhone ON `Empresas` (`WhatsAppPhoneNumberId`)',
  'SELECT ''UX_Empresas_WhatsAppPhone ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
