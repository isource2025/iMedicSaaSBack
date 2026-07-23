-- ============================================================
-- Multi-tenant: conexión SQL por empresa (BD plataforma / .env)
-- Ejecutar con: node scripts/setup_empresa_conexion.js
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbServer'
)
    ALTER TABLE dbo.Empresas ADD DbServer NVARCHAR(200) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbPort'
)
    ALTER TABLE dbo.Empresas ADD DbPort INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbInstance'
)
    ALTER TABLE dbo.Empresas ADD DbInstance NVARCHAR(100) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbName'
)
    ALTER TABLE dbo.Empresas ADD DbName NVARCHAR(128) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbUser'
)
    ALTER TABLE dbo.Empresas ADD DbUser NVARCHAR(128) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbPasswordEnc'
)
    ALTER TABLE dbo.Empresas ADD DbPasswordEnc NVARCHAR(MAX) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'FileServerUrl'
)
    ALTER TABLE dbo.Empresas ADD FileServerUrl NVARCHAR(500) NULL;

-- Índice de descubrimiento de login
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imUsuarioEmpresaLogin'
)
BEGIN
    CREATE TABLE dbo.imUsuarioEmpresaLogin (
        NombreRed        VARCHAR(80) NOT NULL,
        IdEmpresa        INT         NOT NULL,
        ValorPersonal    INT         NOT NULL,
        FechaUltimoLogin DATETIME    NOT NULL CONSTRAINT DF_imUsuarioEmpresaLogin_Fecha DEFAULT GETDATE(),
        CONSTRAINT PK_imUsuarioEmpresaLogin PRIMARY KEY (NombreRed, IdEmpresa)
    );
    CREATE INDEX IX_imUsuarioEmpresaLogin_Empresa ON dbo.imUsuarioEmpresaLogin (IdEmpresa);
END;

PRINT 'OK: columnas Empresas + tabla imUsuarioEmpresaLogin';
