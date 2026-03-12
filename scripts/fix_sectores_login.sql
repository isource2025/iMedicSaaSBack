-- ============================================
-- Script de diagnóstico y solución para sectores de login
-- ============================================

PRINT '=== PASO 1: Verificar usuario 40589127 en impassword ==='
SELECT 
    CodOperador, 
    NombreRed, 
    Nombres, 
    Apellido,
    ValorPersonal
FROM impassword 
WHERE NombreRed = '40589127'

PRINT ''
PRINT '=== PASO 2: Verificar sectores del usuario (CodOperador = 1067) ==='
SELECT * 
FROM imPersonalSectores 
WHERE idPersonal = 1067

PRINT ''
PRINT '=== PASO 3: Ver estructura de imPersonalSectores ==='
SELECT TOP 10 * FROM imPersonalSectores

PRINT ''
PRINT '=== PASO 4: Ver sectores disponibles ==='
SELECT * FROM imSectores

PRINT ''
PRINT '=== PASO 5: Verificar si existe la relación correcta ==='
SELECT 
    pw.CodOperador,
    pw.NombreRed,
    pw.Nombres,
    pw.Apellido,
    ps.idPersonal,
    ps.idSector,
    s.Descripcion as descripcionSector
FROM impassword pw
LEFT JOIN imPersonalSectores ps ON pw.CodOperador = ps.idPersonal
LEFT JOIN imSectores s ON ps.idSector = s.Valor
WHERE pw.NombreRed = '40589127'

PRINT ''
PRINT '=== DIAGNÓSTICO COMPLETO ==='
PRINT 'Si el PASO 2 devuelve 0 registros, el usuario NO tiene sectores asignados'
PRINT 'Si el PASO 5 muestra NULL en idSector, confirma que faltan datos en imPersonalSectores'
PRINT ''
PRINT '=== SOLUCIÓN: Insertar sectores para el usuario ==='
PRINT 'Ejecuta el siguiente INSERT después de verificar qué sectores existen:'
PRINT ''
PRINT '-- Ejemplo: Asignar sector UTI al usuario 40589127 (CodOperador = 1067)'
PRINT '-- INSERT INTO imPersonalSectores (idPersonal, idSector)'
PRINT '-- VALUES (1067, ''UTI'')  -- Reemplazar UTI con el valor correcto de imSectores.Valor'
PRINT ''
PRINT '-- Si el usuario debe tener acceso a múltiples sectores:'
PRINT '-- INSERT INTO imPersonalSectores (idPersonal, idSector) VALUES (1067, ''SECTOR1'')'
PRINT '-- INSERT INTO imPersonalSectores (idPersonal, idSector) VALUES (1067, ''SECTOR2'')'
