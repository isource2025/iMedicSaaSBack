# Usuarios de solo lectura para MiSalud (S4, S5)

MiSaludBack (portal del paciente) no tiene que conectarse con los usuarios de
iMedic, que pueden escribir. Estos scripts crean usuarios que solo leen lo que
el portal necesita. Ninguno se ejecuta solo: los corre un DBA.

## S4 — SQL Server de cada clínica: `crear_usuario_portal_ro_sqlserver.sql`

Crea el login `misalud_portal_ro` y, en la base de la clínica, el rol
`misalud_lectura` con `SELECT` sobre una lista cerrada de tablas (paciente,
visitas, epicrisis, adjuntos de estudios, catálogos) y `EXECUTE` sobre
`fn_ClarionDATE2SQL`. Niega `INSERT`/`UPDATE`/`DELETE`/`ALTER` sobre `dbo`.
Las tablas que no existan en esa clínica se saltean y se informan.

1. SSMS conectado como `sysadmin` (o `securityadmin` + `db_owner` de la base).
2. Editar al inicio: `@BaseClinica`, `@Password` (≥ 16 caracteres, al azar,
   distinta por clínica) y `@IncluirFase2` (laboratorio, turnos,
   evoluciones: `0` para el MVP).
3. Ejecutar. Es idempotente: re-ejecutarlo cambia la contraseña y vuelve a
   aplicar permisos.
4. Correr el bloque de verificación del final (comentado) conectado como
   `misalud_portal_ro`.
5. Cargar en MiSaludBack (Railway) la contraseña para esa clínica. No se
   guarda en `Empresas.DbPassword` de iMedic.

Compatible con SQL Server 2008 R2 en adelante. El login usa autenticación
SQL, así que el servidor tiene que estar en modo mixto (iMedic ya lo usa).

Si el portal se conecta por un túnel, abrirlo solo para este usuario y no
reutilizar el puerto/usuario de iMedic.

## S5 — MySQL de plataforma: `crear_usuario_catalogo_ro_mysql.sql`

Crea la vista `vw_MiSaludEmpresas` con columnas permitidas de `Empresas`
(id, nombre, localidad, servidor/base SQL **sin usuario ni contraseña**,
`FileServerUrl`, `PacsUrl`, `Logo`, `SessionIdleMinutes`) y el usuario
`misalud_catalogo_ro` con `SELECT` **solo** sobre esa vista (máx. 10
conexiones). No ve `DbUser`, `DbPassword`, `DbPasswordEnc`, tokens de
WhatsApp, `imPassword`, sesiones ni ninguna otra tabla. Las columnas nuevas que
se agreguen a `Empresas` no aparecen hasta que se agreguen a la lista del
script.

1. Cliente MySQL conectado con el usuario dueño de la base (el de
   `AUTH_DB_USER`).
2. `USE <base>;` y cambiar `@password` en el script.
3. Ejecutar. Es idempotente.
4. Probar como `misalud_catalogo_ro`: la vista responde; `SELECT DbPassword
   FROM Empresas` falla.

La vista es `SQL SECURITY DEFINER`: si se elimina el usuario que la creó, hay
que volver a correr el script.

## Contraseñas

Generarlas al azar (`openssl rand -base64 24`), guardarlas solo en las
variables de MiSaludBack y no pegarlas en chats, tickets ni commits.
