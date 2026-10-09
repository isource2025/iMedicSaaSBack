/*
  Practicas facturables de estudios / interconsultas: vinculo con el resultado.

  Convencion de iMedic escritorio (verificada en la base: 22.735 de 22.737 practicas con
  NroInforme del ultimo anio apuntan a un resultado de su misma visita):

      imFacPracticas.NroInforme  = imProtocolosResultados.IdProtocolo   (indice Por_NroInforme)
      imFacPracticas.IdProtocolo = 0

  imFacPracticas.IdProtocolo es la cabecera quirurgica (HCProtocolosPtes). La version anterior
  de la web guardaba ahi el id del resultado, y como imProtocolosResultados tiene su propio
  contador, una practica de estudio podia aparecer dentro de la cirugia de otro paciente cuando
  los numeros coincidieran.

  Este script corrige lo ya grabado. Es idempotente y la web lo ejecuta sola (ensure de
  estudios / migracion de solicitudes). Correrlo a mano solo si se quiere adelantar.
  Solo toca practicas cuyo IdProtocolo:
    - existe en imProtocolosResultados de la MISMA visita, y
    - NO existe en HCProtocolosPtes de la misma visita, y
    - todavia no tienen NroInforme.
*/
SET NOCOUNT ON;

-- Vista previa (no modifica nada)
SELECT fp.Valor, fp.NumeroVisita, fp.Practica, fp.IdProtocolo, fp.NroInforme
FROM dbo.imFacPracticas fp
WHERE ISNULL(fp.IdProtocolo, 0) > 0
  AND ISNULL(fp.NroInforme, 0) = 0
  AND EXISTS (SELECT 1 FROM dbo.imProtocolosResultados r
              WHERE r.IdProtocolo = fp.IdProtocolo AND r.NumeroVisita = fp.NumeroVisita)
  AND NOT EXISTS (SELECT 1 FROM dbo.HCProtocolosPtes hc
                  WHERE hc.IdProtocolo = fp.IdProtocolo AND hc.NumeroVisita = fp.NumeroVisita)
ORDER BY fp.Valor;

-- Correccion
UPDATE fp SET NroInforme = fp.IdProtocolo, IdProtocolo = 0
FROM dbo.imFacPracticas fp
WHERE ISNULL(fp.IdProtocolo, 0) > 0
  AND ISNULL(fp.NroInforme, 0) = 0
  AND EXISTS (SELECT 1 FROM dbo.imProtocolosResultados r
              WHERE r.IdProtocolo = fp.IdProtocolo AND r.NumeroVisita = fp.NumeroVisita)
  AND NOT EXISTS (SELECT 1 FROM dbo.HCProtocolosPtes hc
                  WHERE hc.IdProtocolo = fp.IdProtocolo AND hc.NumeroVisita = fp.NumeroVisita);
PRINT CONCAT('Practicas pasadas de IdProtocolo a NroInforme: ', @@ROWCOUNT);

-- Verificacion: debe quedar en 0
SELECT COUNT(*) AS practicasConIdResultado_debeSer0
FROM dbo.imFacPracticas fp
WHERE ISNULL(fp.IdProtocolo, 0) > 0
  AND EXISTS (SELECT 1 FROM dbo.imProtocolosResultados r
              WHERE r.IdProtocolo = fp.IdProtocolo AND r.NumeroVisita = fp.NumeroVisita)
  AND NOT EXISTS (SELECT 1 FROM dbo.HCProtocolosPtes hc
                  WHERE hc.IdProtocolo = fp.IdProtocolo AND hc.NumeroVisita = fp.NumeroVisita);
