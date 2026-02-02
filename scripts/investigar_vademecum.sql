-- Script para investigar la tabla imVademecum y entender cómo identificar descartables

-- 1. Ver la estructura de la tabla imVademecum
SELECT TOP 1 * FROM imVademecum;

-- 2. Ver todos los valores únicos de TipoMedicamento
SELECT DISTINCT TipoMedicamento, COUNT(*) as Cantidad
FROM imVademecum
GROUP BY TipoMedicamento
ORDER BY Cantidad DESC;

-- 3. Ver los medicamentos específicos que estamos analizando
SELECT 
    Troquel,
    Alias,
    Descripcion,
    TipoMedicamento,
    *
FROM imVademecum
WHERE Troquel IN (1031, 12000005, 9956856)
ORDER BY Troquel;

-- 4. Ver ejemplos de cada tipo de medicamento
SELECT TOP 5
    Troquel,
    Alias,
    Descripcion,
    TipoMedicamento
FROM imVademecum
WHERE TipoMedicamento = 'DESC';

-- 5. Buscar si hay otros campos que puedan identificar descartables
SELECT TOP 20
    Troquel,
    Alias,
    Descripcion,
    TipoMedicamento
FROM imVademecum
WHERE Alias LIKE '%ABBOCATT%' OR Alias LIKE '%CATETER%' OR Alias LIKE '%AGUJA%' OR Alias LIKE '%JERINGA%'
ORDER BY Alias;
