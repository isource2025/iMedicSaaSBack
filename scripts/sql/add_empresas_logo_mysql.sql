-- MySQL central (Railway auth) — logo institucional por empresa (header de los PDFs).
-- Ejecutar en la BD MySQL donde está la tabla Empresas.
-- Idempotente (compatible MySQL 5.7+ / 8.x).

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'Logo'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `Logo` MEDIUMBLOB NULL COMMENT ''Logo institucional (PNG/JPG/WEBP, máx. 1 MB) para el header de los PDFs''',
  'SELECT ''Logo ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
