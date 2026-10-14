# Asistente embebido de iMedic

Documentación de cómo está armado el chatbot integrado, qué está en producción de código, qué falta, y cómo seguir **módulo a módulo**.

Última actualización: 12/10/2026.

---

## 1. Qué es

Un chat dentro del dashboard (botón flotante). Opera con la **sesión JWT** del usuario: mismos permisos, misma empresa, misma autoría. No es Cursor Cloud ni el bot de WhatsApp.

**Objetivo:** que el usuario pida cosas en español rioplatense y el sistema las resuelva con tools **compuestas del servidor** (el servidor pega a la API real), no con el modelo eligiendo paths del manifiesto.

**Lo que falló y se abandonó:** un solo agente genérico (`buscar_codigo` / `llamar_api` / manifiesto). El modelo listaba endpoints o iba a `/pendientes` en vez de `GET …/visita/:id`. Eso se vio con Sanabria (visita 458887): pedía estudios hechos y devolvía la bandeja hospitalaria.

**Modelo actual:** Soporte como **capa base en todos los turnos** + **paquetes por módulo** que el orquestador suma según el mensaje, la pantalla, el foco y el turno anterior. El chat no elige agente.

Antes era «un mensaje = un especialista»: si el router se equivocaba, el usuario quedaba sin las tools que necesitaba. Medido el 12/10/2026, sin pantalla de contexto: «no me deja guardar la evolución», «me da error al cargar un estudio», «qué es una epicrisis» iban a Internación (sin manual), y «dónde está Sanabria» iba a Soporte (sin `buscar_internado`). Con paquetes, el peor error de ruteo es cargar tools de más, nunca de menos.

---

## 2. Estado (qué está listo)

| Agente | `LISTO` | Qué hace hoy |
|---|---|---|
| **SOPORTE** (capa base) | **sí** | Manual, pantallas, navegar, escribir en campo y `diagnosticar` («no me deja / me da error»). Va en todos los turnos. |
| **INTERNACION** | **sí** (`ASISTENTE_INTERNACION_LISTO=0` lo apaga) | 24 tools: ubicar (nombre, DNI, visita o cama), censo y pase de guardia, resumen y lecturas, cargas del menú médico y movimientos (estos con `ASISTENTE_INTERNACION_ESCRITURA=1`). Testeado con mocks y evals. **Falta correr `scripts/asistente_internacion.js` en una copia de la BD y la prueba de un usuario.** |
| ADMISION | no | Solo regla de ruteo |
| TURNOS | no | Solo regla de ruteo |
| ALMACEN | no | Solo regla de ruteo |
| FACTURACION (+ reportes) | no | Solo regla de ruteo |
| PERSONAL | no | Solo regla de ruteo |
| Super Admin | — | **No hay ni va a haber** agente |

Hasta que Internación pase su script de consola en una copia, **no se prueba contra la BD del hospital**.

---

## 3. Arquitectura

```
Usuario  →  POST /api/asistente/mensaje
                │
                ├─ JWT + tenant + permisos
                ├─ orquestador.resolver(texto, pantalla, foco, paquetes del turno anterior)
                │     ├─ paquetes = SOPORTE + módulos LISTO detectados
                │     ├─ ayuda = ¿es «cómo / qué es / no me deja / error»?
                │     └─ avisos = módulos pedidos que todavía no operan
                │
                └─ loop OpenAI (gpt-4o-mini) con las tools de esos paquetes
                       │
                       ├─ GET / mutaciones pendientes
                       │     httpInterno (Bearer de la sesión) → rutas Express reales
                       └─ escrituras → tarjeta Confirmar / Aplicar
                             POST /confirmar  o  POST /aplicar
```

### Piezas

| Pieza | Archivo | Rol |
|---|---|---|
| Orquestador | `src/asistente/agentes/orquestador.js` | Arma los paquetes del turno **sin LLM** y compone las instrucciones (capa de Soporte + sección por módulo). |
| Paquete | `src/asistente/agentes/<modulo>.js` | `ID`, `LISTO`, `HERRAMIENTAS`, `instrucciones()` |
| Catálogo | `src/asistente/catalogo.js` | Une las tools de los paquetes del turno, sin duplicados y respetando las escrituras que bloquea cada uno. |
| Diagnóstico | `src/asistente/diagnostico.js` | `diagnosticar`: acción del usuario → permisos de la matriz que tiene/no tiene + errores recientes de su pantalla explicados. |
| Kernel | `sesion.js`, `pendientes.js`, `ficha.js`, `autoria.js`, `marca.js`, `httpInterno.js` | Sesión, foco, Confirmar, autoría JWT, marca IA |
| Loop | `loop.js` + `controller.js` | Modelo → tools → modelo. Máx. ~10 iteraciones. |
| Clínico (servidor) | `clinica.js` | `buscarInternacion`, `prepararEgreso`, `verEvoluciones`, etc. Lo usa el agente de Internación. |
| Ciclo de internación | `internacionCrud.js` | Camas libres, movimientos, traslado, asignar cama, revertir egreso, editar/eliminar evolución. |
| Altas del menú médico | `cargasClinicas.js` | HC de ingreso, indicación no medicamentosa, estudios, interconsulta, protocolo y epicrisis: catálogo + body + tarjeta. |
| Lectura de la HC | `historiaClinica.js` | 13 secciones de la historia clínica para análisis, con el permiso de cada una y por debajo del límite de tamaño. |
| Front | `iMedicSaaSFront/.../Asistente/` | FAB, stream, tarjetas, `pantalla.ts` (campos + internados visibles) |

**Un mensaje = Soporte + los paquetes del turno.** Un solo loop, un solo prompt compuesto.

**Sticky:** si el mensaje no nombra ningún módulo («y los de ayer?»), siguen los paquetes del turno anterior; un paciente en foco también mantiene Internación.

**Ayuda:** “cómo hago…”, “qué es…”, “no me deja…”, “me da error…” marcan el turno como ayuda: el prompt pide responder eso primero, pero las tools del módulo siguen disponibles si hace falta un dato del paciente.

---

## 4. API HTTP

