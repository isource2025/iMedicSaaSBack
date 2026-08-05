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

## Identidad multi-tenant (clave compuesta)

Clave de login y personal en MySQL:

```
(IdEmpresa, ValorPersonal)
```

| Ámbito | IdEmpresa | ValorPersonal |
|--------|-----------|----------------|
| Hospital / tenant | `> 0` (catálogo Empresas) | **Mismo id del SQL físico** de esa empresa (sin remapear) |
| Plataforma SaaS | `0` | Rango reservado `>= PLATFORM_VALOR_MIN` (default `1000000`), p.ej. superadmin |

### Reglas

1. El sync físico → MySQL **solo escribe** filas con `IdEmpresa = empresa tenant`.
2. `IdEmpresa = 0` es **intocable** por import/sync/reconcile/purge de hospitales.
3. Usernames reservados (`superadmin`, etc.) **no se copian** del físico a un tenant.
4. Login de plataforma (`autenticarPlataforma`) solo mira `IdEmpresa = 0`.
5. Los purges MySQL usan `IdEmpresa > 0` para no borrar el superadmin por coincidencia de `ValorPersonal`.

### Colisiones entre hospitals

Dos hospitales pueden tener el mismo `ValorPersonal` (ej. `7721`) sin choque: viven en `(1,7721)` y `(2,7721)`.  
**No** se debe modelar la PK solo por `ValorPersonal`.

Si un script legacy migraba sin `IdEmpresa`, puede haber mezclas históricas; la reconciliación y el sync actual respetan la clave compuesta.

## Reconciliación

Comparar espejo MySQL vs SQL tenant y corregir drift:

```bash
npm run auth:mysql:reconcile
npm run auth:mysql:reconcile -- --empresa=1
npm run auth:mysql:reconcile -- --fix
```

## Infraestructura

```bash
npm run auth:mysql:infra-migrate   # migraciones SQL incrementales
npm run auth:mysql:infra-check     # diagnóstico MySQL
npm run auth:mysql:infra-check -- --deep --reconcile
```

API: `GET /api/health?deep=1`

## Sync sin SQL plataforma

Con `AUTH_DB=1` y **sin** `DB_*` en `.env` (modo Railway puro), `auth:mysql:sync` lee empresas desde MySQL y sincroniza auth desde cada SQL tenant configurado en `Empresas.Db*`.
