# Gates por nombre de rol → permiso

Inventario accionable (Fase 1). Cada fila indica el reemplazo por código de la matriz.

| Prioridad | Ubicación | Check actual | Permiso destino | Notas |
|-----------|-----------|--------------|-----------------|-------|
| P0 | `propietario.middleware.js` `esAdminClinico` + UI `useUsuarioActual.esAdminClinico` | rol ADMIN / id 1 / Grupo 11 | `INTERNACION.REGISTROS.EDITAR_AJENOS` | Bypass de autoría en internación |
| P0 | `opcGrd.routes.js` + `admin.middleware.js` | stub que deja pasar | `CONFIGURACION.OPCGRD.*` (CRUD) | Reemplazar stub |
| P1 | `agenda.controller` cerrar / post-cierre | `rolNombre === ENFERMERO` → 403 | `TURNOS.AGENDA.CERRAR` | Sin el permiso → 403 |
| P1 | `agenda.controller` / `turnero` `porIdTurno` | `!== MEDICO` | `TURNOS.AGENDA.SOLO_PROPIA` | Si tiene SOLO_PROPIA → porIdTurno false |
| P1 | `matriculaTenant.matriculaAlcanceAgenda` / RAC | `=== MEDICO` | `TURNOS.AGENDA.SOLO_PROPIA` | Fuerza matrícula propia |
| P1 | `indicaciones.controller` marcar visto | `!== ENFERMERO` | `INTERNACION.INDICACIONES.MARCAR_VISTO` | Hook front igual |
| P1 | estudios / solicitudes / interconsultas `_veTodos*` | SUPER_ADMIN / esAdminClinico | `INTERNACION.ESTUDIOS.VER_TODOS` / `INTERNACION.INTERCONSULTAS.VER_TODOS` | Bandeja todos los sectores |
| P2 | Front `rolTieneAccesoConversaciones` | ≠ MEDICO | `TURNOS.CONVERSACIONES.VER` | Sidebar + página chats |
| P2 | `asistente/sql.js` `puedeUsarSql` | allowlist de roles + permiso huérfano | `ASISTENTE.SQL.VER` | Registrar en MODULOS; roles via plantilla |
| — | `roles.controller` escalada ADMIN/SUPER_ADMIN | identidad de sistema | *(sin cambio)* | Fuera de alcance ACL |
| — | Login / plataforma SUPER_ADMIN | identidad | *(sin cambio)* | Bootstrap de plataforma |

## Script de detección

```bash
node scripts/audit_gates_rol.js
node scripts/audit_gates_rol.js --json
```

## Lineamiento al agregar un permiso nuevo

1. `src/utils/permisos.js` + espejo front `permisos.ts` (`MODULOS` / `PLANTILLAS`).
2. `src/utils/permisosDescripciones.js`.
3. `node scripts/check_permisos_front.js --estricto`
4. `node tests/permisos.snapshot.test.js --actualizar` (si el cambio es deliberado)
5. `node scripts/seed_permisos.js` en entornos con BD de permisos
6. Cablear `requirePermiso` / `puede(...)` y quitar el `if (rol === …)`