Prefijo: `/api/asistente`. Auth: Bearer JWT + tenant. Rate limit propio.

| Método | Path | Qué |
|---|---|---|
| POST | `/sesion` | Nueva conversación. Devuelve `idConversacion`. |
| POST | `/mensaje` | Un turno. Body: `mensaje`, `rutaActual`, `idConversacion`, `pantalla`, `debug`. |
| POST | `/mensaje/stream` | Igual, SSE (`estado`, `herramienta`, `done`). |
| POST | `/confirmar` | Ejecuta un pendiente **HTTP** (POST/PUT/DELETE). Un «sí» en el chat **no** alcanza. |
| POST | `/aplicar` | Escribe el texto propuesto en un campo de pantalla + marca IA. |
| POST | `/cancelar` | Tira el pendiente o la inserción. |
| GET | `/capacidades` | Modelo, agente activo, agentes `{id,listo}`, tools visibles. |
| GET | `/consumo` | Reporte (permiso `CONFIGURACION.CONSUMO_IA.VER`). |
| GET | `/consumo/mensajes` | Detalle por mensaje. |

`debug: true` en el body (o `ASISTENTE_TRAZA=1`) agrega `traza` (tool + args + resultado) para logs de consola.

Respuesta típica de `/mensaje`:

```json
{
  "success": true,
  "texto": "…",
  "agente": "SOPORTE",
  "herramientas": ["buscar_en_manual"],
  "navegaciones": [{ "href": "/dashboard/beds" }],
  "pendientes": [],
  "inserciones": [],
  "idConversacion": "uuid",
  "modo": "ia",
  "consumo": { "modelo": "gpt-4o-mini", "costoUsd": 0.0004 }
}
```

---

## 5. Kernel (vale para todos los módulos)

### Sesión (`sesion.js`)
- Memoria por `idEmpresa + valorPersonal`. TTL 4 h.
- Guarda historial compacto para el modelo, `foco` (ficha) y `agente` sticky.
- Máx. 6 turnos de usuario hacia OpenAI.
- Los resultados de tools de turnos **anteriores** se guardan recortados a 700 chars, con una marca que pide volver a llamar la tool si hace falta. Si hay historial, antes del mensaje nuevo va un `system` (`RECORDATORIO_TURNO`, `controller.js`) que pide responder solo lo nuevo. Sin esto el modelo repetía estudios o la ficha del turno previo.

### Ficha (`ficha.js`)
Registro resuelto (internado, paciente, etc.): nombre, DNI, visita, sector, cama, diagnóstico. Se muestra **entera**. No se arma un SQL para un campo suelto.

### Escrituras
- POST/PUT/PATCH/DELETE **nunca** se ejecutan en el loop.
- Quedan en `pendientes` → tarjeta **Confirmar**.
- Texto de pantalla → `escribir_en_campo` → **Aplicar** (marca `[IA iMedic] … validado por …`).
- Autoría = `CodOperador` del JWT. No se manda operador/matrícula en el body. Registro ajeno → `REGISTRO_AJENO`, no se ofrece.

### Permisos
Cada tool declara `permiso` (código de la matriz). Si el usuario no lo tiene, la tool no se elige o devuelve 403. No se adelanta “no tenés permiso” sin haberla llamado.

### HTTP interno
`httpInterno` llama a la app Express en localhost con el Bearer del usuario. Así valen los mismos middlewares.

### Lo que el chat **no** ve
`llamar_api`, `buscar_endpoints`, `buscar_codigo`, `leer_codigo`, `consulta_sql`, `consultar` genérico. Siguen en `AVANZADAS` / `OCULTAS` para tests de `ejecutar`, no para el modelo.

---

## 6. Orquestador — reglas

`resolver()` devuelve `{ id, pedido, ayuda, paquetes, avisos }`:

1. **Paquetes:** siempre `SOPORTE`, más los módulos que nombra el mensaje (regex por módulo, incluidas «dónde está Sanabria», «cómo sigue Gómez», «el de la 105»), el de la ruta, y —si el mensaje no nombra ninguno— los del turno anterior y el del paciente en foco. Solo entran los `LISTO`.
2. **Ayuda:** regex de intención (`AYUDA`). Ojo: `\b` de JS no toma «ó» como letra; para palabras con tilde al final se usa `FIN`.
3. **Avisos:** módulos que el mensaje pide como acción y no están `LISTO` («dame un turno»). Si es ayuda no hay aviso: se explica desde el manual.
4. **`id`/`pedido`:** el módulo principal (Soporte si es ayuda). Va en la respuesta como `agente`; `paquetes` va aparte.

Al agregar un módulo: exportarlo en `orquestador.AGENTES` y prender `LISTO` **solo** cuando el script de consola del módulo y las evals cierran en verde.

---

## 7. Capa SOPORTE (siempre cargada)

Tools (5):

| Tool | CRUD | Efecto |
|---|---|---|
| `buscar_en_manual` | R | Artículos del manual (`manual/*.js`): cómo llegar, pasos, problemas frecuentes y si el usuario tiene acceso |
| `listar_pantallas` | R | Rutas permitidas al usuario |
| `diagnosticar` | R | Por qué no puede hacer algo: permisos reales vs. la acción, errores recientes y botones deshabilitados de su pantalla |
| `navegar` | C | Link `/dashboard/…` (bloquea super-admin) |
| `escribir_en_campo` | U | Inserción pendiente → Aplicar. Cancelar = D |

### `diagnosticar` (`diagnostico.js`)

Determinístico: el modelo solo explica lo que devuelve.

