# QA — gates por permiso (checklist)

## Automatizado

```bash
cd iMedicSaaSBack
node scripts/check_permisos_front.js --estricto
node scripts/audit_gates_rol.js --fail
node scripts/audit_rutas_permisos.js
node --test tests/gates.permisos.nuevos.test.js tests/permisos.snapshot.test.js tests/personalPermisos.test.js tests/permisos.overrides.integracion.test.js
```

## Manual (auth central ON)

1. Personal → alta/edición → Cuenta: marcar rol, ver matriz (estilo Matriz de permisos), ajustar extras, guardar.
2. Login como ese usuario: menú y APIs alineados a efectivos.
3. DENY de un permiso del rol → 403 en API y UI oculta tras refresh.
4. GRANT de `INTERNACION.REGISTROS.EDITAR_AJENOS` a un no-ADMIN → puede editar registro ajeno.
5. Sin `TURNOS.AGENDA.CERRAR` → 403 al cerrar turno.
6. Con `TURNOS.AGENDA.SOLO_PROPIA` sin `GESTIONAR` → solo agenda propia.
7. `TURNOS.CONVERSACIONES.VER` → aparece Conversaciones; sin él, no.
8. SUPER_ADMIN / login plataforma sin regresión.
