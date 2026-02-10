-- Consultar estructura de la tabla imHCEvolucion
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'imHCEvolucion'
ORDER BY ORDINAL_POSITION;

-- Ver algunos registros de ejemplo
SELECT TOP 5 * FROM imHCEvolucion;
