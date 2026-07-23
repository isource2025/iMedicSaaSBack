-- ============================================================
-- Empresas.FileServerUrl — túnel / file server de adjuntos por empresa
-- MySQL (Railway AUTH_DB)
-- ============================================================

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Empresas'
    AND COLUMN_NAME = 'FileServerUrl'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `FileServerUrl` VARCHAR(500) NULL COMMENT ''URL pública del file server / túnel Cloudflare (adjuntos)'' AFTER `TipoServidor`',
  'SELECT ''FileServerUrl ya existe'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
