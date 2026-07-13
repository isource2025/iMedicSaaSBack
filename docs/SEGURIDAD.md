# Seguridad de autenticación — iMedicSaaS

Documento técnico de las medidas de seguridad implementadas en el sistema de login y sesiones.
Actualizado tras el hardening de julio 2026.

---

## 1. Resumen ejecutivo

iMedicSaaS es un SaaS médico multi-tenant. Los datos de autenticación viven en **MySQL Railway**; los datos clínicos en **SQL Server por empresa**. Este documento describe cómo se protege el acceso ante enumeración de usuarios, fuerza bruta, robo de sesión y accesos desde regiones no autorizadas.

### Principios aplicados

| Principio | Implementación |
|-----------|----------------|
| Autenticar antes de revelar contexto | Empresas solo tras validar usuario+contraseña |
| Respuestas uniformes | Mismo mensaje para usuario inexistente y contraseña incorrecta |
| Defensa en profundidad | Rate limit + geo-block + hashing + cookies httpOnly + auditoría |
| Minimización | JWT sin permisos clínicos extensos; sector no obligatorio en login |
| Trazabilidad | Tabla `AuthAuditLog` en Railway |

---

## 2. Flujo de login (patrón banco/AFIP)

```
┌─────────────┐     POST /auth/login          ┌─────────────┐
│  Frontend   │  { username, password } ──► │   Backend   │
└─────────────┘                               └──────┬──────┘
       ▲                                             │
       │         ◄── 401 "Usuario o contraseña       │ Verifica Argon2id
       │              incorrectos" (siempre igual)  │ + timing pad ~350ms
       │                                             │
       │         ◄── 200 step: SELECT_EMPRESA      │ Solo si misma credencial
       │              + tempToken + empresas[]      │ válida en >1 empresa
       │                                             │
       │     POST /auth/login                      │
       │  { username, password, idEmpresa,         │
       │    tempToken }                            │
       │                                             ▼
       │         ◄── 200 step: COMPLETE            Set-Cookie httpOnly
       │              + datos sesión               imedic_access / imedic_refresh
       └─────────────────────────────────────────────┘
```

### Observaciones de diseño

- **No hay descubrimiento de empresas al tipear el usuario.** Los endpoints `GET /auth/empresas/:username` y `GET /auth/sectores/:username` están **deshabilitados** (HTTP 410).
- **Sector no se elige en login.** Si el usuario tiene sectores, se asigna el primero automáticamente; puede cambiarlo dentro de la aplicación.
- **Empresa solo si hay más de una** con las mismas credenciales válidas.

---

## 3. Contraseñas (Argon2id)

| Aspecto | Detalle |
|---------|---------|
| Algoritmo | Argon2id (`memoryCost: 65536`, `timeCost: 3`) |
| Columna | `imPassword.PasswordHash` (VARCHAR 255) en MySQL Railway |
| Migración | Dual: si existe hash → Argon2; si no → compara legacy `Password` y re-hashea al login exitoso |
| SQL físico | Misma lógica en `tenantRegistry.autenticarEnTenant` con columna `PasswordHash` si existe |

**Importante:** Las contraseñas legacy en texto plano siguen funcionando hasta el primer login exitoso post-deploy, momento en el cual se genera el hash.

---

## 4. Sesiones y cookies

### Cookies

| Cookie | Atributos | Propósito |
|--------|-----------|-----------|
| `imedic_access` | `httpOnly`, `Secure` (prod), `SameSite=Strict` | JWT de acceso |
| `imedic_refresh` | Igual, `path=/api/auth` | Refresh rotativo (7 días máx.) |

### Expiración por inactividad (no por reloj fijo)

- La sesión **no expira a los 15 minutos de login** si el usuario sigue activo.
- Expira tras **`SESSION_IDLE_MINUTES` sin actividad** (default: **30 min**).
- Configurable en Super Admin → pestaña **Seguridad**.
- Opcional por empresa: columna `Empresas.SessionIdleMinutes`.

### Tabla `AuthSessions` (MySQL)

```
SessionId, ValorPersonal, Username, IdEmpresa,
RefreshTokenHash, LastActivityAt, ExpiresAt, Revoked, Ip, UserAgent
```

Cada request autenticado valida `LastActivityAt + idleMinutes > now()` y actualiza la actividad.

### Endpoints de sesión

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Autenticación |
| POST | `/api/auth/logout` | Revoca sesión y limpia cookies |
| POST | `/api/auth/refresh` | Renueva tokens (llamado por actividad del frontend) |
| GET | `/api/auth/me` | Datos de sesión actual |

### Frontend

- `axios` con `withCredentials: true`
- Monitor de actividad (`sessionActivity.ts`): ping a `/auth/refresh` cada 5 min o tras interacción
- **No se guarda el token en localStorage** cuando se usan cookies (modo Railway)
- Compatibilidad legacy local: si no hay MySQL auth, se devuelve `token` en body

---

## 5. Anti-enumeración y anti-fuerza bruta

| Medida | Configuración |
|--------|---------------|
| Mensaje único | `"Usuario o contraseña incorrectos"` en todos los fallos de credenciales |
| Timing constante | `AUTH_TIMING_PAD_MS` (default 350 ms) en cada intento de login |
| Rate limit login | 20 intentos / 15 min por IP+usuario (`AUTH_LOGIN_RATE_MAX`) |
| Rate limit auth general | 60 req/min en rutas `/auth/*` |
| Auditoría | `AuthAuditLog`: LOGIN_OK, LOGIN_FAIL, LOGIN_MULTI_EMPRESA, GEO_BLOCKED, LOGOUT |

