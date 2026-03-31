-- Agregar columnas para unidad y valor de referencia en imHCExamenesLabDetalle
-- Estas columnas permitirán guardar la información completa del OCR

USE iSource;
GO

-- Verificar si las columnas ya existen antes de agregarlas
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'imHCExamenesLabDetalle' AND COLUMN_NAME = 'UnidadMedida')
BEGIN
    ALTER TABLE imHCExamenesLabDetalle
    ADD UnidadMedida VARCHAR(50) NULL;
    PRINT 'Columna UnidadMedida agregada';
END
ELSE
BEGIN
    PRINT 'Columna UnidadMedida ya existe';
END
GO

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'imHCExamenesLabDetalle' AND COLUMN_NAME = 'ValorReferencia')
BEGIN
    ALTER TABLE imHCExamenesLabDetalle
    ADD ValorReferencia VARCHAR(100) NULL;
    PRINT 'Columna ValorReferencia agregada';
END
ELSE
BEGIN
    PRINT 'Columna ValorReferencia ya existe';
END
GO

-- Verificar las columnas agregadas
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCExamenesLabDetalle'
ORDER BY ORDINAL_POSITION;
GO
