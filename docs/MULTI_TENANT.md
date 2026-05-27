# Multi-tenant: conexión SQL por empresa

## Modelo

| Capa | BD | Contenido |
|------|-----|-----------|
| **Plataforma** | `.env` (`DB_*`) | `Empresas` (catálogo + credenciales), Super Admin, `imUsuarioEmpresaLogin` |
| **Tenant** | Por fila en `Empresas` | `imPassword`, pacientes, agenda, etc. |

Si `DbServer` / `DbName` están vacíos, se usa la misma conexión del `.env` (comportamiento actual).

## Tablas nuevas / columnas

Ejecutar en la BD plataforma:

`scripts/sql/setup_empresa_conexion.sql`

- Columnas en `Empresas`: `DbServer`, `DbPort`, `DbInstance`, `DbName`, `DbUser`, `DbPasswordEnc`
- Índice: `imUsuarioEmpresaLogin` (`NombreRed`, `IdEmpresa`)

## Variables de entorno

```env
PLATFORM_DB_SECRET=...   # cifrado de contraseñas SQL por empresa (fallback: JWT_SECRET)
TENANT_DISCOVER_MAX=25   # máximo de tenants a escanear si no hay índice
TENANT_CONNECT_TIMEOUT_MS=12000
```

## Login

1. El usuario escribe **nombre de red** → `GET /api/auth/empresas/:username` descubre tenants (índice + escaneo limitado).
2. Si hay varias empresas, elige una → sectores con `?idEmpresa=`.
3. `POST /api/auth/login` con `username`, `password`, `idEmpresa`, sector.
4. El JWT incluye `idEmpresa`; las rutas protegidas usan el pool del tenant vía `AsyncLocalStorage`.

**SUPER_ADMIN**: autenticación en BD plataforma; `idEmpresa` en JWT es `null`.

## Super Admin

- Alta/edición de conexión: `PUT /api/super-admin/empresas/:id/conexion`
- Probar conexión: `POST /api/super-admin/empresas/:id/conexion/probar`

## Alternativas (escalabilidad)

- Escaneo acotado por `TENANT_DISCOVER_MAX` + índice `imUsuarioEmpresaLogin`.
- **Servicio de identidad** central (Keycloak / Azure AD) y solo SQL por tenant para datos clínicos.
- **Secret Manager** (Azure Key Vault) en lugar de `DbPasswordEnc` en tabla.
