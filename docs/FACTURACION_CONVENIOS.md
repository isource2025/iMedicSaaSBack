# Facturación › Convenios — auditoría y plan

Estado: **fases 1 a 5 implementadas y probadas en local; falta la fase 0 (triggers) y la 6 (publicación)**. Fecha de la auditoría: 16/10/2026, sobre la base local `iSource` (SQL Server 2022, **nivel de compatibilidad 100**).

Pruebas contra la base local:

```bash
cd iMedicSaaSBack
node scripts/smoke_convenios.js        # servicio directo: duplica un convenio, edita la copia y la borra al final
node scripts/smoke_convenios_http.js   # API por HTTP, solo lectura (backend corriendo)
node --test src/services/facturacion/conveniosDefinicion.test.js
# front: npx vitest run src/app/components/Convenios
```

---

## ⚠ Pendientes y recordatorios

- **Borrar convenios NO está permitido desde la web (decisión 16/10/2026).** El módulo nuevo no tiene botón ni endpoint de baja de cabecera. Si algún día se habilita, tiene que: bloquear si el convenio figura en `imVisita.CONTRATO`, `imFacDetalle.IDCONVENIO`, `imFacturas.idConvenio`, `imRendiciones.idConvenio`, `FacturacionProfCabecera/Detalle.IdConvenio` o `imFacPracticas.IdConvenio`; y borrar en la misma transacción todas las tablas hijas (sección 1.1).
- **"Tablas maestras › Convenios" (catálogo genérico `convenios` en `catalogoSql.service.js`)**: el borrado ya está bloqueado en el back (`noBorrar`, responde 409 con un mensaje que deriva a este módulo). Todavía permite crear y editar la cabecera por ahí y muestra el botón de borrar; cuando el módulo esté publicado conviene sacar la entrada del catálogo genérico.
- **Triggers corregidos solo en local.** La corrección de la sección 3 (fase 0) se aplica primero en la base local. Cada clínica (Vidal, Sarmiento, etc.) tiene su propia base SQL Server, así que antes de publicar el módulo hay que aplicar el mismo script en cada una.
- Los triggers de `imNomenclador` / `imModuladas` (catálogos base) resincronizan **todos** los convenios ante cualquier cambio (~9 millones de filas). No se tocan en este módulo, pero cualquier edición del Nomenclador Nacional desde "Tablas maestras" lo dispara.
- **Consulta pendiente con el PM.** Hay que confirmar qué significan estos campos: `TipoValor` de la cabecera (0/1), `AplicaPrecioMed` (`' '`, `U`, `F`), `MedicamSobre` (`''`, `G+H`, `GAS`), si las `Cobertura*` son porcentajes, y las funciones 7 y 8 (aparecen en los datos pero no existen en `imFunciones`). Mientras tanto, la pantalla los muestra con un ícono de ayuda que dice "a confirmar" y los guarda tal cual. Las funciones 7 y 8 se aceptan y se muestran como "Función N (sin descripción)" (`FUNCIONES_SIN_CATALOGO` en `convenios.service.js`).
- Hay unas 40 filas de Nomenclador y Moduladas con `Desde` mayor que `Hasta`; casi todas tienen 0/0. Para editarlas, primero hay que corregir el rango, porque la validación lo exige. Aparecen listadas en "Consistencia".
- **Ajenos al módulo, encontrados al probar:**
  - `npm test` no expande los globs en Windows con la versión de Node instalada; hay que pasarle la lista de archivos.
  - `tests/asistente.rutas.test.js` falla porque falta `/dashboard/beds/vigentes` en `src/asistente/rutasFront.js`.
  - El entorno jsdom de vitest falla al cargar (`html-encoding-sniffer` hace `require` de un módulo ESM). Los tests de lógica pura usan `// @vitest-environment node`.
  - `npm run audit:rutas` marca `empresa.routes.js` GET `/logo` y `/pdf-diseno`.

---

## 1. Auditoría

### 1.1 Modelo de datos

**Cabecera: `imClientesConvenios`** (700 convenios, 148 obras sociales)

