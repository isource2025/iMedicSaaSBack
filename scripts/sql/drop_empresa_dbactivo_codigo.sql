-- Quitar columnas que ya no se usan (ejecutar una vez si existen)
IF EXISTS (
    SELECT 1 FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON dc.parent_column_id = c.column_id AND dc.parent_object_id = c.object_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.Empresas') AND c.name = 'DbActivo'
)
BEGIN
    DECLARE @df NVARCHAR(200);
    SELECT @df = dc.name FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON dc.parent_column_id = c.column_id AND dc.parent_object_id = c.object_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.Empresas') AND c.name = 'DbActivo';
    EXEC('ALTER TABLE dbo.Empresas DROP CONSTRAINT ' + @df);
END;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'DbActivo'
)
    ALTER TABLE dbo.Empresas DROP COLUMN DbActivo;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'CodigoEmpresa'
)
    ALTER TABLE dbo.Empresas DROP COLUMN CodigoEmpresa;

PRINT 'OK: DbActivo y CodigoEmpresa eliminados de Empresas (si existían)';
