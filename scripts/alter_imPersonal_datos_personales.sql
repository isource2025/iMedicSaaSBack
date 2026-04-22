-- =============================================================================
-- ALTER TABLE imPersonal - Agrega columnas para Datos Personales (CRUD Personal)
-- Seguro / idempotente: sólo agrega columnas si no existen.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'TipoDocumento'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD TipoDocumento VARCHAR(3) NULL;
    PRINT 'Columna TipoDocumento agregada a imPersonal';
END
ELSE
    PRINT 'Columna TipoDocumento ya existe';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'FechaNacimiento'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD FechaNacimiento INT NULL;
    PRINT 'Columna FechaNacimiento agregada a imPersonal (fecha Clarion)';
END
ELSE
    PRINT 'Columna FechaNacimiento ya existe';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'Provincia'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD Provincia SMALLINT NULL;
    PRINT 'Columna Provincia agregada a imPersonal';
END
ELSE
    PRINT 'Columna Provincia ya existe';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'Nacionalidad'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD Nacionalidad VARCHAR(2) NULL;
    PRINT 'Columna Nacionalidad agregada a imPersonal';
END
ELSE
    PRINT 'Columna Nacionalidad ya existe';

PRINT 'Script finalizado.';