- `Codigo` es la clave primaria (IDENTITY). Es el "número de convenio".
- `Valor` es la obra social (`imClientes.Valor`). Índice `SK_PorValor (Valor, Codigo)`.
- Hay 14 convenios con `Valor = 0` ("Convenio general…"); no existe `imClientes` con valor 0.

**El campo `ValorConvenio` de las tablas hijas apunta a `imClientesConvenios.Codigo`, no a `Valor`.** Verificado con datos: contra `Codigo` casi no hay huérfanos; contra `Valor` no coincide casi nada. No hay ninguna FK declarada (la base entera tiene 14).

| Tabla | Columna que relaciona | Clave / unicidad | Filas | Contenido |
|---|---|---|---|---|
| `imClientesConvValores` | `ValorConvenio` | PK (ValorConvenio, ValorLetra, Ambulatorio, Internacion) | 8.357 | Valor galeno y gastos por letra (~13 por convenio) |
| `imClientesConvNomenc` | `ValorConvenio` | PK `Id` IDENTITY; índice (ValorConvenio, Desde, Hasta) **sin unicidad** | 1.834.724 | Valor por práctica del Nomenclador (~7.800 por convenio) |
| `imClientesConvModuladas` | `ValorConvenio` | PK `Id` IDENTITY; único (ValorConvenio, Desde, Hasta, Funcion, Ambulatorio, Internacion) | 305.745 | Valor por práctica modulada |
| `imClientesConvVadem` | `ValorConvenio` | PK (ValorConvenio, Descripcion, Troquel) | 2.591 | Valor por medicamento. Pestaña Vademécum (`Troquel <> 0`) y Genéricos (`Troquel = 0`, descripción libre) |
| `imClientesConvComplejidad` | `ValorConvenio` | PK (ValorConvenio, Complejidad, NoCubre, TipoValor, Ambulatorio, Internacion) | 113 | Valor por nivel de complejidad (pestaña "Anestesistas") |
| `imClientesConvCateg` | `ValorConvenio` | PK `Id` IDENTITY; único (ValorConvenio, ValorCategoria) | 0 | Valor por categoría profesional (`imCategorias`), pestaña "Categorías". Una fila por categoría |
| `imPracticasXConvenios` | `IdConvenio` | PK (IdConvenio, IdPractica, AliasTabla) | 8.954.995 | **Derivada**, la mantienen los triggers. No se edita. |

### 1.2 Catálogos de los que depende el detalle (selectores)

| Campo | Catálogo | Observación |
|---|---|---|
| Cabecera `Valor` | `imClientes` (Valor, RazonSocial) | |
| Cabecera `CatProfesional` | `imCategorias` (3 categorías) | Hoy todo en 0 |
| Valores `ValorLetra` | `imClienteConvLetra` (13 letras) | Coincide 100% con los datos. **No** usar `imNomencladorTipoLetra` (no coincide). |
| Nomenc / Moduladas `Funcion` | `imFunciones` | Los datos usan 7 y 8, que no existen en el catálogo |
| Nomenc `Desde`/`Hasta` | `imNomenclador.IDPractica` (4.288) | |
| Moduladas `Desde`/`Hasta` | `imModuladas.IDPractica` (8.270) | `CodModulo` cargado en 15.105 filas |
| Vadem `Troquel` | `imVademecum.Troquel` (43.677) | |
| Complejidad `Complejidad` | `imNomenclador.Complejidad` (1 a 10) | |

### 1.3 Quién usa el convenio (solo lectura para este módulo)

| Tabla.columna | Filas con convenio |
|---|---|
| `imVisita.CONTRATO` (junto con `CLIENTE`) | 66.720 |
| `imFacDetalle.IDCONVENIO` | 1.464.266 |
| `FacturacionProfDetalle.IdConvenio` | 947.393 |
| `imRendiciones.idConvenio` | 7.021 |
| `imFacturas.idConvenio` | 2.735 |
| `FacturacionProfCabecera.IdConvenio` | 2.534 |
| `imFacPracticas.IdConvenio` | 6 |
| `imCirugia.CodigoConvenio`, `PersonalX.IdConvenioFacturacion`, `imPersonal.ConvenioFacturacion` | 0 (sin uso) |

