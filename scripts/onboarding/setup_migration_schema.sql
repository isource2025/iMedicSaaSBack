/*
  Tablas auxiliares para migración onboarding (cliente nuevo, BD limpia).
  Ejecutar UNA VEZ en la BD destino antes del primer migrate.
*/
IF OBJECT_ID('dbo._onboardingMigracionMap', 'U') IS NULL
BEGIN
  CREATE TABLE dbo._onboardingMigracionMap (
    Entidad       VARCHAR(40)  NOT NULL,
    SourceKey     VARCHAR(80)  NOT NULL,
    SourceId      INT          NULL,
    ImedicId      INT          NULL,
    ImedicKey     VARCHAR(40)  NULL,
    MetadataJson  NVARCHAR(MAX) NULL,
    CreadoEn      DATETIME     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_onboardingMigracionMap PRIMARY KEY (Entidad, SourceKey)
  );
  CREATE INDEX IX_onboardingMigracionMap_SourceId ON dbo._onboardingMigracionMap (Entidad, SourceId);
  CREATE INDEX IX_onboardingMigracionMap_ImedicId ON dbo._onboardingMigracionMap (Entidad, ImedicId);
END;

IF OBJECT_ID('dbo._onboardingMigracionLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo._onboardingMigracionLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Fase        VARCHAR(40)  NOT NULL,
    Nivel       VARCHAR(10)  NOT NULL DEFAULT 'INFO',
    Mensaje     NVARCHAR(500) NOT NULL,
    Detalle     NVARCHAR(MAX) NULL,
    CreadoEn    DATETIME NOT NULL DEFAULT GETDATE()
  );
END;

IF OBJECT_ID('dbo._onboardingMigracionConfig', 'U') IS NULL
BEGIN
  CREATE TABLE dbo._onboardingMigracionConfig (
    Clave   VARCHAR(60) NOT NULL PRIMARY KEY,
    Valor   NVARCHAR(500) NOT NULL,
    Notas   NVARCHAR(500) NULL
  );

  INSERT INTO dbo._onboardingMigracionConfig (Clave, Valor, Notas) VALUES
    ('sector.default', 'GEN', 'Fallback si sector origen vacío o inválido'),
    ('preserve_ids',   '1',   'Preservar IDs origen en pacientes y visitas');
END;
