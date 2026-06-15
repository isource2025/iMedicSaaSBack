# Login Central MySQL

Este backend puede usar una base MySQL central en Railway para resolver el login usando **las mismas tablas legacy** que hoy consulta el sistema.

## Tablas replicadas

- `Empresas`
- `imPassword`
- `imPersonal`
- `imRoles`
- `imPermisos`
- `imRolPermisos`
- `imPersonalEmpresas`
- `imPersonalSectores`
- `imSectores`
- `imUsuarioEmpresaLogin`
- `EmpresasModuloPack`
- `imIVA`

### Tablas plataforma Super Admin (SaaS)

Migración adicional: `scripts/sql/setup_platform_mysql.sql`

- `EmpresasOnboarding`
- `EmpresasSuscripcion`
- `imPlataformaConfig`

```bash
npm run auth:mysql:platform-migrate
```

## Setup

```bash
npm run auth:mysql:sync
```

Ese script:

1. crea el schema MySQL si no existe,
2. migra los datos actuales desde SQL Server por `upsert`,
3. no borra datos existentes en Railway,
4. deja el backend listo para leer login desde Railway si `AUTH_DB_ENABLED=1`.

## Variables

```env
AUTH_DB_ENABLED=1
AUTH_DB_HOST=...
AUTH_DB_PORT=3306
AUTH_DB_USER=...
AUTH_DB_PASSWORD=...
AUTH_DB_NAME=...
AUTH_DB_SSL=1
```

## Comportamiento

Si `AUTH_DB_ENABLED=1`:

1. autenticación,
2. discovery de empresas,
3. sectores de login,
4. permisos por rol,
5. packs de empresa,
6. catálogo `Empresas` para login

se intentan resolver primero desde Railway MySQL. Si falla, el backend cae al flujo legacy en SQL Server.

## Importante

La migracion actual es **no destructiva**:

- no ejecuta `DELETE`,
- no limpia tablas destino,
- inserta o actualiza por clave primaria / unica.

Si existen colisiones de IDs legacy entre tenants (`ValorPersonal`, `IdRol`, `IdPermiso`, etc.), MySQL hara `update` sobre la fila existente en vez de crear otra. Eso no borra datos, pero puede mezclar identidades que compartan la misma clave.

## Reconciliación

Comparar espejo MySQL vs SQL tenant y corregir drift:

```bash
npm run auth:mysql:reconcile
npm run auth:mysql:reconcile -- --empresa=1
npm run auth:mysql:reconcile -- --fix
```