Objetos SQL que leen convenios: vistas `vPracticasPorConvenio`, `vPracticasValorizadas`, `vModuladasNomencladorPorConvenio`, `VPracticasRendidas`, `VMedicamentosRendidos`; función `fnDescriPrestacion`; procedimientos `SyncPracticasXConvenio`, `sp_GenerarPracticasXConvenio`, `SP_Reconstruir_CLNOM_NOM`, `SP_Reconstruir_CLMOD_MOD`.

Relacionadas con la obra social pero **no** con el convenio (fuera de alcance): `imClientesNormas`, `imClientesRequisitos`, `imClientes.ActivarMultiConvenios` (va de la mano con `imClientesConvenios.MultiConvenio`).

### 1.4 Significado de los campos

**Cabecera**

- `VigenciaDesde` / `VigenciaHasta`: fecha Clarion (0 = sin fecha). 87 convenios tienen "desde" y ninguno tiene "hasta". Ojo: `vPracticasPorConvenio` considera vigente solo si `desde = 0` o hoy está entre desde y hasta; **con hasta = 0 nunca queda vigente** en esa vista.
- `CoberturaHonorarios/Gastos/Medicamentos/Descartables` (money, 78 convenios con datos, valores tipo 100), `PrecioMedicamentos`, `AplicaPrecioMed`, `MedicamTotal`, `MedicamSobre`, `DescartTotal`, `DescartSobre` (siempre vacío), `TipoValor`, `CatProfesional`, `MultiConvenio`.

**Hijas** (según `vPracticasValorizadas`)

- `TipoValor`: `$` valor fijo; `%` recargo sobre el valor calculado (unidades de la práctica × valor de la letra); vacío = valor calculado.
- `NoCubre = 1`: valor 0.
- `Ambulatorio` / `Internacion`: a qué tipo de atención aplica (son parte de la clave).
- `Desde` / `Hasta`: rango de códigos de práctica (en la práctica casi siempre Desde = Hasta).
- `CategoriaA/B/C`: valores por categoría del profesional.

### 1.5 Problemas de datos encontrados

| Problema | Cantidad |
|---|---|
| Hijas sin cabecera (huérfanas) | Valores 162 filas (14 convenios), Nomenc 24.545 (10), Moduladas 4.455 (11), Vadem 20 (convenio 0) |
| Nomenc duplicados (mismo convenio, rango, función, amb/int) | 335 grupos |
| Nomenc rangos / rangos invertidos (Desde > Hasta) | 63 / 7 |
| Nomenc con práctica inexistente en `imNomenclador` | 332.410 |
| Moduladas con práctica inexistente en `imModuladas` | 47.729 |
| Vadem con troquel inexistente en `imVademecum` | 993 |
| Convenios sin ninguna fila hija | 9 |

### 1.6 Triggers: costo y bug

- `TRG_Sync_ClientesConvNomenc` y `TRG_Sync_ClientesConvModuladas` (AFTER INSERT/UPDATE/DELETE): por cada convenio afectado ejecutan `SyncPracticasXConvenio`, que borra y reinserta ~12.500 filas de `imPracticasXConvenios`. Se disparan **por sentencia**, así que el backend tiene que guardar en lote (una sentencia por operación) y nunca fila por fila.
- **Bug:** toman `sp_getapplock` con `@LockOwner = 'Session'` y `@LockTimeout = 0` y nunca lo liberan. La primera conexión del pool que dispara el trigger se queda con el lock; en cualquier otra conexión el trigger sale sin hacer nada y `imPracticasXConvenios` queda desactualizada sin aviso.
- `vPracticasPorConvenio` (parte moduladas) compara `cm.CodModulo = m.IDPractica`, mientras que el procedimiento usa `Desde`. Inconsistencia a revisar con facturación; no se toca en este módulo.
- Nivel de compatibilidad 100: no hay `OPENJSON` ni `STRING_AGG`. Los lotes se cargan con tabla temporal (bulk de `mssql`) o `VALUES` en tandas.

