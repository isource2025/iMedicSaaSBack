/*
  Alinea dbo.imNotificaciones al esquema observado en Aclysa.
  Objetivo: evitar conflictos de tipos/nulabilidad entre local y satelite.
*/

IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NULL
BEGIN
    RAISERROR('No existe dbo.imNotificaciones en esta base.', 16, 1);
    RETURN;
END

BEGIN TRY
    BEGIN TRAN;

    IF COL_LENGTH('dbo.imNotificaciones', 'ValorPersonal') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD ValorPersonal INT NOT NULL CONSTRAINT DF_imNotif_ValorPersonal DEFAULT (0);

    IF COL_LENGTH('dbo.imNotificaciones', 'TipoNotificacion') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD TipoNotificacion VARCHAR(50) NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'DescNotificacion') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD DescNotificacion VARCHAR(250) NOT NULL CONSTRAINT DF_imNotif_Desc DEFAULT ('');

    IF COL_LENGTH('dbo.imNotificaciones', 'EntidadTipo') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD EntidadTipo VARCHAR(50) NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'EntidadId') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD EntidadId INT NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'DatosJSON') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD DatosJSON NVARCHAR(MAX) NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'Leida') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD Leida BIT NOT NULL CONSTRAINT DF_imNotif_Leida DEFAULT (0);

    IF COL_LENGTH('dbo.imNotificaciones', 'FechaCarga') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD FechaCarga DATETIME NOT NULL CONSTRAINT DF_imNotif_Fecha DEFAULT (GETDATE());

    IF COL_LENGTH('dbo.imNotificaciones', 'MostrarHasta') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD MostrarHasta DATETIME NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'Marca') IS NULL
        ALTER TABLE dbo.imNotificaciones ADD Marca VARCHAR(20) NULL;

    IF COL_LENGTH('dbo.imNotificaciones', 'FechaCarga') IS NOT NULL
    BEGIN
        EXEC('UPDATE dbo.imNotificaciones SET FechaCarga = GETDATE() WHERE FechaCarga IS NULL;');
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN FechaCarga DATETIME NOT NULL;');
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'DescNotificacion') IS NOT NULL
    BEGIN
        EXEC('UPDATE dbo.imNotificaciones SET DescNotificacion = '''' WHERE DescNotificacion IS NULL;');
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN DescNotificacion VARCHAR(250) NOT NULL;');
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'ValorPersonal') IS NOT NULL
    BEGIN
        EXEC('UPDATE dbo.imNotificaciones SET ValorPersonal = 0 WHERE ValorPersonal IS NULL;');
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN ValorPersonal INT NOT NULL;');
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'Leida') IS NOT NULL
    BEGIN
        EXEC('UPDATE dbo.imNotificaciones SET Leida = 0 WHERE Leida IS NULL;');
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN Leida BIT NOT NULL;');
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'MostrarHasta') IS NOT NULL
    BEGIN
        UPDATE dbo.imNotificaciones
        SET MostrarHasta = ISNULL(FechaCarga, GETDATE())
        WHERE MostrarHasta IS NULL;

        ALTER TABLE dbo.imNotificaciones
        ALTER COLUMN MostrarHasta DATETIME NOT NULL;
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'TipoNotificacion') IS NOT NULL
    BEGIN
        ALTER TABLE dbo.imNotificaciones
        ALTER COLUMN TipoNotificacion VARCHAR(50) NULL;
    END

    IF COL_LENGTH('dbo.imNotificaciones', 'EntidadTipo') IS NOT NULL
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN EntidadTipo VARCHAR(50) NULL;');
    IF COL_LENGTH('dbo.imNotificaciones', 'EntidadId') IS NOT NULL
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN EntidadId INT NULL;');
    IF COL_LENGTH('dbo.imNotificaciones', 'Marca') IS NOT NULL
        EXEC('ALTER TABLE dbo.imNotificaciones ALTER COLUMN Marca VARCHAR(20) NULL;');

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.imNotificaciones') AND name = 'IX_imNotificaciones_ValorPersonal'
    )
        CREATE INDEX IX_imNotificaciones_ValorPersonal ON dbo.imNotificaciones(ValorPersonal);

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.imNotificaciones') AND name = 'IX_imNotificaciones_Leida'
    )
        CREATE INDEX IX_imNotificaciones_Leida ON dbo.imNotificaciones(Leida);

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.imNotificaciones') AND name = 'IX_imNotificaciones_FechaCarga'
    )
        CREATE INDEX IX_imNotificaciones_FechaCarga ON dbo.imNotificaciones(FechaCarga);

    COMMIT TRAN;
    PRINT 'OK: migracion imNotificaciones aplicada y estructura alineada a Aclysa.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR('Fallo migracion imNotificaciones: %s', 16, 1, @msg);
END CATCH;
