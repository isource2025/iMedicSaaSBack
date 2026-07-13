/*
  Setup turnero (pantalla de llamados) — SQL Server tenant
  Ejecutar en cada base clínica o vía script de onboarding.
*/
SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imTurneroPantalla' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imTurneroPantalla (
    IdPantalla        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Nombre            NVARCHAR(100)     NOT NULL DEFAULT N'Pantalla general',
    PublicToken       VARCHAR(64)       NOT NULL,
    ConfigJson        NVARCHAR(MAX)     NOT NULL,
    Activa            BIT               NOT NULL DEFAULT 1,
    FechaCreacion     DATETIME2         NOT NULL DEFAULT GETDATE(),
    FechaModificacion DATETIME2         NOT NULL DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_imTurneroPantalla_Token ON dbo.imTurneroPantalla (PublicToken);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imTurneroLlamado' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imTurneroLlamado (
    IdLlamado         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdTurno           INT               NOT NULL,
    IdPantalla        INT               NULL,
    Paciente          NVARCHAR(200)     NULL,
    Consultorio       NVARCHAR(50)      NULL,
    Profesional       NVARCHAR(200)     NULL,
    Sector            NVARCHAR(10)      NULL,
    HoraTurno         VARCHAR(8)        NULL,
    LlamadoEn         DATETIME2         NOT NULL DEFAULT GETDATE()
  );
  CREATE INDEX IX_imTurneroLlamado_Fecha ON dbo.imTurneroLlamado (LlamadoEn DESC);
  CREATE INDEX IX_imTurneroLlamado_Turno ON dbo.imTurneroLlamado (IdTurno);
END
GO

PRINT 'setup_turnero.sql OK';
GO