---

## 2. Decisiones

| Tema | Decisión |
|---|---|
| Triggers | Corregirlos con script versionado. **Primero solo en local.** |
| Pestañas | Valores, Nomenclador, Moduladas, Vademécum, Genéricos, Anestesistas (tabla de complejidad). Sin Categorías. |
| Genéricos (18/10/2026) | Medicamentos cargados a demanda, sin troquel del vademécum. Se guardan en `imClientesConvVadem` con `Troquel = 0` (el escritorio ya tenía 5 así); no cambia la base. Cada pestaña filtra su parte en listado, conteos, lote, ajuste, duplicar y mantenimiento (`filtro` en `conveniosDefinicion.js`). La descripción es obligatoria porque identifica la fila. |
| Importes (18/10/2026) | Se muestran y se guardan con 2 decimales (`DECIMALES_IMPORTE`). Las filas viejas con 4 decimales se redondean recién cuando se editan. |
| Baja de convenio | No se permite desde la web (ver Pendientes). Sí se permite borrar filas del detalle. |
| Extras | Todos, en este orden: duplicar convenio, ajuste masivo por %, exportar a Excel, limpieza de huérfanos. |

---

## 3. Plan

### Implementado (16/10/2026)

**Backend** (`iMedicSaaSBack`):

- `src/services/facturacion/conveniosDefinicion.js`: definición de la cabecera y de las cinco pestañas (tabla, clave, columnas, tipos), más las validaciones que no necesitan base. Tiene tests en `conveniosDefinicion.test.js`.
- `src/services/facturacion/referenciasConvenio.js`: registro de las tablas de facturación que apuntan a un convenio con otro nombre de columna (`imVisita.CONTRATO`, `imFacDetalle.IDCONVENIO`, etc.). Se puede reusar en el resto del módulo de facturación.
- `src/services/facturacion/convenios.service.js`, `src/controllers/convenios.controller.js` y `src/routes/convenios.routes.js`, montados en `/api/convenios`. El body admite hasta 10 MB, porque un lote de nomenclador puede traer miles de filas.

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/catalogos`, `/catalogos/:tipo/buscar?q=` | VER |
| GET | `/?q=&obraSocial=&estado=&pagina=` (con `resumen` por estado) | VER |
| GET | `/:codigo`, `/:codigo/uso`, `/:codigo/exportar` | VER |
| GET | `/:codigo/pestanas/:pestana?q=&funcion=&pagina=` | VER |
| POST | `/` (alta de cabecera), `/:codigo/duplicar` | CREAR |
| PUT | `/:codigo` | EDITAR |
| POST | `/:codigo/pestanas/:pestana/lote` `{ altas, cambios, bajas }` | EDITAR |
| POST | `/:codigo/ajuste/preview`, `/:codigo/ajuste` | EDITAR |
| GET | `/mantenimiento` | VER |
| POST | `/mantenimiento/limpiar-huerfanas` | ELIMINAR |

Detalles del guardado en lote:

- Las filas se cargan en `#convLote` y se aplica, en este orden, un `DELETE`, un `UPDATE` y un `INSERT`. Todo corre en una transacción.
- Si la cantidad de filas afectadas no coincide con la enviada, responde 409 ("los datos cambiaron").
- Después del guardado controla duplicados sobre la clave única de la pestaña.
- En prácticas, si la descripción queda vacía se completa con la del catálogo.

Cada escritura se registra con `auditoria.registrarSeguro`, con módulo `FACTURACION` y entidad `CONVENIO`.

**Frontend** (`iMedicSaaSFront`):

