-- Agregar columna AlertaCritica si no existe
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf' 
    AND COLUMN_NAME = 'AlertaCritica'
)
BEGIN
    ALTER TABLE imHCExamenesLabDetalleConf
    ADD AlertaCritica BIT NOT NULL DEFAULT 0;
    PRINT 'Columna AlertaCritica agregada exitosamente';
END
ELSE
BEGIN
    PRINT 'La columna AlertaCritica ya existe';
END
