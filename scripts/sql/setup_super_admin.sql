-- ============================================================
-- SUPER ADMIN — Rol plataforma + onboarding modular por empresa
-- Idempotente.
-- ============================================================

-- 1) Rol SUPER_ADMIN (solo si imRoles existe en esta BD — típicamente la clínica/tenant)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imRoles'
)
AND NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 5)
    INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel)
    VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma (multi-empresa)', 200);

-- 2) Packs modulares por empresa (AGENDA, INTERNACION, FACTURACION)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imEmpresaModuloPack'
)
BEGIN
    CREATE TABLE dbo.imEmpresaModuloPack (
        IdEmpresa   INT           NOT NULL,
        CodigoPack  VARCHAR(30)   NOT NULL,
        Activo      BIT           NOT NULL DEFAULT 1,
        FechaAlta   DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_imEmpresaModuloPack PRIMARY KEY (IdEmpresa, CodigoPack)
    );
END;

-- 3) Onboarding por empresa
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imEmpresaOnboarding'
)
BEGIN
    CREATE TABLE dbo.imEmpresaOnboarding (
        IdEmpresa         INT           NOT NULL PRIMARY KEY,
        PasoActual        VARCHAR(50)   NOT NULL DEFAULT 'DATOS',
        Completado        BIT           NOT NULL DEFAULT 0,
        Notas             VARCHAR(500)  NULL,
        FechaInicio       DATETIME      NULL,
        FechaCompletado   DATETIME      NULL,
        ConfigJson        NVARCHAR(MAX) NULL
    );
END;

-- 4) Suscripción / cobranza por empresa
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imEmpresaSuscripcion'
)
BEGIN
    CREATE TABLE dbo.imEmpresaSuscripcion (
        IdEmpresa           INT             NOT NULL PRIMARY KEY,
        [Plan]              VARCHAR(50)     NOT NULL DEFAULT 'STARTER',
        Estado              VARCHAR(30)     NOT NULL DEFAULT 'PRUEBA',
        ImporteMensual      DECIMAL(18, 2)  NULL,
        Moneda              VARCHAR(3)      NOT NULL DEFAULT 'ARS',
        FechaInicio         DATE            NULL,
        FechaProximoCobro   DATE            NULL,
        MetodoPago          VARCHAR(50)     NULL,
        Notas               VARCHAR(500)    NULL
    );
END;

-- 5) Config global plataforma (clave-valor JSON)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imPlataformaConfig'
)
BEGIN
    CREATE TABLE dbo.imPlataformaConfig (
        Clave       VARCHAR(80)   NOT NULL PRIMARY KEY,
        Valor       NVARCHAR(MAX) NULL,
        Descripcion VARCHAR(200)  NULL,
        FechaMod    DATETIME      NOT NULL DEFAULT GETDATE()
    );
END;

-- Valores por defecto plataforma
IF NOT EXISTS (SELECT 1 FROM dbo.imPlataformaConfig WHERE Clave = 'onboarding.default_packs')
    INSERT INTO dbo.imPlataformaConfig (Clave, Valor, Descripcion)
    VALUES ('onboarding.default_packs', '["AGENDA"]', 'Packs activos al crear empresa nueva');

IF NOT EXISTS (SELECT 1 FROM dbo.imPlataformaConfig WHERE Clave = 'cobranza.moneda_default')
    INSERT INTO dbo.imPlataformaConfig (Clave, Valor, Descripcion)
    VALUES ('cobranza.moneda_default', 'ARS', 'Moneda por defecto suscripciones');
