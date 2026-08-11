-- Renombra la descripción del rol IdRol=6 a "Carga de adjuntos"
-- (código interno sigue siendo CARGA_HC).

UPDATE `imRoles`
SET `Descripcion` = 'Carga de adjuntos',
    `Nombre` = 'CARGA_HC',
    `Activo` = 1
WHERE `IdRol` = 6;
