# Migración onboarding → iMedic

Herramientas para poblar un tenant iMedic limpio desde una BD origen legada (mismo esquema SQL Server).

## Requisitos

1. BD origen accesible (mismo servidor o red)
2. BD destino = clon del esquema iMedic **sin datos clínicos**
3. Variables en `.env`: `DB_SERVER`, `DB_USER`, `DB_PASSWORD`

## Uso

```bash
cd iMedicSaaSBack

# 1. Validar / purgar destino
npm run onboarding:prepare -- --target-db MiClienteImedic
npm run onboarding:prepare -- --target-db MiClienteImedic --purge

# 2. Migración completa
npm run onboarding:migrate -- --source-db NombreOrigen --target-db MiClienteImedic --dry-run
npm run onboarding:migrate -- --source-db NombreOrigen --target-db MiClienteImedic --admin-user admin --admin-pass Admin2026!

# 3. Corrección post-migración (sectores, camas, internaciones antiguas)
npm run onboarding:fix -- --source-db NombreOrigen --target-db MiClienteImedic

# 3b. Tablas del turnero (pantalla de llamados TV)
npm run setup:turnero

# 4. Cerrar internaciones abiertas >1 mes
npm run onboarding:close-stale -- --target-db MiClienteImedic --reference-date 2026-07-11
```

Variables opcionales: `SOURCE_DB_NAME`, `IMEDIC_TARGET_DB`, `ONBOARDING_ADMIN_USER`, `ONBOARDING_ADMIN_PASS`, `ONBOARDING_REFERENCE_DATE`.

## Fases incluidas

| Fase | Origen | Destino iMedic |
|------|--------|----------------|
| schema | — | `_onboardingMigracion*` |
| catalogos | Localidades usadas | imLocalidades |
| sectores | **dbo.Sector** | imSectores |
| habitaciones | **dbo.Sectores** (`SECTOR` = `Sector.SECTOR`) | imHabitacionCamas |
| prestadores | Prestadores (filtro matrícula/fecha) | imPersonal |
| pacientes | Pacientes, ConvPacientes | imPacientes |
| internaciones | Internaciones, SegInternaciones | imVisita, imVisitaMovimiento |
| admin | — | usuario admin + sectores |

## Fuera de alcance (no migrar)

- **Historia clínica** (`HistoriasClinicas` → `imHCI`)
- **Medicamentos** (`MedInternaciones`, indicaciones, etc.)
- **Facturación** (`Convenios` → `imClientes`, `LinInternaciones`, códigos de facturación, etc.)

Los pacientes conservan `NumeroCuenta` / afiliado desde origen; las visitas pueden tener `CLIENTE` numérico sin catálogo de obras sociales cargado.

## Camas

1. **Sectores** (`imSectores`): solo desde `dbo.Sector`.
2. **Camas** (`imHabitacionCamas`): desde `dbo.Sectores`, match exacto `Sectores.SECTOR` = `Sector.SECTOR`.
3. Ocupación: internaciones activas vigentes; cierre automático de abiertas >1 mes.

## sector_map.default.json

Overrides opcionales por código de sector.