- **Errores primero:** si un error de la pantalla trae `Permiso requerido: X.Y.Z` (lo manda `requirePermiso`), ese es el permiso. Mensajes conocidos (registro ajeno, sesión vencida, visita egresada, duplicado) tienen su explicación; si no, se explica por status (401/403/404/409/400/5xx/sin respuesta).
- **Si no hay error:** la acción («exportar la tabla de internación») se puntúa contra la matriz (`utils/permisos` + `permisosDescripciones`) por tema (submódulo, sinónimos) y verbo (ver, cargar, egresar, trasladar, exportar…). Solo quedan los empatados arriba.
- **Conclusión:** `falta_permiso`, `tiene_los_permisos`, `registro_ajeno`, `permiso_inexistente`, `sesion`, `servidor`, `sin_coincidencia`… con `proximoPaso` (quién lo habilita: el propio usuario si tiene `CONFIGURACION.ROLES.EDITAR`, si no un administrador en la Matriz de permisos).
- **`permiso_inexistente`:** el 403 pide un código que no está en la matriz (hoy `CONFIGURACION.USUARIOS.*` en `/api/users` y `CONFIGURACION.SECTORES.*` en alta/edición de sectores y servicios). Ningún rol lo puede tener: va a soporte técnico, no al admin de la clínica.
- **Manual:** adjunta los «problemas frecuentes» del artículo que corresponde a la acción y la pantalla (filtro de período, autoría…).
- El texto libre del usuario sin status no se interpreta como falla de red.

### Manual (`manual.js` + `manual/*.js`)

Contenido en `src/asistente/manual/`, un archivo por área (`internacion`, `historiaClinica`, `admision`, `turnos`, `almacenFacturacion`, `configuracion`): 64 artículos relevados del código del front, con las etiquetas tal cual aparecen. Esquema:

```js
{ id, titulo, path, seccion?, modulo, comoLlegar, permisos: ['MOD.SUB.ACCION'], tags, texto, pasos?: [], problemas?: [{ sintoma, causa }] }
```

Incluye lo que **no** existe o no anda, para que el asistente no invente atajos: «Cambiar turno» (próx.), «¿Olvidó su contraseña?» sin recuperación, Rendiciones a medio implementar, sin pantalla para cambiar el estado de una cama, opciones del menú sin página (Convenios, Estadísticas, Ocupación, Tabla de Turnos), pantallas fuera del menú.

Motor (`manual.js`):

- **BM25** sobre título y tags (peso 3), síntomas (2), texto, pasos, causas y cómo llegar (1). Normaliza tildes, saca palabras vacías (incluye muletillas de queja: «deja», «anda», «acá») y usa raíces («evoluciones» ≈ «evolucionar»).
- **Sinónimos** del usuario → términos del manual (clave → contraseña, alta → egreso, reprogramar → cambiar turno, doy → asignar…), a medio peso. Frases de tags («dar turno», «ver camas») suman aparte.
- **Pantalla actual:** si el usuario tiene abierta una sección de la ficha (`?seccion=dieta`), ese artículo gana las preguntas genéricas («cómo cargo acá», «no me deja»).
- **`accesible`:** marca (no oculta) los artículos de pantallas a las que el usuario no tiene permiso, con los permisos que piden.
- **`paraModelo`:** primero y segundo con pasos y problemas, el resto resumido, tope ~3.500 caracteres.
- `buscar_en_manual` busca con la pregunta del modelo **y** con el mensaje literal del usuario, intercalados (el modelo a veces reescribe «cómo cargo acá» como «cómo cargar una evolución»).

`tests/asistente.manual.test.js` falla si una pantalla real queda sin artículo, si un artículo apunta a una ruta o sección que no existe en el front, o si nombra un permiso que no está en la matriz; también fija el ranking de 18 preguntas reales.

**Probar (cuando haya BD de copia, no Vidal):**

```bash
cd iMedicSaaSBack
node scripts/asistente_soporte.js
```

Chat: `cómo hago un ingreso` → `qué pantallas tengo` → `llevame al mapa de camas` → escribir en un campo y cancelar.

---

## 8. Módulo INTERNACIÓN (activo)

Prendido por defecto. `ASISTENTE_INTERNACION_LISTO=0` en el env del backend lo apaga sin redeploy (los pedidos vuelven a Soporte).

**Modos (`ASISTENTE_INTERNACION_ESCRITURA`):**

| Valor | Modo | Qué ofrece |
|---|---|---|
| (sin definir) | `altas` (default) | Lecturas + **altas del menú médico** (tools con `alta: true`): evolución, HC de ingreso, indicación no medicamentosa, estudios, interconsulta, protocolo, epicrisis. Egreso, traslado, asignar cama, revertir y editar/borrar: «todavía no habilitado» + `navegar`. |
| `1` / `todo` | `todo` | Todo el CRUD de abajo. |
| `0` / `lectura` | `lectura` | Solo lectura. |

Las tools bloqueadas no se le ofrecen al modelo (`catalogo.escrituraBloqueada` en `seleccionar`), y `ejecutar` las rechaza aunque el modelo las llame (`catalogo.bloqueadaPorAgente` → `{ error, noOfrecer }`). Toda alta queda en tarjeta **Confirmar**; un «sí» en el chat no ejecuta.

### Altas del menú médico (`cargasClinicas.js`)

Todas resuelven al paciente por `termino` (el nombre manda) o por el foco, rechazan visitas egresadas y arman el body de la misma ruta que usa la pantalla. Los catálogos se eligen con `elegir()`: exacto → ese; todas las palabras en una sola opción → esa; varias → `pedir` + `opciones` (el modelo las muestra y se vuelve a llamar con la elegida).

| Tool | Permiso | Ruta al confirmar | Notas |
|---|---|---|---|
| `preparar_evolucion` | `EVOLUCIONES.CREAR` | `POST /api/evoluciones` | Texto marcado IA. |
| `preparar_hc_ingreso` | `HISTORIA_CLINICA.CREAR` | `POST /api/hc-ingreso` | Motivo, enfermedad actual, signos (`SV_*`), examen por aparato, impresión dx, planes. Si ya hay una, la tarjeta avisa que se agrega otra. |
| `preparar_indicacion` | `INDICACIONES.CREAR` | `POST /api/indicaciones` | Solo control (C), medida asistencial (A) y dieta (D) del catálogo `/api/indicaciones/formulario/datos`. **Medicación rechazada** (va por la pantalla). Frecuencia obligatoria salvo dieta. Body con los 31 campos que valida el controller. |
| `solicitar_estudios` | `ESTUDIOS.CREAR` | `POST /api/estudios` (1) o `/api/solicitudes-estudios` (varios) | Servicio deducido del prefijo de la práctica; si no se puede, pregunta. Estudios de servicios distintos → llamadas separadas. |
| `solicitar_interconsulta` | `INTERCONSULTAS.CREAR` | `POST /api/interconsultas` | Servicio de `/api/interconsultas/sectores-destino`. |
| `preparar_protocolo` | `PROTOCOLOS.CREAR` | `POST /api/protocolos` | **Genera la práctica facturable.** El usuario queda como especialista (requiere `valorPersonal`); equipo solo si lo nombró. La práctica se elige en modo **estricto**: busca la frase entera y, si no hay exacta o la única coincidencia agrega más de una palabra, pregunta con «descripción · código» (en vivo, «punción lumbar» había elegido sola «AORTOGRAFIA POR PUNCION LUMBAR»). |
| `preparar_epicrisis` | `EPICRISIS.CREAR` | `POST /api/epicrisis` | Dx opcional por código/descripción del catálogo; marcada IA. |

