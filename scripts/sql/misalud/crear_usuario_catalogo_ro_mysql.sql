/*
  MiSalud.Imedic (S5) — usuario MySQL de SOLO LECTURA del catálogo `Empresas`
  (MySQL de plataforma en Railway), SIN acceso a contraseñas ni tokens.

  Qué hace:
    1. Crea (o reemplaza) la vista `vw_MiSaludEmpresas` con una lista CERRADA de
       columnas: id y nombre de la clínica, dónde está su SQL Server (sin
       usuario ni contraseña), FileServerUrl, PacsUrl, logo y tiempo de sesión.
       Las columnas de la lista que no existan en esta base se omiten.
       Quedan fuera: DbUser, DbPassword, DbPasswordEnc, WhatsApp*, CUIT,
       domicilio, PdfDiseno y cualquier columna que se agregue a futuro.
    2. Crea el usuario `misalud_catalogo_ro` (o le cambia la contraseña).
    3. Le da SELECT SOLO sobre esa vista. Nada sobre la tabla Empresas ni sobre
       imPassword, imPersonal, AuthSessions, etc.

  Cómo correrlo (cliente mysql / DBeaver conectado como el usuario dueño de la
  base, el mismo de AUTH_DB_USER):
    1. USE <base de AUTH_DB_NAME>;   (por ejemplo: USE railway;)
    2. Cambiar @password (mínimo 16 caracteres, generada al azar).
    3. Ejecutar todo. Es idempotente.
    4. Cargar el usuario/contraseña en MiSaludBack (CATALOGO_DB_USER / _PASSWORD).
  La vista es SQL SECURITY DEFINER: si se borra el usuario que la creó, hay que
  volver a correr este script con otro usuario dueño.
*/

SET @usuario  := 'misalud_catalogo_ro';
SET @host     := '%';
SET @password := 'CAMBIAR_POR_PASSWORD_FUERTE';
SET @vista    := 'vw_MiSaludEmpresas';

-- Si falta la contraseña o la base, TODAS las sentencias de abajo fallan con un
-- error que lo explica (SIGNAL no se puede usar en PREPARE). Sirve también en
-- clientes que siguen ejecutando después de un error.
SET @ok := @password <> 'CAMBIAR_POR_PASSWORD_FUERTE' AND CHAR_LENGTH(@password) >= 16 AND DATABASE() IS NOT NULL;
SET @falla := 'SELECT 1 FROM `ERROR: definir @password (min 16) y hacer USE <base> antes de correr el script`';

/* ------------------------------------------------------------------ vista */
SET @permitidas := 'IDEMPRESA,DESCRIPCION,localidad,Provincia,TipoServidor,DbServer,DbPort,DbInstance,DbName,FileServerUrl,PacsUrl,SessionIdleMinutes,Logo';

SET @cols := (
	SELECT GROUP_CONCAT(CONCAT('`', COLUMN_NAME, '`') ORDER BY FIND_IN_SET(COLUMN_NAME, @permitidas) SEPARATOR ', ')
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
	  AND TABLE_NAME = 'Empresas'
	  AND FIND_IN_SET(COLUMN_NAME, @permitidas) > 0
);
SET @ok := @ok AND @cols IS NOT NULL;

SET @sql := IF(@ok, CONCAT('CREATE OR REPLACE SQL SECURITY DEFINER VIEW `', @vista, '` AS SELECT ', @cols, ' FROM `Empresas`'), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ---------------------------------------------------------------- usuario */
SET @cuenta := CONCAT(QUOTE(@usuario), '@', QUOTE(@host));

SET @sql := IF(@ok, CONCAT('CREATE USER IF NOT EXISTS ', @cuenta, ' IDENTIFIED BY ', QUOTE(@password)), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@ok, CONCAT('ALTER USER ', @cuenta, ' IDENTIFIED BY ', QUOTE(@password), ' WITH MAX_USER_CONNECTIONS 10'), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Arranca de cero: sin ningún privilegio previo.
SET @sql := IF(@ok, CONCAT('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ', @cuenta), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@ok, CONCAT('GRANT SELECT ON `', DATABASE(), '`.`', @vista, '` TO ', @cuenta), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/* ----------------------------------------------------------- verificación */
SELECT @cols AS columnas_de_la_vista;
SET @sql := IF(@ok, CONCAT('SHOW GRANTS FOR ', @cuenta), @falla);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

/*
  Prueba manual conectado como misalud_catalogo_ro:
    SELECT IDEMPRESA, DESCRIPCION, FileServerUrl FROM vw_MiSaludEmpresas;   -- funciona
    SELECT DbPassword FROM Empresas;                                         -- tiene que fallar
    SELECT * FROM imPassword;                                                -- tiene que fallar

  Baja:
    DROP USER IF EXISTS 'misalud_catalogo_ro'@'%';
    DROP VIEW IF EXISTS vw_MiSaludEmpresas;
*/
