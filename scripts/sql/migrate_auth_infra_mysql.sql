-- Migraciones incrementales infra SaaS (idempotente donde sea posible)
-- Ejecutar: npm run auth:mysql:infra-migrate

-- DbPassword en claro (prioridad sobre DbPasswordEnc en runtime)
ALTER TABLE `Empresas`
  ADD COLUMN IF NOT EXISTS `DbPassword` VARCHAR(255) NULL
  COMMENT 'Contraseña SQL en claro (prioridad sobre DbPasswordEnc)'
  AFTER `DbUser`;

-- Tablas plataforma Super Admin (por si no corrió platform-migrate)
CREATE TABLE IF NOT EXISTS `EmpresasOnboarding` (
  `IdEmpresa` INT NOT NULL,
  `PasoActual` VARCHAR(50) NOT NULL DEFAULT 'DATOS',
  `Completado` TINYINT(1) NOT NULL DEFAULT 0,
  `Notas` VARCHAR(500) NULL,
  `FechaInicio` DATETIME NULL,
  `FechaCompletado` DATETIME NULL,
  `ConfigJson` JSON NULL,
  PRIMARY KEY (`IdEmpresa`)
);

CREATE TABLE IF NOT EXISTS `EmpresasSuscripcion` (
  `IdEmpresa` INT NOT NULL,
  `Plan` VARCHAR(50) NOT NULL DEFAULT 'STARTER',
  `Estado` VARCHAR(30) NOT NULL DEFAULT 'PRUEBA',
  `ImporteMensual` DECIMAL(18, 2) NULL,
  `Moneda` VARCHAR(3) NOT NULL DEFAULT 'ARS',
  `FechaInicio` DATE NULL,
  `FechaProximoCobro` DATE NULL,
  `MetodoPago` VARCHAR(50) NULL,
  `Notas` VARCHAR(500) NULL,
  PRIMARY KEY (`IdEmpresa`)
);

CREATE TABLE IF NOT EXISTS `imPlataformaConfig` (
  `Clave` VARCHAR(80) NOT NULL,
  `Valor` TEXT NULL,
  `Descripcion` VARCHAR(200) NULL,
  `FechaMod` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Clave`)
);

INSERT IGNORE INTO `imPlataformaConfig` (`Clave`, `Valor`, `Descripcion`)
VALUES
  ('onboarding.default_packs', '["AGENDA"]', 'Packs activos al crear empresa nueva'),
  ('cobranza.moneda_default', 'ARS', 'Moneda por defecto suscripciones');
