# Test: login multi-empresa

## 1. Una sola vez — preparar BD

Desde `iMedicWSBack`:

```powershell
# DDL + conexiones + índice de usuarios
node scripts/setup_empresa_conexion.js

# Opcional: 2ª empresa (misma BD) para probar selector de empresas
$env:SEED_EMPRESA_DEMO="1"
node scripts/setup_empresa_conexion.js
```

Requisitos en `.env`:

```env
DB_SERVER=...
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
DB_PORT=1433
DB_INSTANCE=SQLEXPRESS
PLATFORM_DB_SECRET=una-clave-secreta-larga
TENANT_DISCOVER_MAX=25
```

## 2. Reiniciar backend

```powershell
npm run dev
```

## 3. Probar en el front (login)

1. Abrir login (`http://localhost:3000` o el puerto del front).
2. Escribir un **usuario** que exista en `imPassword` (ej. un médico o admin de prueba).
3. Esperar **2 segundos** sin escribir → spinner al final del input.
4. Resultados esperados:
   - **1 empresa**: campo Empresa en gris + selector de Sector.
   - **2+ empresas**: primero elegir Empresa, luego Sector.
5. Contraseña + **Ingresar**.

## 4. Verificar API (opcional)

```http
GET /api/auth/empresas/{username}
GET /api/auth/sectores/{username}?idEmpresa=1
POST /api/auth/login
  { "username", "password", "idEmpresa", "idSector", "sector" }
```

El JWT debe incluir `idEmpresa` (null solo para SUPER_ADMIN de plataforma).

## 5. Super Admin

- `PUT /api/super-admin/empresas/:id/conexion` — cambiar servidor/BD de un tenant.
- `POST /api/super-admin/empresas/:id/conexion/probar` — probar conexión.

## 6. Troubleshooting

| Problema | Acción |
|----------|--------|
| No aparecen empresas | `node scripts/setup_empresa_conexion.js` (reindexa usuarios) |
| Error de conexión tenant | Revisar `DbServer`/`DbName` en `Empresas` o Super Admin → Conexión SQL |
| Escaneo lento | Completar `imUsuarioEmpresaLogin`; subir `TENANT_DISCOVER_MAX` solo si hace falta |
| Columnas faltantes | Volver a ejecutar `scripts/sql/setup_empresa_conexion.sql` |

## 7. Usuarios de prueba

- **Super Admin plataforma**: `node scripts/crear_super_admin_test.js` → `superadmin` / `SuperAdmin2026!`
- **Operador clínico**: cualquier `NombreRed` en `imPassword` de la BD tenant.