Procedimientos no tienen alta propia: salen del protocolo.

### Tools (18, CRUD sobre la internación + lecturas compuestas)

Las de lectura usan la visita en foco si no se pasa `numeroVisita` (`clinica.numeroVisitaDe`: args → foco → ruta → pantalla). Las de escritura, con `termino`, resuelven **por nombre** (el nombre manda sobre la visita de pantalla) y dejan al paciente en foco. Todas las escrituras quedan como tarjeta **Confirmar**; la ruta real valida permisos y autoría al confirmar.

| Tool | CRUD | Servidor | Notas |
|---|---|---|---|
| `buscar_internado` | R | `clinica.buscarInternacion` | Ficha completa. Un resultado → foco. Varios → pide cuál. |
| `ver_estudios` | R | `clinica.verEstudios` | `GET /api/solicitudes-estudios/visita/:id`. `filtro=hechos` = `Cumplido`. **Nunca** `/pendientes`. |
| `ver_evoluciones` | R | `clinica.verEvoluciones` | `GET /api/evoluciones/:id/byDate`. Default 7 días (si está vacío, toda la internación con aviso; con días pedidos, dice de cuándo es la última); `todas` → `days=all`; `ultimas: N` (máx. 10) = las N últimas cargadas, sin importar la fecha. Hasta 15 evoluciones (o `ultimas`) van todas como serie: la más reciente entera y de las demás solo lo que no copiaron de la siguiente. `signosEnEvoluciones`: TA, FC, FR, T°, Sat, glucemias, diuresis y balance sacados del texto, con lo fuera de rango. Sin `Glucemia` (es el último HGT de enfermería, no lo que dice la evolución). Trae `IdHCEvolucion` y `_propio`. Muchas → resumen por profesional + las más recientes con texto. |
| `ver_indicaciones` | R | `clinica.verIndicaciones` | Default hoy; si está vacío, las últimas con aviso. |
| `ver_historia_clinica` | R | `historiaClinica.verHistoriaClinica` | Resto de la HC para análisis: hasta 6 secciones por llamada (ver abajo). |
| `ver_movimientos` | R | `internacionCrud.verMovimientos` | `GET /api/patients/visitas/:id/movimientos`: sectores/camas, fechas, disposición, operador. |
| `listar_camas_libres` | R | `internacionCrud.camasLibres` | SQL sobre `imHabitacionCamas`: sin visita y estado ∉ A,I,C,O,H,R (igual que el modal). Filtro por sector (código o nombre, sin tildes). |
| `asignar_cama` | C | `internacionCrud.prepararAsignarCama` | Internado **sin** cama (`GET …/internados-sin-cama`) → `POST …/asignar-cama`, clase `I`, fechas Clarion. |
| `preparar_evolucion` | C | `clinica.prepararEvolucion` | `POST /api/evoluciones`, texto marcado IA al confirmar. Autor = JWT. |
| `trasladar_cama` | U | `internacionCrud.prepararTraslado` | `PUT …/mover-cama` (mismo body que `ModalCambiarCama`). Sin cama destino → devuelve las libres. |
| `editar_evolucion` | U | `internacionCrud.prepararEditarEvolucion` | Lee la evolución, `PUT /api/evoluciones/:id` con fecha/sector originales y texto nuevo. Ajena → error `noOfrecer`. |
| `preparar_egreso` | D | `clinica.prepararEgreso` | Sin motivo → opciones del catálogo. Dx egreso solo código CIE. |
| `revertir_egreso` | D (deshacer) | `internacionCrud.prepararRevertirEgreso` | `GET …/revertir-egreso` (vista previa: conflictos, a qué cama vuelve) → `POST`. Solo admin. |
| `eliminar_evolucion` | D | `internacionCrud.prepararEliminarEvolucion` | `DELETE /api/evoluciones/:id`; la tarjeta muestra el texto que se borra. Solo propias. |
| `navegar` | — | la de Soporte | `/dashboard/visita/:id?seccion=` |
| `resumen_internacion` | R | `guardia.resumenInternacion` | «Cómo está / resumime»: ficha, días, evoluciones (3 días), indicaciones, estudios (pendientes + 5 últimos hechos), HC de ingreso, signos, laboratorios e interconsultas **en una sola tool**, en paralelo y con presupuesto por parte. Cada parte respeta su permiso. Busca al paciente sola. |
| `pase_de_guardia` | R | `guardia.paseDeGuardia` | Por sector (código o nombre): cama, paciente, día, Dx, última evolución (48 h) y estudios pendientes. Texto armado en el servidor (`respuestaDirecta`), 2 GET por paciente (hasta 30, de a 4). Sin sector → lista de sectores. |
| `listar_internados` | R | `guardia.listarInternados` | Censo: sin sector, cuántos por sector; con sector, tabla por cama. Sin HTTP: sale del censo en memoria. |