- **Listado** (`app/dashboard/billing/convenios/page.tsx`): tiene el estilo de Agenda, con indicadores por estado que funcionan como filtro, selector de obra social, buscador y tabla paginada.
- **Detalle** (`ConvenioDetalleModal`): se abre al tocar el número de convenio, en un modal de pantalla completa organizado como el detalle de visita.
  - Arriba, un encabezado con los datos clave.
  - A la izquierda, una navegación por grupos: Convenio, Valores, Prácticas y Medicamentos.
  - En "Datos generales" se edita la cabecera, y "Uso en facturación" muestra quién usa el convenio.
  - Cada pestaña de detalle es una grilla editable (`ConvenioGrilla`): marca los cambios, permite agregar desde el catálogo, pide confirmación antes de descartar y guarda con un solo botón.
- **Extras:** Duplicar, Ajustar valores (con vista previa), Exportar Excel (una hoja por pestaña) y Consistencia (filas huérfanas, duplicados, rangos invertidos y convenios vacíos).
- **Lógica de la grilla:** está en `components/Convenios/grillaConvenio.ts`, que no depende de React y tiene tests en vitest.
- **Asistente:** se agregó un artículo del manual y la ruta (`src/asistente/manual/almacenFacturacion.js`, `rutasFront.js`).

### Fase 0 — Base de datos (solo local)

1. `scripts/sql/fix_triggers_convenios_applock.sql`: recrear los dos triggers con `@LockOwner = 'Transaction'` (el trigger corre dentro de la transacción de la sentencia y el lock se libera al confirmar) y `@LockTimeout` de espera (p. ej. 60000 ms) para que un guardado concurrente espere en vez de saltear la sincronización.
2. `scripts/sql/rollback_triggers_convenios_applock.sql` con las definiciones originales (sacarlas con `OBJECT_DEFINITION` antes de aplicar el fix).
3. Prueba: dos conexiones distintas modifican convenios distintos y se verifica que `imPracticasXConvenios` se actualiza en ambos casos.

### Fase 1 — Backend de lectura

Archivos: `src/services/convenios.service.js`, `src/controllers/convenios.controller.js`, `src/routes/convenios.routes.js` (montado en `/api/convenios`, con `requireAuth`, `requireTenant` y `requirePermiso('FACTURACION.CONVENIOS.VER')`).

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/convenios?cliente=&q=&vigentes=&pagina=` | Lista: código, obra social, descripción, vigencia (como fecha), cantidad de filas por pestaña |
| GET | `/api/convenios/:codigo` | Cabecera + totales por pestaña + uso (cuántas visitas/facturas/rendiciones lo referencian) |
| GET | `/api/convenios/:codigo/valores` | Todas las filas (son pocas) |
| GET | `/api/convenios/:codigo/nomenclador?q=&funcion=&pagina=` | Paginado en servidor, con la descripción del nomenclador |
| GET | `/api/convenios/:codigo/moduladas?…` | Igual que nomenclador |
| GET | `/api/convenios/:codigo/vademecum?…` | Paginado, con nombre y presentación del vademécum |
| GET | `/api/convenios/:codigo/complejidad` | Todas las filas |
| GET | `/api/convenios/catalogos` | Obras sociales, letras, funciones, categorías, complejidades |
| GET | `/api/convenios/buscar/:tipo?q=` | Búsqueda de prácticas (nomenclador, moduladas) y troqueles para dar de alta filas |

Fechas Clarion con `utils/dateUtils.js` (`convertirFechaAClarion`, `clarionAIsoCalendario`). Textos con los helpers existentes de `models/db` (recorte de `char` con espacios).

### Fase 2 — Backend de escritura

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/convenios` | `FACTURACION.CONVENIOS.CREAR` |
| PUT | `/api/convenios/:codigo` | `FACTURACION.CONVENIOS.EDITAR` |
| POST | `/api/convenios/:codigo/:pestaña/lote` con `{ altas, cambios, bajas }` | `FACTURACION.CONVENIOS.EDITAR` |

