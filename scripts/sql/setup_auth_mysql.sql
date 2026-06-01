CREATE TABLE IF NOT EXISTS `Empresas` (
  `IDEMPRESA` INT NOT NULL,
  `DESCRIPCION` VARCHAR(255) NOT NULL,
  `calle` VARCHAR(255) NULL,
  `calle_nro` VARCHAR(50) NULL,
  `Depto` VARCHAR(50) NULL,
  `piso` VARCHAR(50) NULL,
  `localidad` VARCHAR(120) NULL,
  `Provincia` VARCHAR(120) NULL,
  `Nro_CUIT` VARCHAR(50) NULL,
  `Nro_IngBrutos` VARCHAR(50) NULL,
  `IdTipoIVA` VARCHAR(20) NULL,
  `TEEmpresa` VARCHAR(80) NULL,
  `Email` VARCHAR(255) NULL,
  `DbServer` VARCHAR(255) NULL,
  `DbPort` INT NULL,
  `DbInstance` VARCHAR(120) NULL,
  `DbName` VARCHAR(255) NULL,
  `DbUser` VARCHAR(120) NULL,
  `DbPassword` VARCHAR(255) NULL COMMENT 'Contraseña SQL en claro (prioridad sobre DbPasswordEnc)',
  `DbPasswordEnc` TEXT NULL,
  PRIMARY KEY (`IDEMPRESA`),
  KEY `IX_Empresas_DESCRIPCION` (`DESCRIPCION`)
);

CREATE TABLE IF NOT EXISTS `imRoles` (
  `IdRol` INT NOT NULL,
  `Nombre` VARCHAR(50) NOT NULL,
  `Descripcion` VARCHAR(255) NULL,
  `Nivel` INT NULL,
  `Activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`IdRol`),
  UNIQUE KEY `UQ_imRoles_Nombre` (`Nombre`)
);

CREATE TABLE IF NOT EXISTS `imPassword` (
  `ValorPersonal` INT NOT NULL,
  `NombreRed` VARCHAR(120) NULL,
  `Password` VARCHAR(255) NOT NULL,
  `Nombres` VARCHAR(150) NULL,
  `Apellido` VARCHAR(150) NULL,
  `CodOperador` VARCHAR(60) NULL,
  `Grupo` INT NULL,
  `NumeroDocumento` VARCHAR(60) NULL,
  PRIMARY KEY (`ValorPersonal`),
  KEY `IX_imPassword_NombreRed` (`NombreRed`)
);

CREATE TABLE IF NOT EXISTS `imPersonal` (
  `Valor` INT NOT NULL,
  `Rol` VARCHAR(20) NULL,
  `Matricula` INT NULL,
  PRIMARY KEY (`Valor`),
  KEY `IX_imPersonal_Rol` (`Rol`)
);

CREATE TABLE IF NOT EXISTS `imPersonalEmpresas` (
  `IdPersonal` INT NOT NULL,
  `IdEmpresa` INT NOT NULL,
  PRIMARY KEY (`IdPersonal`, `IdEmpresa`),
  KEY `IX_imPersonalEmpresas_Empresa` (`IdEmpresa`)
);

CREATE TABLE IF NOT EXISTS `imSectores` (
  `Valor` VARCHAR(30) NOT NULL,
  `Descripcion` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`Valor`)
);

CREATE TABLE IF NOT EXISTS `imPersonalSectores` (
  `idPersonal` INT NOT NULL,
  `idSector` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`idPersonal`, `idSector`),
  KEY `IX_imPersonalSectores_Sector` (`idSector`)
);

CREATE TABLE IF NOT EXISTS `imUsuarioEmpresaLogin` (
  `NombreRed` VARCHAR(120) NOT NULL,
  `IdEmpresa` INT NOT NULL,
  `ValorPersonal` INT NOT NULL,
  `FechaUltimoLogin` DATETIME NULL,
  PRIMARY KEY (`NombreRed`, `IdEmpresa`),
  KEY `IX_imUsuarioEmpresaLogin_Empresa` (`IdEmpresa`)
);

CREATE TABLE IF NOT EXISTS `EmpresasModuloPack` (
  `IdEmpresa` INT NOT NULL,
  `CodigoPack` VARCHAR(30) NOT NULL,
  `Activo` TINYINT(1) NOT NULL DEFAULT 1,
  `FechaAlta` DATETIME NULL,
  PRIMARY KEY (`IdEmpresa`, `CodigoPack`)
);

CREATE TABLE IF NOT EXISTS `imPermisos` (
  `IdPermiso` INT NOT NULL,
  `Codigo` VARCHAR(120) NOT NULL,
  `Modulo` VARCHAR(40) NOT NULL,
  `Submodulo` VARCHAR(40) NOT NULL,
  `Accion` VARCHAR(20) NOT NULL,
  `Descripcion` VARCHAR(200) NULL,
  PRIMARY KEY (`IdPermiso`),
  UNIQUE KEY `UQ_imPermisos_Codigo` (`Codigo`)
);

CREATE TABLE IF NOT EXISTS `imRolPermisos` (
  `IdRol` INT NOT NULL,
  `IdPermiso` INT NOT NULL,
  `FechaAsignacion` DATETIME NULL,
  PRIMARY KEY (`IdRol`, `IdPermiso`)
);

CREATE TABLE IF NOT EXISTS `imIVA` (
  `Valor` VARCHAR(20) NOT NULL,
  `Descripcion` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`Valor`)
);
