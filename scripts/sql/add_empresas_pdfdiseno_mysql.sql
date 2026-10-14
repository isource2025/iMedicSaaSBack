-- MySQL central (Railway auth) — diseño de los PDFs por empresa (Configuración → Institución → Diseño de PDF).
-- Ejecutar en la BD MySQL donde está la tabla Empresas.
-- Idempotente (compatible MySQL 5.7+ / 8.x).

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'PdfDiseno'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `Empresas` ADD COLUMN `PdfDiseno` TEXT NULL COMMENT ''Diseño de los PDFs (JSON: plantilla, color, tipografía, datos visibles)''',
  'SELECT ''PdfDiseno ya existe'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
