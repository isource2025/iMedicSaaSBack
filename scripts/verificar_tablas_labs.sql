-- Verificar si las tablas de laboratorio existen
SELECT 
    TABLE_NAME,
    TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN ('imHCExamenesLabCabecera', 'imHCExamenesLabDetalle', 'imHCExamenesLabDetalleConf')
ORDER BY TABLE_NAME;

-- Ver estructura de imHCExamenesLabCabecera si existe
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imHCExamenesLabCabecera')
BEGIN
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imHCExamenesLabCabecera'
    ORDER BY ORDINAL_POSITION;
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabCabecera NO EXISTE';
END

-- Ver estructura de imHCExamenesLabDetalle si existe
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imHCExamenesLabDetalle')
BEGIN
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imHCExamenesLabDetalle'
    ORDER BY ORDINAL_POSITION;
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabDetalle NO EXISTE';
END

-- Ver estructura de imHCExamenesLabDetalleConf si existe
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf')
BEGIN
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf'
    ORDER BY ORDINAL_POSITION;
END
ELSE
BEGIN
    PRINT 'La tabla imHCExamenesLabDetalleConf NO EXISTE';
END
