-- Consultar estructura exacta de la tabla imHCEvolucion
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'imHCEvolucion'
ORDER BY ORDINAL_POSITION;

-- Ver un registro de ejemplo para confirmar nombres
SELECT TOP 1 * FROM imHCEvolucion;