---

## 6. Geo-blocking

### Funcionamiento

1. Se resuelve el país del IP con `geoip-lite`.
2. Se consulta `AuthPaisesPermitidos` en MySQL.
3. Por defecto solo **AR (Argentina)** está activo.
4. IPs locales/LAN (`127.0.0.1`, `192.168.*`, `10.*`) siempre permitidas (desarrollo).

### Panel de administración

**Super Admin → Seguridad**

- Listar países permitidos
- Activar / desactivar país
- Agregar nuevo país (ej. `PY` Paraguay)
- Configurar timeout de inactividad

### API (requiere `PLATAFORMA.CONFIG.GESTIONAR`)

```
GET    /api/auth/seguridad/config
PUT    /api/auth/seguridad/config   { idleTimeoutMinutes }
GET    /api/auth/seguridad/paises
POST   /api/auth/seguridad/paises { codigoISO, nombre, activo }
PATCH  /api/auth/seguridad/paises/:codigo { activo }
```

---

## 7. Headers y perímetro

| Medida | Estado |
|--------|--------|
| Helmet | Activo (CSP deshabilitado por compatibilidad API) |
| `trust proxy` | Activo (Railway / reverse proxy) |
| CORS | `credentials: true`; en producción definir `CORS_ORIGINS` |
| JWT en query string | **Eliminado** del frontend (`authFetch`) |
| `JWT_SECRET` | Obligatorio en producción (mín. 32 caracteres) |

---

## 8. Despliegue

### 1. Variables de entorno obligatorias (producción)

```env
JWT_SECRET=<clave-aleatoria-64-chars>
AUTH_DB_ENABLED=1
CORS_ORIGINS=https://tu-frontend.railway.app
NODE_ENV=production
```

### 2. Migración MySQL

```bash
cd iMedicSaaSBack
npm run auth:mysql:security-migrate
# o con credenciales Railway:
node scripts/apply_security_mysql.js --env-file .env.railway.local
```

Crea: `AuthAuditLog`, `AuthSessions`, `AuthPaisesPermitidos`, `imPassword.PasswordHash`, seed AR.

### 3. Deploy backend + frontend

Tras deploy, los usuarios deben **volver a iniciar sesión**.

---

## 9. Matriz de amenazas mitigadas

| Amenaza | Mitigación | Residual |
|---------|------------|----------|
| Enumeración de usuarios | Sin discovery endpoints; mensaje uniforme | Bajo |
| Credential stuffing | Rate limit + geo-block + auditoría | Medio (sin MFA aún) |
| Robo de JWT por XSS | Cookies httpOnly | Bajo si no hay XSS |
| Session fixation | Refresh rotativo + sessionId UUID | Bajo |
| Dump de BD con passwords | Argon2id | Bajo tras migración completa |
| Acceso desde país no autorizado | Geo-blocking configurable | Medio (VPN puede evadir) |
| DoS en login | Rate limit por IP | Medio |

---

## 10. Pendiente / roadmap

| Item | Prioridad | Notas |
|------|-----------|-------|
| MFA TOTP (ADMIN, MEDICO) | Alta | No implementado en esta fase |
| CAPTCHA adaptativo (Turnstile) | Media | Tras N fallos |
| PHI access log (quién vio qué paciente) | Alta | Separado de AuthAuditLog |
| Pentest OWASP ASVS L2 | Media | Anual |
| Bloqueo de contraseñas comprometidas (HIBP) | Baja | |

---

## 11. Archivos relevantes

### Backend

| Archivo | Rol |
|---------|-----|
| `src/config/security.js` | Constantes y utilidades |
| `src/config/jwt.js` | Secret y expiraciones |
| `src/services/password.service.js` | Argon2id |
| `src/services/session.service.js` | Cookies y sesiones |
| `src/services/authAudit.service.js` | Auditoría |
| `src/services/geoPolicy.service.js` | Países permitidos |
| `src/services/authLoginFlow.service.js` | Completar login |
| `src/controllers/auth.controller.js` | Endpoints |
| `src/middlewares/rateLimit.middleware.js` | Rate limiting |
| `src/middlewares/geoBlock.middleware.js` | Geo-block en login |
| `src/middlewares/authJwt.middleware.js` | Validación JWT + sesión |
| `scripts/apply_security_mysql.js` | Migración |

### Frontend

| Archivo | Rol |
|---------|-----|
| `src/app/hooks/useLoginForm.ts` | Flujo login en 2 pasos |
| `src/app/components/Login/LoginForm.tsx` | UI sin sector |
| `src/app/utils/sessionActivity.ts` | Monitor inactividad |
| `src/app/components/SuperAdmin/SuperAdminSeguridadPanel.tsx` | Panel geo + idle |

---

## 12. Contacto y respuesta a incidentes

Ante sospecha de compromiso de credenciales:

1. Revocar sesiones del usuario en `AuthSessions` (`Revoked = 1`)
2. Forzar cambio de contraseña
3. Revisar `AuthAuditLog` por IP y eventos `LOGIN_OK` / `LOGIN_FAIL`
4. Notificar a la institución afectada según Ley 25.326 si hubo acceso a datos personales

---

*Documento generado como parte del hardening de seguridad iMedicSaaS.*
