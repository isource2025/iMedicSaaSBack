# Esquema Bot WhatsApp — mínimo de tablas

## Turnera (sin tablas nuevas)
El bot asigna turnos sobre tablas clínicas existentes:
- `imTurnos`, `imPersonalHorarios`, `imPersonalNoHorarios`, `imFeriados`
- `imPacientes`, `imPersonal`

## Bot WhatsApp (2 tablas)
| Tabla | Uso |
|-------|-----|
| `imBotConfig` | Configuración clave/valor (prompt, reglas, WhatsApp) |
| `imBotChat` | **Una tabla** con columna `Tipo`: `SESION` (inbox), `MSG` (mensajes), `LOG` (auditoría turnos) |

Reemplaza el esquema legacy de 3 tablas: `imBotConversacion`, `imBotMensaje`, `imBotTurnosLog`.

## Instalación (remoto / producción)
**Script único recomendado** — crea esquema, migra legacy, elimina tablas viejas:
```bash
# SSMS: scripts/sql/deploy_bot_whatsapp_remoto.sql
# O con .env del backend:
cd iMedicWSBack
node scripts/ejecutar_deploy_bot_remoto.js
node scripts/audit_bot_schema.js
node scripts/smoke_bot_conversaciones.js
```

## Instalación (solo desarrollo / sin borrar legacy)
```bash
node scripts/ejecutar_setup_bot.js
node scripts/audit_bot_schema.js
```

O en SSMS: `scripts/sql/setup_bot_minimal.sql`

## Migración legacy
El setup copia datos de tablas viejas a `imBotChat` si existen y `imBotChat` está vacío.
Las tablas legacy **no se borran** automáticamente (sección opcional al final del SQL).

## Memoria
Solo desarrollo con `BOT_CONVERSACIONES_MEMORIA=1`. Producción: siempre SQL.
