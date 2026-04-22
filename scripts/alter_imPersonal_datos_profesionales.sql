-- Agrega columnas de la solapa "Datos Profesionales" que faltan en dbo.imPersonal.
-- Idempotente: solo agrega lo que no existe.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'MatriculaNacional'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD MatriculaNacional INT NULL;
    PRINT 'Columna MatriculaNacional agregada';
END
ELSE PRINT 'Columna MatriculaNacional ya existe';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'ConvenioFacturacion'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD ConvenioFacturacion VARCHAR(10) NULL;
    PRINT 'Columna ConvenioFacturacion agregada';
END
ELSE PRINT 'Columna ConvenioFacturacion ya existe';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'IdEspecialidadME'
)
BEGIN
    ALTER TABLE dbo.imPersonal ADD IdEspecialidadME INT NULL;
    PRINT 'Columna IdEspecialidadME agregada';
END
ELSE PRINT 'Columna IdEspecialidadME ya existe';

PRINT 'Script finalizado.';
