-- ============================================================
-- Matriz de permisos — esquema LOCAL (SQL Server / LOCAL_DEV_ONLY)
-- Idempotente. Complementa imRoles / imPermisos / imRolPermisos.
-- ============================================================

-- Columnas de alcance en imRoles (roles personalizados por empresa)
IF COL_LENGTH('dbo.imRoles', 'IdEmpresa') IS NULL
	ALTER TABLE dbo.imRoles ADD IdEmpresa INT NOT NULL CONSTRAINT DF_imRoles_IdEmpresa DEFAULT (0);

IF COL_LENGTH('dbo.imRoles', 'RolBase') IS NULL
	ALTER TABLE dbo.imRoles ADD RolBase VARCHAR(30) NULL;

IF COL_LENGTH('dbo.imRoles', 'CreadoPor') IS NULL
	ALTER TABLE dbo.imRoles ADD CreadoPor INT NULL;

IF COL_LENGTH('dbo.imRoles', 'FechaModificacion') IS NULL
	ALTER TABLE dbo.imRoles ADD FechaModificacion DATETIME NULL;

-- Permisos de roles personalizados (por código)
IF NOT EXISTS (
	SELECT 1 FROM INFORMATION_SCHEMA.TABLES
	WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imRolPermisosCustom'
)
BEGIN
	CREATE TABLE dbo.imRolPermisosCustom (
		IdRol  INT NOT NULL,
		Codigo VARCHAR(120) NOT NULL,
		CONSTRAINT PK_imRolPermisosCustom PRIMARY KEY (IdRol, Codigo)
	);
END;

-- Overrides por persona (GRANT / DENY)
IF NOT EXISTS (
	SELECT 1 FROM INFORMATION_SCHEMA.TABLES
	WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imPersonalPermisosOverride'
)
BEGIN
	CREATE TABLE dbo.imPersonalPermisosOverride (
		IdEmpresa         INT NOT NULL,
		Valor             INT NOT NULL,
		Codigo            VARCHAR(120) NOT NULL,
		Efecto            VARCHAR(10) NOT NULL,
		FechaModificacion DATETIME NOT NULL CONSTRAINT DF_imPPO_Fecha DEFAULT (GETDATE()),
		ModificadoPor     INT NULL,
		CONSTRAINT PK_imPersonalPermisosOverride PRIMARY KEY (IdEmpresa, Valor, Codigo),
		CONSTRAINT CK_imPPO_Efecto CHECK (Efecto IN ('GRANT', 'DENY'))
	);
	CREATE INDEX IX_imPPO_Personal ON dbo.imPersonalPermisosOverride (IdEmpresa, Valor);
END;

-- Auditoría liviana de cambios de roles (opcional para pestaña Historial)
IF NOT EXISTS (
	SELECT 1 FROM INFORMATION_SCHEMA.TABLES
	WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imAuditoria'
)
BEGIN
	CREATE TABLE dbo.imAuditoria (
		Id        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
		IdEmpresa INT NOT NULL,
		Modulo    VARCHAR(40) NOT NULL,
		Entidad   VARCHAR(40) NOT NULL,
		IdEntidad INT NULL,
		Accion    VARCHAR(40) NOT NULL,
		Actor     INT NULL,
		Detalle   NVARCHAR(MAX) NULL,
		Fecha     DATETIME NOT NULL CONSTRAINT DF_imAuditoria_Fecha DEFAULT (GETDATE())
	);
	CREATE INDEX IX_imAuditoria_Rol ON dbo.imAuditoria (IdEmpresa, Modulo, Entidad, IdEntidad, Fecha DESC);
END;
