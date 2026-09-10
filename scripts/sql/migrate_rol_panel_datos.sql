-- Alta del rol IdRol=7 PANEL_DATOS ("Panel de datos").
-- Idempotente. Corre contra MySQL auth central (imRoles).

INSERT INTO `imRoles` (IdRol, Nombre, Descripcion, Nivel, Activo)
VALUES (7, 'PANEL_DATOS', 'Panel de datos', 15, 1)
ON DUPLICATE KEY UPDATE
    `Nombre` = 'PANEL_DATOS',
    `Descripcion` = 'Panel de datos',
    `Nivel` = 15,
    `Activo` = 1;
