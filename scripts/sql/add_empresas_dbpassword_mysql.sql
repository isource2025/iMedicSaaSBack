-- Ejecutar en MySQL Railway si la tabla ya existía sin DbPassword
ALTER TABLE `Empresas`
  ADD COLUMN IF NOT EXISTS `DbPassword` VARCHAR(255) NULL
  COMMENT 'Contraseña SQL Server en claro'
  AFTER `DbUser`;

-- Ejemplo empresa 1 (ajustar contraseña real):
-- UPDATE `Empresas` SET `DbPassword` = 'isource' WHERE `IDEMPRESA` = 1;
