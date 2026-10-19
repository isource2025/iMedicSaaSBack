/**
 * imPassword.CodOperador es IDENTITY en algunas bases Clarion. Si el INSERT lo omite,
 * el motor asigna el siguiente número y CodOperador deja de coincidir con ValorPersonal:
 * OperadorCarga (CodOperador) y Profesional (ValorPersonal) pasan a nombrar a personas
 * distintas con el mismo número.
 *
 * Arma un batch que graba CodOperador = `paramCod` (con IDENTITY_INSERT si hace falta).
 * Si ese CodOperador ya está ocupado, ejecuta `insertSinCod` (comportamiento anterior).
 */
function sqlInsertImPasswordConCodOperador({ insertConCod, insertSinCod, paramCod }) {
	return `
BEGIN TRY
  IF EXISTS (SELECT 1 FROM dbo.imPassword WHERE CodOperador = ${paramCod})
  BEGIN
    ${insertSinCod}
  END
  ELSE IF COLUMNPROPERTY(OBJECT_ID('dbo.imPassword'), 'CodOperador', 'IsIdentity') = 1
  BEGIN
    SET IDENTITY_INSERT dbo.imPassword ON;
    ${insertConCod}
    SET IDENTITY_INSERT dbo.imPassword OFF;
  END
  ELSE
  BEGIN
    ${insertConCod}
  END
END TRY
BEGIN CATCH
  IF COLUMNPROPERTY(OBJECT_ID('dbo.imPassword'), 'CodOperador', 'IsIdentity') = 1
    SET IDENTITY_INSERT dbo.imPassword OFF;
  THROW;
END CATCH`;
}

module.exports = { sqlInsertImPasswordConCodOperador };