**Censo (`censo.js`):** una query trae todas las camas ocupadas con visita activa, y queda en memoria 60 s por `idEmpresa` (`ASISTENTE_CENSO_TTL_MS`). Los pedidos simultáneos comparten la misma query. Se invalida al confirmar egreso, traslado, asignación o revertir. `buscarInternacion` busca ahí primero: exacto (todas las palabras contenidas, DNI o visita) → sin más SQL. Si no hay exacto y tampoco una visita egresada que coincida, devuelve los **más parecidos** (Levenshtein ≤1, o ≤2 desde 7 letras) con `aproximado: true` y un aviso («el más parecido es …»). Las **cargas** con nombre aproximado no arman tarjeta: piden confirmar el paciente. Si el censo falla, se usa la búsqueda SQL de siempre.

Fuera de alcance por ahora: intercambiar camas entre dos pacientes, editar el último movimiento, indicar **medicación**, cargar signos/balance/enfermería desde el chat.

**Lectura completa de la HC (`ver_historia_clinica`, `historiaClinica.js`):** con las tools de arriba, el agente ve toda la internación.

| Sección | Endpoint | Permiso |
|---|---|---|
| `hc_ingreso` | `GET /api/hc-ingreso/visita/:nv` | `INTERNACION.HISTORIA_CLINICA.VER` |
| `laboratorios` | `GET /api/laboratorios/visita/:nv` | `INTERNACION.ESTUDIOS.VER` |
| `signos_vitales` | `GET /api/controles-frecuentes/:nv/byDate` | `INTERNACION.SIGNOS_VITALES.VER` |
| `medicacion` | `GET /api/medicacion-control/:nv/byDate` | `INTERNACION.MEDICACION.VER` |
| `interconsultas` | `GET /api/interconsultas/:nv` | `INTERNACION.INTERCONSULTAS.VER` |
| `evolucion_enfermeria` | `GET /api/evolucion-enfermeria/:nv/byDate` | `INTERNACION.EVOLUCION_ENFERMERIA.VER` |
| `balance_hidrico` | `GET /api/balance-hidrico/:nv/all` | `INTERNACION.BALANCE_HIDRICO.VER` |
| `dieta` | `GET /api/dieta-control/:nv/byDate` | `INTERNACION.DIETA.VER` |
| `epicrisis` | `GET /api/epicrisis/:nv` | `INTERNACION.EPICRISIS.VER` |
| `protocolos` | `GET /api/protocolos/visita/:nv` | `INTERNACION.PROTOCOLOS.VER` |
| `procedimientos` | `GET /api/procedimientos/visita/:nv` | `INTERNACION.PROCEDIMIENTOS.VER` |
| `insumos` | `GET /api/indicaciones/:nv/insumos/byDate` | `INTERNACION.INDICACIONES.VER` |
| `adjuntos` | `GET /api/adjuntos/visita/:nv` | `INTERNACION.ADJUNTOS.VER` (solo el listado, no el archivo) |

- **Permisos por sección:** se chequea el permiso de cada sección antes de llamar. Sin permiso, esa sección vuelve como `Sin permiso (X)` y el resto se lee igual. No se usa el export selectivo de admisión, porque solo exige `ADMISION.BUSQUEDA.VER` y salteaba los permisos clínicos.
- **Períodos:** las secciones por fecha (`porFecha`) usan por defecto 3 días para signos y 7 para el resto, o los `fecha`/`dias`/`todas` que se pidan. Si el período por defecto está vacío, se traen los últimos registros de la internación con un `aviso`; si el usuario pidió días o una fecha, se respeta el vacío.
- **Tamaño y resumen (`resumir.js`):** cada lectura apunta a unos 3600 chars (`PRESUPUESTO_LECTURA`, tope 4200), lejos del corte genérico de 9000 de `recortar.limitarJson`, que no se debe alcanzar. El presupuesto se reparte solo entre las secciones con datos (HC de ingreso y epicrisis pesan doble). Si los registros no entran, el servidor arma un resumen determinístico:
  - signos: último valor, mín/máx y n por variable (con unidades en la etiqueta), más las últimas observaciones;
  - medicación, procedimientos, insumos, interconsultas y adjuntos: agrupados por nombre, con veces, cantidad y última fecha, más los 5 más frecuentes;
  - evoluciones: cantidad por profesional;
  - después del resumen, los registros más recientes con texto acortado.

  La respuesta lleva `resumido: true`, `total`, `desde` y `hasta`. Con más de 2 secciones con datos, solo va el resumen.
- **Presupuesto por turno:** `ver_historia_clinica` y `ver_evoluciones` comparten 6000 chars por turno (`ctx.lecturaUsada`). Si el modelo parte un análisis en una llamada por sección, cada llamada siguiente recibe menos lugar (mínimo 900). En vivo, 4 llamadas sumaron unos 8100 chars en total.
- **Disclaimer:** si alguna tool del turno devolvió `resumido` o `truncado`, `/mensaje` incluye `disclaimer`, y el front lo muestra chico al pie de la respuesta («Respuesta basada en un resumen automático…»). El modelo no escribe su propio aviso.
- **Ruido:** se quitan ids, auditoría (operador, hora de carga), Clarion, URLs y binarios. En signos vitales un `0` significa «no medido» y se omite.
- **Análisis (copiloto):** los datos salen solo de las tools; las tools de análisis (`resumen_internacion`, `ver_evoluciones` con más de una, `ver_historia_clinica` con tendencia o varias secciones) traen `comoResponder` (`analisisClinico.js`): `## Síntesis`, `## Tendencias` (una tabla, una fila por parámetro), `## Alertas` (con dato y fecha, según los rangos de la tool) y `## Para considerar` (sugerencias del modelo para el equipo, atadas a un hallazgo, sin dosis ni medicación nueva). No cuenta para los topes (`resumir.largoDatos`). El chat (`MarkdownLite`) arma una sección por título, con color en Síntesis, Alertas y Para considerar, y anida las listas por sangría.
- **Signos de enfermería:** el resumen trae `tendencia` y `tablaTendencias` (filas ya armadas: primer día → último, y lo fuera de rango). Al recortar al tope se van antes `porDia`, `fueraDeRango`, `notas` y `valores` que la tendencia; antes se borraba el resumen entero y al modelo le quedaba un control suelto. Con esa tendencia leída en el turno, `ver_evoluciones` no manda su serie de signos (el modelo la prefería aunque se le pidieran los controles).

