# Asistente iMedic: casos de uso (13/10/2026)

Esto es lo que el asistente puede hacer hoy, con frases reales para probarlo. Hay dos capas:

- **Soporte**: siempre disponible, en cualquier pantalla.
- **Internación**: se activa cuando el mensaje habla de pacientes internados o cuando el usuario está en una pantalla de internación.

La columna «Modelo» es cuántas veces se llama a OpenAI. Como referencia, medido con gpt-4o-mini: una llamada cuesta entre USD 0,0003 y 0,0009, y dos llamadas entre USD 0,0007 y 0,0013. Las respuestas «directas» las arma el servidor, sin una segunda llamada.

Modo de escritura por defecto (`altas`): se consulta todo y se preparan cargas del menú médico. Egreso, traslado, asignación de cama, revertir egreso y editar o borrar requieren `ASISTENTE_INTERNACION_ESCRITURA=1`. **Toda escritura queda en una tarjeta «Confirmar»**; un «sí» en el chat no ejecuta nada.

---

## 1. Soporte: cómo se usa el sistema (manual)

| Frase de ejemplo | Qué hace | Modelo |
|---|---|---|
| «¿cómo cargo una evolución?» | Busca en el manual y responde con el camino («Internación → paciente → Evoluciones») y los pasos, con los botones entre «». | 2 |
| «cómo cargo acá?» (con Dietas abierta) | Usa la sección abierta: responde con los pasos de Dietas. | 2 |
| «¿dónde veo las camas libres?» | Mapa de camas y estados. | 2 |
| «¿cómo doy un turno?» / «cómo saco un sobreturno» | Pasos de Agenda. | 2 |
| «cómo reprogramo un turno?» | Explica que «Cambiar turno» todavía no existe y da el camino real: cancelar y dar otro. | 2 |
| «olvidé mi contraseña» | No hay recuperación automática: la blanquea un administrador. | 2 |
| «¿qué es una epicrisis?» / «para qué sirve el balance hídrico» | Lo explica y no arma nada. | 2 |
| «cómo doy de alta un médico nuevo» | Configuración → Personal (no lo confunde con el egreso de un paciente). | 2 |
| «cómo exporto la tabla de internación» | Pasos de la tabla, y avisa si no tiene permiso para esa pantalla. | 2 |
| «dónde veo cuánto se gasta en IA» | Configuración → Consumo IA. | 2 |
| «cómo revierto un egreso» | Pasos y quién puede hacerlo (admin). | 2 |
| «cómo intercambio dos pacientes de cama» | Pasos de la pantalla. | 2 |

## 2. Soporte: algo no anda (diagnóstico)

| Frase | Qué hace | Modelo |
|---|---|---|
| «no me deja guardar la evolución» (con un 403 en pantalla) | Cruza el error con los permisos reales: le falta `INTERNACION.EVOLUCIONES.CREAR`, se lo habilita un administrador en la matriz de permisos. | 2 |
| «por qué no puedo exportar?» | Dice qué permiso falta y quién lo habilita. | 2 |
| «el botón Egresar está en gris» | Usa los botones deshabilitados de la pantalla y su motivo. | 2 |
| «no me deja crear un sector» | Detecta que ese permiso no existe en la matriz: es un tema de soporte técnico de iMedic, no del admin. | 2 |
| «se me borró la evolución que cargué ayer» | Ve que existe y explica que la oculta el filtro de período: cambiar el día o elegir «Semana» / «Todas». | 2 |
| «no aparece el paciente en el mapa» | Manual + filtros de sector y estado. | 2 |
| «me da error al guardar la indicación» | Lee el último error de la API de su sesión y lo traduce. | 2 |

## 3. Soporte: navegar y escribir en pantalla

| Frase | Qué hace | Modelo |
|---|---|---|
| «llevame al mapa de camas» / «abrime turnos» | Botón para ir (respuesta directa). | 1–2 |
| «abrime la HC de Sanabria en evoluciones» | Busca al paciente y deja el botón a esa sección. | 2 |
| «escribí en el campo evolución: paciente estable, afebril» | Lo pone en el campo visible; el usuario toca «Aplicar» y después guarda el formulario. | 2 |
| «hola», «gracias», «chau» | Respuesta local. | **0** |

---

## 4. Internación: ubicar pacientes

| Frase | Qué hace | Modelo |
|---|---|---|
| «dónde está Sanabria» | Ficha: visita, DNI, HC, sector, cama, ingreso, diagnóstico (respuesta directa). | **1** |
| «dónde está Sanabira» (mal escrito) | «No hay exacto; el más parecido es SANABRIA ELIZABETH» + ficha. | **1** |
| «en qué cama está el DNI 35001268» / «la visita 458887» | Por DNI o número de visita. | 1 |
| «dónde está Gómez» (hay varios) | Lista y pregunta cuál. | 2 |
| «el de la 105» / «quién está en la cama 03 de UTI?» | Lo ubica por cama; si la cama se repite en varios sectores, pregunta cuál. | 1–2 |
| «está internado Pérez?» (egresado) | «Ya está egresado, no hay internación activa.» | 2 |

## 5. Internación: censo y pase de guardia

| Frase | Qué hace | Modelo |
|---|---|---|
| «cuántos internados hay?» | Cantidad por sector (sale del censo en memoria, sin consultas por paciente). | **1** |
| «qué pacientes hay en clínica médica 1?» | Tabla por cama: paciente, visita, día, diagnóstico. | **1** |
| «armame el pase de guardia de UTI» | Por cama: paciente, día de internación, diagnóstico, última evolución (48 h) y estudios pendientes. | **1** |
| «pase de guardia» (sin sector) | Pregunta el sector y muestra los que tienen internados. | 1 |
| «pase de guardia de pediatría» (no hay) | Lo dice y lista los sectores con internados. | 1 |

