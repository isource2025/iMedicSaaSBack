-- Ampliar Nacionalidad si quedó en VARCHAR(2) del script alter_imPersonal_datos_personales.sql
-- y se desea guardar texto largo. Opcional: el backend ya normaliza descripción → código ISO2.
-- Ejecutar una sola vez en el servidor que corresponda.

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imPersonal' AND COLUMN_NAME = 'Nacionalidad'
)
BEGIN
    ALTER TABLE dbo.imPersonal ALTER COLUMN Nacionalidad VARCHAR(40) NULL;
    PRINT 'Columna Nacionalidad alterada a VARCHAR(40).';
END
ELSE
    PRINT 'Columna Nacionalidad no existe en imPersonal; omitido.';
