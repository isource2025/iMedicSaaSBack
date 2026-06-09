# Despliegue en paralelo: Render + Front 1 vs Railway + Front 2

Mismo repositorio, **dos pistas** que no se pisan. Los commits nuevos apuntan a Railway; Render queda congelado en un commit/tag específico.

## Arquitectura (ambas pistas)

| Capa | Railway (nuevo) | Render (legacy) |
|------|-----------------|-----------------|
| Login / catálogo | **MySQL** (`AUTH_DB_*`) | SQL Server plataforma (`DB_*`) o MySQL si ya migraste |
| Conexión clínica | Por empresa: `Empresas.DbServer`, `DbPort`, `DbName`, `DbUser`, `DbPasswordEnc` en **MySQL** | Igual, leído desde SQL Server plataforma o MySQL |
| Backend | Railway | Render |
| Frontend | Vercel **Front 2** (nuevo) | Vercel **Front 1** (commit fijo) |

Los datos clínicos **siempre** van al SQL Server de cada empresa (fila `Empresas`), no al MySQL de auth.

## Pista A — Render + Front 1

> **Hotfixes compartidos (auth, evoluciones, catálogos):** desplegar `main` también en Render
> hasta estabilizar ambas pistas. Luego se puede volver a congelar en un tag.

1. En Render: branch **`main`** (o tag de hotfix reciente en `main`).
   ```env
   DB_SERVER=...
   DB_PORT=1433
   DB_NAME=...
   DB_USER=...
   DB_PASSWORD=...
   DB_INSTANCE=SQLEXPRESS
   JWT_SECRET=...
   PLATFORM_DB_SECRET=...
   CORS_ORIGINS=https://<front-1>.vercel.app
   AUTH_DB_ENABLED=0
   ```
4. Front 1 (Vercel):
   ```env
   NEXT_PUBLIC_API_URL=https://imedicwsback.onrender.com/api
   ```

## Pista B — Railway + Front 2 (commits actuales en adelante)

### Backend Railway

**Obligatorias (MySQL auth):**
```env
AUTH_DB_ENABLED=1
AUTH_DB_HOST=<host público MySQL Railway>
AUTH_DB_PORT=3306
AUTH_DB_USER=...
AUTH_DB_PASSWORD=...
AUTH_DB_NAME=...
AUTH_DB_SSL=0

JWT_SECRET=...
PLATFORM_DB_SECRET=...
CORS_ORIGINS=https://<front-2>.vercel.app,http://localhost:3000
```

**No obligatorias** si `Empresas` en MySQL tiene `DbServer`, `DbPort`, `DbName`, `DbUser`, `DbPasswordEnc` (como en tu captura):
```env
# DB_SERVER=...   ← solo fallback legacy / super-admin antiguo
```

MySQL debe tener la tabla `Empresas` con columnas de conexión por tenant.

### Front 2 Vercel

```env
NEXT_PUBLIC_API_URL=https://imedicwsback-production.up.railway.app/api
```

Con `https://` y `/api` al final.

## Verificación en logs Railway

Al arrancar deberías ver:
```
✓ AUTH MySQL → ...
ℹ SQL Server plataforma (.env DB_*): no configurado — OK en Railway si AUTH_DB=1
→ Modo Railway: login/catálogo en MySQL; datos clínicos por Empresas.DbServer/DbName/...
```

## Regla de commits

| Destino | Branch/tag | Quién recibe deploy automático |
|---------|------------|--------------------------------|
| Render + Front 1 | `render-prod-*` o branch `render-stable` | Solo ese ref |
| Railway + Front 2 | `main` (o `railway-prod`) | Commits nuevos |

No mezclar variables de Render en Railway ni al revés sin revisar `AUTH_DB_ENABLED`.