**Tarjetas resueltas:** al confirmar o cancelar, `sesion.anotarAccion` guarda el estado y el turno siguiente lo recibe como mensaje `system` aparte (`sesion.notaAcciones`). No va como mensaje del asistente: el modelo copiaba el formato «[Cancelado…]» en la tarjeta nueva. El front manda `idConversacion` también al cancelar.

**Links:** el `link` de una tool se convierte en botón de navegación y se quita del resultado que ve el modelo (lo reescribía como `https://dashboard/...`). Igual a veces inventa uno tras `navegar` (`https://imedic.com/dashboard/...`): `controller.sinLinksInternos` quita del texto final los links a rutas de la app, `localhost` o hosts sin dominio; los externos reales quedan.

**Incidente 12/10/2026 (copia WEBDEV, nada confirmado):** «egresemos a umbert» armó la tarjeta de MIRANDA (visita 404444, la de la pantalla): el modelo pasó `termino` + `numeroVisita` de la ruta y ganaba el número. Ahora:

- Con `termino`, el egreso se resuelve **por nombre**; `numeroVisita` solo elige entre los que coinciden. Si no corresponde → error, sin tarjeta.
- `preparar_egreso` deja al paciente resuelto en foco (el «alta medica» siguiente va al mismo).
- La tarjeta muestra el diagnóstico de egreso (se mantiene el de la internación salvo código CIE dictado). Texto libre se rechaza: la columna es un código `varchar(8)`.
- El prompt prohíbe pedir «sí» por chat; con el motivo, se vuelve a llamar la tool.
- Tests de regresión en `tests/asistente.internacion.test.js`.

`/api/solicitudes-estudios` excluye interconsultas, así que no entran en `ver_estudios`: se leen con `ver_historia_clinica` (sección `interconsultas`).

### Caso que tiene que pasar (Sanabria)

Pedido: “dónde está Sanabria Elizabeth” → ficha (visita **458887**, DNI 35001268, QUR2).  
Follow-up: “resumen de los estudios **ya hechos**” → `ver_estudios({ filtro: 'hechos' })` con esa visita. No listar endpoints. No usar la bandeja de Rayos/Eco.

### Verificación

1. Tests unitarios: `tests/asistente.internacion.test.js` (sin BD; corren con escritura habilitada).
2. `node scripts/asistente_internacion.js` en **copia**, nunca en `181.4.71.230` (el script se niega).
   - Por defecto (modo `altas`, backend sin `ASISTENTE_INTERNACION_ESCRITURA`): las lecturas (signos, medicación, todas las evoluciones, un análisis), las 9 altas (evolución a un paciente inexistente → sin tarjeta; «perdón, era Meza» → la misma tool con el paciente nuevo; indicación; medicación rechazada; estudio; interconsulta; HC; protocolo; epicrisis) y 4 pedidos bloqueados (traslado, egreso, revertir) que deben responder «todavía no habilitado». Cada tarjeta se verifica contra el apellido del internado y se **cancela**. Revisa disclaimer, que nada pase por el corte genérico, que el análisis no supere 9000 chars y que no haya URLs en el texto.
   - `TEST_ESCRITURA=0` con backend en `0`: solo lectura. `TEST_ESCRITURA=1` con backend en `1`: todo el CRUD; toda tarjeta se cancela.
3. 12/10/2026 en copia WEBDEV (`190.230.52.200`): con escritura, 12/12 turnos en verde, incluidos traslado real a CM1-01 y vista previa de revertir egreso (visita 409748). Editar/eliminar evolución quedaron cubiertos solo por tests: el usuario de prueba no tenía evoluciones propias recientes. En solo lectura, todo en verde también. En modo `altas` (mismo día): 24 turnos en verde, 6 tarjetas armadas sobre MEZA y canceladas; el protocolo de «punción lumbar» devolvió las 6 opciones con código en vez de elegir.

```bash
# backend apuntando a la copia
npm start
# otra terminal (TEST_INTERNADO = un internado que exista en la copia)
TEST_INTERNADO="Meza Gustavo Adolfo" TEST_LOGIN_USER=admin TEST_LOGIN_PASSWORD=*** \
TEST_CAMA_DESTINO="01 de clínica médica 1" TEST_EGRESADO="la visita 409748" \
node scripts/asistente_internacion.js
```

---

## 9. Cómo agregar un módulo (checklist)

1. Crear `src/asistente/agentes/<modulo>.js` con `ID`, `LISTO: false`, `HERRAMIENTAS` (8–14), `instrucciones()`.
2. Registrarlo en `orquestador.AGENTES`.
3. Implementar `run` / `preparar` (usar `clinica.js` o GET/POST reales vía `httpInterno`). El servidor filtra (hechos vs pendientes).
4. Prompt corto: solo ese módulo. No listar endpoints.
5. Script `scripts/asistente_<modulo>.js`: C/R/U/D + `debug: true` + cancelar escrituras.
6. Tests en `tests/asistente.<modulo>.test.js`.
7. Correr el script en **BD de copia**.
8. Recién ahí `LISTO = true`.
9. Entregar al usuario el comando + frases de chat. Recién después arrancar el siguiente módulo.

No: una tool por pantalla, una tool por handler, ni devolver el manifiesto al modelo.

---

## 10. Front

- `AsistenteFab.tsx`: chat, stream, navegación, tarjetas Confirmar/Aplicar.
- `pantalla.ts`: manda campos `c1…`, internados visibles, visita/cama (`data-asistente-*`), y para diagnosticar: `errores` (últimos 5 errores de la API de los últimos 15 min), `alertas` (`role="alert"`) y `deshabilitados` (botones en gris, con su `title`).
- `erroresRecientes.ts`: buffer en memoria que alimentan el interceptor de `services/axios.ts` y `apiFetch` (`utils/authFetch.ts`). Path sin host ni query y con los números como `:id` (no viaja un DNI ni una visita); excluye `/asistente`. `contexto.pantallaDeBody` lo vuelve a sanear en el backend.
- `LoaderIa.tsx`: frases por nombre de tool.
- Consumo: `/dashboard/configuracion/consumo-ia`.