## 6. Internación: estado clínico y lecturas

| Frase | Qué hace | Modelo |
|---|---|---|
| «cómo sigue Sanabria?» / «resumime a Meza» | Resumen en una sola tool: ficha, días, evoluciones, indicaciones, estudios, HC de ingreso, signos, laboratorios e interconsultas. | 2 |
| «qué evoluciones tiene Sanabria?» / «las de toda la internación» | Evoluciones (7 días por defecto, o todas). | 2 |
| «qué indicaciones tiene hoy?» / «las de ayer» | Indicaciones del día; si no hay, las últimas, con aviso. | 2 |
| «resumen de los estudios ya hechos» | Solo los cumplidos, con resultado. | 2 |
| «qué estudios tiene pendientes?» | Los pedidos sin resultado. | 2 |
| «cómo vienen los signos vitales?» | Último valor, mín/máx y alertas; si un valor es imposible, avisa que parece un error de carga. | 2 |
| «qué medicación se le suministró?» / «laboratorios» / «interconsultas» / «balance hídrico» / «dieta» / «adjuntos» | Esa sección de la HC (varias juntas en una llamada). | 2 |
| «leeme la HC de ingreso» / «la epicrisis» | Esa sección. | 2 |
| «por qué camas pasó?» / «cuándo entró a UTI?» | Movimientos: sectores, camas, fechas y operador. | 2 |
| «qué camas libres hay en UTI?» | Camas libres de ese sector. | 2 |
| Seguimiento: «y los laboratorios?» (con el paciente en foco) | Usa el mismo paciente sin volver a nombrarlo. | 2 |

## 7. Internación: cargas del menú médico (modo por defecto)

Todas quedan como tarjeta «Confirmar» para el paciente **nombrado**, aunque haya otro en pantalla.

| Frase | Qué arma | Modelo |
|---|---|---|
| «evolucioná a Meza: estable, afebril, tolera la dieta» | Evolución (marcada IA). Responde «Te dejé lista la tarjeta…». | **1** |
| «ponele en la evolución de hoy: sin dolor» | Igual, aunque no use un verbo de carga. | 2–3 |
| «cargale la HC de ingreso a Meza: motivo dolor abdominal, TA 120/80…» | HC de ingreso con signos, examen, impresión diagnóstica y plan. Solo lo dictado. | 1–2 |
| «indicale control de signos cada 6 h» / «dieta hiposódica» | Indicación no medicamentosa. Si hay varias opciones de frecuencia, pregunta. | 1–2 |
| «indicale paracetamol 1 g» | **No** la arma: la medicación se indica en la pantalla; ofrece abrirla. | 2 |
| «pedile Rx de tórax y hemograma» | Pedido de estudios (separa por servicio). | 1–2 |
| «pedí interconsulta con cardiología» | Interconsulta. | 1–2 |
| «cargá el protocolo de punción lumbar» | Protocolo: muestra las prácticas con su código y **espera que elija** (se factura). | 2 |
| «hacele la epicrisis a Sanabria» | Borrador de epicrisis. | 2 |
| «perdón, era Franco Matías» (después de una carga) | Vuelve a armar lo mismo para el otro paciente. | 1–2 |
| «sí» (con una tarjeta pendiente) | «Tocá Confirmar en la tarjeta: un sí acá no la ejecuta.» | **0** |
| «evolucioná a Sanabira: …» (mal escrito) | **No** arma la tarjeta: pide confirmar el paciente. | 2 |

## 8. Internación: movimientos y correcciones (solo con `ESCRITURA=1`)

| Frase | Qué arma | Modelo |
|---|---|---|
| «egresá a Umbert» | Pregunta el motivo (catálogo); con «alta médica», arma la tarjeta. | 2 + 1 |
| «trasladalo a la 01 de clínica médica 1» | Traslado; sin cama destino muestra las libres. | 2 |
| «ubicá a Pérez en una cama de UTI» | Asignación de cama a un internado sin ubicación. | 2 |
| «el egreso de la visita 409748 fue por error» | Revertir egreso (solo admin), con vista previa y conflictos. | 2 |
| «corregí mi última evolución: …» / «borrá la evolución de las 10» | Editar o borrar, **solo las propias**. | 3 |

En modo por defecto, estos pedidos responden «Eso todavía no está habilitado en el asistente» y ofrecen la pantalla.

---

## 9. Lo que dice que no (a propósito)

- Dar o cancelar turnos, admisiones, almacén y facturación desde el chat: explica cómo se hace en la pantalla y ofrece abrirla.
- Indicar medicación.
- Crear usuarios, cambiar contraseñas o editar roles.
- Inventar diagnósticos, resultados o conductas: solo usa lo que está registrado.
- Afirmar «no tenés permiso» sin haberlo verificado.

## 10. Para probar en orden (guion corto)

1. «hola» → respuesta sin modelo.
2. «dónde está Sanabria» → ficha.
3. «cómo sigue?» → resumen.
4. «qué estudios tiene pendientes?»
5. «evolucioná: estable, afebril» → tarjeta → Cancelar.
6. «armame el pase de guardia de su sector»
7. «cómo cargo una indicación?» → manual.
8. «no me deja guardar» (con un usuario sin permiso de crear) → diagnóstico.
9. «llevame al mapa de camas»
10. «indicale paracetamol» → no lo arma y explica por qué.
