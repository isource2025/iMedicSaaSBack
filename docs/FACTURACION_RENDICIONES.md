# Facturación › Rendiciones — auditoría y estado

Estado: **pantalla y API rehechas y probadas en local (16/10/2026)**. La web consulta, da de alta cabeceras vacías, edita y borra solo rendiciones vacías. **La valorización (el "motor") sigue en el sistema de escritorio** y será un proyecto aparte.

Pruebas contra la base local `iSource`:

```bash
cd iMedicSaaSBack
node scripts/smoke_rendiciones.js        # servicio directo: crea una rendición vacía, la edita y la borra
node scripts/smoke_rendiciones_http.js   # API por HTTP (backend corriendo): 401 / 200 / 400 / 404 / 409
```

---

## ⚠ Pendientes y decisiones

- **Alta (decisión 16/10/2026):** «Agregar rendición» crea solo la cabecera (cliente, convenio, período, observaciones) con importes en 0. Las visitas las agrega y valoriza el sistema de escritorio.
- **Borrado (decisión 16/10/2026):** solo rendiciones vacías: sin líneas en `imFacDetalle`, sin `imFacturas.IdRendicion` y sin `FacturacionProfDetalle.IdRendicion`. El `DELETE` vuelve a verificar las tres condiciones en la misma sentencia (`@@ROWCOUNT = 0` → 409). Borrar una con líneas exigiría liberar `imFacPracticas.Factura` / `imFacProfesionales.Factura`; no se hace desde la web.
- **Cierre: pendiente con el PM.** Hoy solo se muestra el estado (`FechaCierre > 0` = cerrada). Las 7.029 rendiciones de la base local están abiertas. Hay que definir qué bloquea el cierre (¿facturas?, ¿edición de líneas?) y quién puede reabrir.
- **Edición:** las observaciones se editan siempre. Cliente, convenio y período solo si la rendición no tiene líneas (409 si tiene). Una rendición cerrada no se edita (409).
- **Motor de rendiciones (proyecto futuro):** empezar por un modo simulación que valorice sin grabar y compare contra lo grabado (la pestaña «Prestaciones valorizadas» ya hace esa comparación línea a línea).
- 1.030 visitas aparecen en más de una rendición. No se corrigió: puede ser legítimo (refacturación) o un error del escritorio; consultar.

---

## 1. Modelo de datos

**Cabecera: `imRendiciones`** (7.029 filas, sin triggers ni FKs)

| Columna | Uso |
|---|---|
| `IdRendicion` | IDENTITY, número de rendición |
| `IdTipoCliente` | `imClientes.ValorCliente` del cliente (se copia al crear) |
| `idCliente`, `idConvenio` | obra social y `imClientesConvenios.Codigo` (el convenio tiene que ser del cliente o general, `Valor = 0`) |
| `Periodo` | fecha Clarion del día 1 del mes |
| `Honorarios`, `Gastos`, `Medicamentos`, `OtrosServicios`, `Visitas` | totales que graba el motor |
| `FechaCierre`, `HoraCierre`, `OperCierre` | cierre; **`FechaCierre = 0` significa abierta** (no `NULL`) |
| `FechaGraba`, `OperGraba` | alta; el operador sale de la sesión, nunca del body |
| `IdEmpresa`, `IdSucursal` | se copian de la última rendición (en la base local, 1/1) |

**Detalle: `imFacDetalle`** (~1,46 millones de filas), `IDFACTURA = IdRendicion`.

- `TIPOPRESTACION`: `H` honorarios, `G` gastos, `M` medicamentos, `Y` otros servicios.
- `IDMODULO`: `NO` nomenclador, `MO` moduladas, `VA` vademécum.
- Verificado: los totales de cabecera coinciden con la suma de líneas por tipo y `Visitas` con la cantidad de `NUMEROVISITA` distintas. La pantalla igual recalcula y avisa si hay diferencias.

**Referencias hacia la rendición:** `imFacPracticas.Factura` / `imFacProfesionales.Factura` = `IDDETALLE` de la línea; `imFacturas.IdRendicion` (con `imFacResumido`); `FacturacionProfDetalle.IdRendicion`. Vistas: `VPracticasRendidas`, `VMedicamentosRendidos`.

## 2. Cómo valoriza el motor (escritorio)

Para cada práctica de una visita agregada a la rendición:

1. Busca la regla del convenio de la línea (`ValorConvenio = IDCONVENIO`) en `imClientesConvNomenc` o `imClientesConvModuladas`, con la práctica entre `Desde` y `Hasta`, y `Funcion` = 0 para gastos o la función del profesional para honorarios.
2. Elige el valor ambulatorio o de internación según la clase de paciente de la visita.
3. Sin regla, la línea queda en $ 0. Los medicamentos se valorizan con el precio del vademécum.

La web reproduce el paso 1 (`APPLY_REGLA` en `rendiciones.service.js`) solo para mostrar: `coincide`, `difiere` (el convenio cambió después o se corrigió a mano), `sin_regla`, `no_cubre`, `calculada` (valor por galeno/letra) o `vademecum`.

## 3. API

Todas con `requireTenant` y permisos `FACTURACION.RENDICIONES.*`:

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/rendiciones/catalogos`, `/`, `/:id`, `/:id/visitas`, `/:id/lineas`, `/:id/facturas` | VER |
| GET | `/rendiciones/exportar` | EXPORTAR |
| POST | `/rendiciones` | CREAR |
| PUT | `/rendiciones/:id` | EDITAR |
| DELETE | `/rendiciones/:id` | ELIMINAR |

Alta, edición y baja quedan en la auditoría (`modulo FACTURACION`, `entidad RENDICION`).

## 4. Problemas de la versión anterior (corregidos)

- Las rutas no pedían permisos (estaban en la línea base de `audit:rutas`; ya se sacaron).
- El filtro "abiertas" usaba `FechaCierre IS NULL` y nunca encontraba nada.
- Las fechas Clarion se mostraban mal.
- `OperGraba` e `IdEmpresa` se tomaban del body.
- El borrado dejaba líneas huérfanas en `imFacDetalle` y prácticas marcadas como rendidas.
- «Agregar» y «Editar» eran botones sin implementar; el Excel era un CSV.