Al agregar tools, sumar etiqueta en `NOMBRES_HERRAMIENTA` / `FRASES_HERRAMIENTA`.

---

## 11. Modelo, costo, env

| Variable | Uso |
|---|---|
| `ASISTENTE_OPENAI_API_KEY` / `OPENAI_API_KEY` | Cliente del asistente y del bot |
| `OPENAI_API_KEY_EPICRISIS` | Solo epicrisis IA (proyecto OpenAI aparte). Sin esta key, la epicrisis cae a plantilla |
| `OPENAI_MODEL_EPICRISIS` | Modelo de la epicrisis. Si falta, usa `OPENAI_MODEL` |
| `ASISTENTE_OPENAI_MODEL` / `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `ASISTENTE_MAX_ITER` | Default 10 |
| `ASISTENTE_MAX_TOOLS` | Default 32 (Soporte 5 + Internación hasta 23) |
| `ASISTENTE_CENSO_TTL_MS` | Vida del censo de internados en memoria. Default 60000 |
| `ASISTENTE_TRAZA` | `1` = traza siempre |
| `ASISTENTE_INTERNACION_ESCRITURA` | sin definir = lectura + altas del menú médico; `1` = todo el CRUD; `0` = solo lectura |

Orquestador: 0 tokens. Turno sticky de lectura: 1 chat + 1–2 HTTP internos.

### Ahorro de tokens y llamadas

Cada mensaje cuesta lo que pesan las definiciones de tools + el system prompt, multiplicado por las llamadas al modelo. Para que los créditos rindan:

- **Intención por reglas (`intencion.js`, 0 tokens):**
  - En un turno de **consulta** no viajan las tools de carga ni sus reglas (unos 2.300 tokens menos por llamada). Va `habilitar_cargas` en su lugar: si el modelo la llama, el loop le suma las tools en la iteración siguiente (`tools` como función en `loop.js`) y le devuelve las reglas de carga.
  - En un turno de **carga** van solo las tools del tipo que nombra el pedido; lo dictado después de «:» no cuenta. Por ejemplo, «evolucioná a X: pedí rx» manda solo las de evolución.
  - Si el turno anterior usó una tool de carga (`conv.cargaEnCurso`: se contesta un motivo o un paciente), van todas.
- **Respuesta directa (`loop.js` + `directas.js`):** si todas las tools de una iteración devuelven `respuestaDirecta`, ese texto es la respuesta y no hay segunda llamada al modelo. El modelo ve el resultado sin ese texto, y el texto queda como respuesta suya en el historial. Se usa en estos casos:
  - la tarjeta de una carga simple, salvo que el mensaje mencione medicación, porque ahí el modelo tiene que explicar que no se indica desde el chat;
  - la ficha cuando el pedido es solo «dónde está X» y hay un único resultado;
  - `navegar` cuando el pedido es solo «llevame a…»;
  - siempre en `pase_de_guardia` y `listar_internados`.
- **Atajos locales (`controller.respuestaSocial`):** «hola», «gracias» y «chau» se responden sin modelo, igual que el «sí» con una tarjeta pendiente.
- **Prompt cacheable (`prompt.js`):** OpenAI cobra a mitad de precio un prefijo idéntico de 1.024 tokens o más. Por eso el orden es: instrucciones fijas → reglas → rol y permisos → identidad → notas del mensaje (`orquestador.notasDelTurno`: ayuda o módulo no habilitado) → fecha y pantalla. Se sacó la línea «Tools de este turno», que repetía nombres que ya van en las definiciones.
- **Permisos compactos (`contexto.resumenPermisos`):** una línea por módulo y «todas» cuando el usuario tiene la matriz completa del submódulo.
- **Historial:** las respuestas de turnos anteriores viajan recortadas a 2.000 caracteres (un pase de guardia largo no se reenvía entero en cada mensaje); los resultados de tools, a 700.

Medido con las evals (`--veces=3`, mismos 15 casos):

| | Antes (12/10) | Después (13/10) |
|---|---|---|
| USD por mensaje | 0,00085 | 0,00066 |
| Tokens de entrada por mensaje | 9.781 | 6.343 (78 % desde caché) |
| Llamadas al modelo por mensaje | 1,94 | 1,83 |

Con los 21 casos (fase 3 incluida): USD 0,00062 por mensaje y 90 % de caché. Pase de guardia, censo, «dónde está X» y una carga dictada salen con 1 llamada; un saludo, con 0.

### Medido vs. dashboard de OpenAI

`costos.costoDe` se contrastó contra el `usage` crudo de OpenAI: da exacto, con caché incluida. Hay tres razones por las que el dashboard puede mostrar más que el reporte de Consumo IA:

- El dashboard agrupa por día UTC: a la noche (hora de Argentina) ya está sumando el día siguiente.
- Las evals (`scripts/asistente_evals.js`) pegan a la API real. Cada corrida imprime «Total de la corrida» (requests, tokens y USD) para restarla.
- Hay otros consumidores con la misma `OPENAI_API_KEY`. Desde el 13/10 todos quedan en imAuditoria como `CONSUMO_IA`:

| Acción | Quién |
|---|---|
| `EPICRISIS_IA` | Epicrisis con IA (`OPENAI_API_KEY_EPICRISIS`, proyecto aparte) |
| `RESUMEN_VISITA_IA` | Resumen de visita (`/admission-search/.../resumen-ia`) |
| `BOT_WHATSAPP` | Bot de WhatsApp (`botOpenai.chat` y `chatConHerramientas`), con `actor` nulo y la empresa de `BOT_EMPRESA_ID` si no hay tenant |

Para separar el asistente en la facturación, conviene darle su propia `ASISTENTE_OPENAI_API_KEY` en un proyecto de OpenAI aparte. Hasta entonces, el dashboard deja agrupar por API key o por modelo («Group by»).

Catálogo de casos de uso con frases de ejemplo y llamadas por caso: `docs/ASISTENTE_CASOS_DE_USO.md`.

---

## 12. Seguridad y BD

- El `.env` local de esta PC apunta a **`181.4.71.230` / `iSource` (Vidal)**. No es copia.
- **No correr scripts vivos ni confirmar escrituras contra ese host.**
- Auditoría de oct/2026: se revirtió evolución IA `292501` y un egreso a medias (`480273`). No quedó egreso cerrado por ADMIN en 30 días.
- Para avanzar Internación: otra `DB_NAME` o restore de `.bak` + `ALLOW_REMOTE_SQL=0` si el host no es local.

Reglas que no se negocian:

- Un «sí» en el chat no ejecuta.
- No credenciales ni edición de roles desde el chat.
- SQL del modelo: no. Si hace falta un conteo, va **dentro** de una tool del servidor.
- No inventar diagnóstico ni tratamiento.

---

## 13. Archivos

```
iMedicSaaSBack/src/asistente/
  agentes/          orquestador, soporte, internacion, def
  catalogo.js       selección por agente
  controller.js     HTTP + prompt + traza
  ejecutar.js       despacho de tools
  clinica.js        queries/API clínicas (servidor)
  internacionCrud.js  camas, traslados, revertir egreso, editar/borrar evolución
  cargasClinicas.js   altas del menú médico (HC ingreso, indicación, estudios, interconsulta, protocolo, epicrisis)
  historiaClinica.js  lectura de las demás secciones de la HC (ver_historia_clinica)
  guardia.js        resumen_internacion, pase_de_guardia, listar_internados
  censo.js          internados en memoria por empresa + búsqueda tolerante a errores de tipeo
  intencion.js      consulta / carga / ubicar / navegar (qué tools viajan)
  directas.js       cuándo una tool responde sin segunda llamada al modelo
  resumir.js        presupuesto de chars y resúmenes determinísticos de lecturas largas
  ficha.js sesion.js pendientes.js
  prompt.js httpInterno.js autoria.js marca.js
  manifiesto.js     índice (oculto al chat)
  manual.js         buscador del manual (BM25, raíces, sinónimos, pantalla actual)
  manual/*.js       artículos por área
  routes.js loop.js openai.js consumo.js

iMedicSaaSBack/scripts/asistente_soporte.js
iMedicSaaSBack/scripts/asistente_internacion.js
iMedicSaaSBack/tests/asistente.*.test.js

iMedicSaaSFront/src/app/components/Asistente/
```

---

## 14. Cómo avanzar (orden acordado)

1. **Copia de BD** (bloqueante). Sin eso no se prende Internación.
2. **Internación** — ficha + estudios hechos + egreso con Confirmar. Script consola. `LISTO=true`. Usuario prueba.
3. **Admisión** — paciente, nueva admisión, RENAPER solo para alta **nueva**.
4. **Turnos**
5. **Almacén**
6. **Facturación / reportes**
7. **Personal** — sin roles ni passwords.

Cada módulo: implementar → test consola CRUD + log → entregar frases al usuario → recién el siguiente.

---

## 15. Evals: conversaciones de referencia

`scripts/asistente_evals.js` corre conversaciones contra el **modelo real** pasando por `controller.mensaje`, con la base (`models/db`) y la API (`httpInterno`) simuladas en memoria. No abre conexiones SQL (borra `DB_*` del entorno) y rechaza cualquier escritura. Cada caso verifica tools llamadas / no llamadas, argumentos, texto, tarjetas y navegación.

```bash
node scripts/asistente_evals.js              # todos, una vez (~USD 0,01)
node scripts/asistente_evals.js --veces=3    # estabilidad
node scripts/asistente_evals.js --caso=sanabria
```

Casos: «no me deja guardar» con 403 en pantalla, «cómo cargo una evolución», «qué es una epicrisis», «llevame al mapa de camas», exportar sin permiso, Sanabria desde el inicio + estudios hechos, «cómo sigue Sanabria», el incidente Umbert/Miranda, evolución a Meza (tarjeta, sin «cargué») y un turno (módulo no activo). Manual: reprogramar un turno (no existe: cancelar y dar otro), contraseña olvidada (la blanquea un administrador), «se me borró la evolución» (existe; la oculta el filtro de período), «cómo cargo acá» en Dietas y un 403 con permiso inexistente (soporte técnico).

El arnés imita al front: `pantalla.seccion` sale del `?seccion=` de la ruta.

Correrlas antes de tocar prompts, reglas del orquestador o descripciones de tools. Al agregar un incidente, sumarlo como caso.

12/10/2026 (gpt-4o-mini): 10/10; con `--veces=3`, 29/30. La que falló: la ficha de Sanabria sin el número de visita (el modelo resume la ficha a su manera; se resuelve haciendo que el servidor la arme).

12/10/2026, con el manual nuevo (15 casos): `--veces=3`, 45/45 (~USD 0,04). La ficha de Sanabria sigue pudiendo fallar alguna vez hasta la fase 4.

13/10/2026, fase 3 + ahorro (21 casos): `--veces=3`, 63/63 (~USD 0,04). Casos nuevos (`f3-*`):
- carga sin verbo de carga («ponele en la evolución…»), que pasa por `habilitar_cargas`;
- apellido mal escrito («Sanabira»);
- pase de guardia de UTI;
- censo de Clínica Médica 1;
- resumen clínico en una tool;
- saludo y gracias sin modelo.

`maxLlamadas` controla cuántas veces se llamó al modelo, y `algunaDe` acepta más de una tool válida. Para comparar costo con la línea base sin los casos nuevos: `--excluir=f3`. La salida imprime «Por mensaje» (USD, llamadas, tokens, % de caché) y «Entrada» (en qué se van los tokens).

## 16. Pruebas ya hechas (Soporte)

`node scripts/asistente_soporte.js` (12/10/2026), backend `127.0.0.1:5006`:

- CRUD local de tools: OK.
- Chat vivo: `buscar_en_manual`, `listar_pantallas`, `navegar` → `/dashboard/beds`, `escribir_en_campo` + cancelar: OK.
- Suite backend: tests en verde (orquestador + catálogo Soporte).

Ese run pegó al SQL del hospital **solo en el login**. Las tools de Soporte no escriben tablas clínicas. Internación no se vuelve a probar ahí.