- Cada lote corre en **una transacción**: se cargan las filas en una tabla temporal y se aplica un `DELETE`, un `UPDATE` y un `INSERT` por pestaña. Así el trigger se dispara una vez por operación, no por fila.
- Validaciones: obra social existente; `Desde <= Hasta`; `TipoValor` en `$`, `%` o vacío; `Funcion` existente en `imFunciones` (aceptando 7 y 8 hasta que se aclare); letra existente en `imClienteConvLetra`; sin duplicados según la clave de cada tabla (sección 1.1). En Nomenclador, aunque la base no lo obliga, no se permite crear duplicados nuevos.
- Cada guardado se registra con `auditoria.service.registrarSeguro` (módulo, convenio, acción, usuario, resumen del cambio).
- No hay endpoint de baja de cabecera.

### Fase 3 — Pantalla `/dashboard/billing/convenios`

Vista maestro–detalle en una sola pantalla:

- **Izquierda:** lista de convenios con filtros por obra social, texto y "solo vigentes"; botón "Nuevo convenio".
- **Derecha, arriba:** formulario de cabecera (obra social, descripción, vigencias con selector de fecha, coberturas, medicamentos y descartables, categoría, multiconvenio) e indicador de uso ("usado en N visitas / N rendiciones").
- **Derecha, abajo:** pestañas Valores, Nomenclador, Moduladas, Vademécum, Genéricos y Anestesistas (al final del menú). Desde y Hasta van en una sola columna "Rango de prácticas", los selectores muestran solo el nombre y el borrado de fila está en la última columna. Cada una es una grilla editable: se pueden agregar, editar y quitar filas; las filas modificadas se marcan; un único botón "Guardar cambios" envía el lote; si hay cambios sin guardar se avisa al cambiar de pestaña o de convenio.
- Nomenclador, Moduladas y Vademécum se paginan y buscan en el servidor (miles de filas por convenio). El alta de fila usa un buscador de prácticas o troqueles.

Archivos: `app/dashboard/billing/convenios/page.tsx` y componentes en `app/components/Convenios/` (lista, cabecera, una grilla por pestaña), `app/services/conveniosService.ts`, `app/types/convenios.ts`. Botones visibles según permisos (`FACTURACION.CONVENIOS.*`, ya definidos en `utils/permisos.ts`).

### Fase 4 — Extras (en este orden)

1. **Duplicar convenio:** `POST /api/convenios/:codigo/duplicar` con `{ cliente, descripcion, vigenciaDesde, ajustePorcentaje? }`. Copia cabecera y las cinco tablas hijas en una transacción con `INSERT … SELECT` (una sentencia por tabla). Es la operación más usada: hoy se arma un convenio nuevo por mes con ~7.800 filas.
2. **Ajuste masivo por porcentaje:** `POST /api/convenios/:codigo/ajuste` con `{ porcentaje, pestañas, funcion?, desde?, hasta? }`. Un `UPDATE` por tabla sobre las filas `$`. Antes de confirmar muestra cuántas filas se modifican y un ejemplo antes/después.
3. **Exportar a Excel:** botón por pestaña y "convenio completo" (una hoja por pestaña), reutilizando `components/ExportExcelButton`.
4. **Limpieza de huérfanos:** pantalla de mantenimiento (permiso `FACTURACION.CONVENIOS.ELIMINAR` o super admin) que lista hijas sin cabecera, duplicados y rangos invertidos, con vista previa y borrado confirmado. No borra nada automáticamente.

### Fase 5 — Pruebas

- Backend (`node --test`): validaciones, armado de lotes (tandas que respetan el límite de 2.100 parámetros) y conversión de fechas Clarion.
- Prueba sobre la base local: alta, edición y baja de filas, duplicado y ajuste, verificando `imPracticasXConvenios` después de cada operación y que no aparezcan huérfanos nuevos.
- Front (`vitest`): estado de la grilla (marcar cambios, descartar, aviso de cambios sin guardar).
- `npm run audit:rutas` y `npm run audit:permisos-front` para verificar los permisos de las rutas nuevas.

### Fase 6 — Publicación en clínicas (más adelante)

1. `npm run db:compare-schema` contra cada clínica para confirmar que las tablas de convenios tienen la misma estructura que la local.
2. Aplicar el script de triggers de la fase 0 en cada base.
3. Sacar o dejar de solo lectura la entrada `convenios` del catálogo genérico.
4. Publicar backend y frontend.
