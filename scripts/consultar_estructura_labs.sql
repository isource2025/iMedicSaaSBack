-- Consultar estructura de las tablas de laboratorio

-- Estructura de imHCExamenesLabCabecera
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCExamenesLabCabecera'
ORDER BY ORDINAL_POSITION;

-- Estructura de imHCExamenesLabDetalle
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCExamenesLabDetalle'
ORDER BY ORDINAL_POSITION;

-- Estructura de imHCExamenesLabDetalleConf
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf'
ORDER BY ORDINAL_POSITION;

-- Datos de ejemplo de Cabecera
SELECT TOP 3 * FROM imHCExamenesLabCabecera;

-- Datos de ejemplo de Detalle
SELECT TOP 3 * FROM imHCExamenesLabDetalle;

-- Datos de ejemplo de DetalleConf
SELECT TOP 3 * FROM imHCExamenesLabDetalleConf;
