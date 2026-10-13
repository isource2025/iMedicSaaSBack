const permisosService = require('../services/permisos.service');
const contexto = require('./contexto');
const catalogo = require('./catalogo');
const ejecutarMod = require('./ejecutar');
const { agenteLoop } = require('./loop');
const openai = require('./openai');
const sesion = require('./sesion');
const pendientes = require('./pendientes');
const httpInterno = require('./httpInterno');
const recortar = require('./recortar');
const auditoria = require('./auditoria');
const { construirSystemPrompt } = require('./prompt');
const { responderSinModelo } = require('./fallback');
const sqlLectura = require('./sql');
const marca = require('./marca');
const autoria = require('./autoria');
const clinica = require('./clinica');
const consumo = require('./consumo');
const reporte = require('./reporteConsumo');
const orquestador = require('./agentes/orquestador');

const MAX_ITER = Number(process.env.ASISTENTE_MAX_ITER || 10);

function ipDe(req) {
	return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function armarCtx(req, permisos, pantalla, entidades, conv) {
	const cred = contexto.credencialesDeReq(req);
	return {
		req,
		permisos,
		pantalla: pantalla || null,
		entidades: entidades || {},
		foco: conv?.foco || null,
		conv: conv || null,
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: req.idEmpresa,
		valorPersonal: req.valorPersonal,
		token: cred.token,
		navegaciones: [],
		pendientes: [],
		consultas: [],
		inserciones: [],
		traza: [],
		medidor: consumo.crearMedidor(),
	};
}

async function registrarMensaje(req, { prep, ctx, result, error, stream }) {
	const r = ctx?.medidor?.resumen();
	const resumen = r && (r.llamadas || r.llamadasExternas) ? r : null;
	const linea = consumo.lineaLog(resumen);
	if (linea) console.log(`${linea}${error ? ' · ERROR' : ''}`);
	await auditoria.registrarUso({
		idEmpresa: req.idEmpresa,
		actor: req.valorPersonal,
		accion: error ? 'MENSAJE_ERROR' : 'MENSAJE',
		idConversacion: result?.idConversacion || req.body?.idConversacion || null,
		detalle: {
			herramientas: result?.herramientas,
			modo: result?.modo,
			ruta: prep?.rutaActual,
			pregunta: prep?.mensaje ? prep.mensaje.slice(0, 160) : undefined,
			stream: stream || undefined,
			error: error ? String(error.message || error).slice(0, 300) : undefined,
			consumo: resumen || undefined,
		},
		ip: ipDe(req),
	});
	return resumen;
}

async function prepararTurno(req) {
	const mensaje = String(req.body?.mensaje || req.body?.texto || '').trim();
	if (!mensaje) {
		const err = new Error('Escribí un mensaje');
		err.statusCode = 400;
		throw err;
	}
	if (mensaje.length > 4000) {
		const err = new Error('El mensaje es demasiado largo');
		err.statusCode = 400;
		throw err;
	}

	const pantalla = contexto.pantallaDeBody(req.body?.pantalla);
	const rutaActual = String(req.body?.rutaActual || pantalla?.url || '').slice(0, 300);
	const permisos = await contexto.permisosDeReq(req);
	const moduloActual = contexto.moduloDeRuta(rutaActual);
	const entidades = {
		...contexto.extraerEntidadesRuta(rutaActual),
		...(req.body?.contexto && typeof req.body.contexto === 'object' ? req.body.contexto : {}),
	};
	if (!entidades.numeroVisita && pantalla?.internado?.numeroVisita) {
		entidades.numeroVisita = String(pantalla.internado.numeroVisita);
	}
	const puedeSql = sqlLectura.puedeUsarSql(req.rolNombre, permisos);
	const conv = sesion.obtenerOCrear({
		idConversacion: req.body?.idConversacion,
		idEmpresa: req.idEmpresa,
		valorPersonal: req.valorPersonal,
		rutaActual,
	});
	sesion.agregarMensaje(conv, 'user', mensaje);
	const ruta = orquestador.resolver({
		texto: mensaje,
		moduloRuta: moduloActual,
		agenteActivo: conv.agente,
	});
	sesion.guardarAgente(conv, ruta.id);
	const herramientas = catalogo.seleccionar({
		permisos,
		agente: ruta.id,
		moduloActual,
		tienePermiso: permisosService.tienePermiso,
		puedeSql,
	});

	return {
		mensaje,
		rutaActual,
		permisos,
		moduloActual,
		entidades,
		herramientas,
		conv,
		puedeSql,
		pantalla,
		rutaAgente: ruta,
	};
}

const AFIRMA_CHAT = /^(si|sí|ok|dale|bueno|perfecto|confirmo|confirmado|yes)(\b.*)?$/i;

function respuestaAfirmaPendiente(mensaje, req, conv) {
	if (!AFIRMA_CHAT.test(String(mensaje || '').trim())) return null;
	const activos = pendientes.activosDe(req.idEmpresa, req.valorPersonal).map(pendientes.paraUi);
	if (!activos.length) return null;
	const texto =
		'La acción ya está armada. Tocá Confirmar en la tarjeta: un «sí» acá no la ejecuta.';
	sesion.agregarMensaje(conv, 'assistant', texto, { modo: 'local' });
	return {
		texto,
		herramientas: [],
		navegaciones: [],
		pendientes: activos,
		consultas: [],
		inserciones: [],
		agente: conv.agente || 'SOPORTE',
		idConversacion: conv.id,
		modo: 'local',
	};
}

const DISCLAIMER_RESUMEN =
	'Respuesta basada en un resumen automático de los registros: puede omitir detalles. Verificá en la historia clínica.';

/** Pantallas de la app con cualquier host, rutas relativas, localhost o hosts sin dominio («https://dashboard/…»). */
const URL_INTERNA = /^(?:\/|https?:\/\/(?:localhost|[^\s/.)]+)(?:[:/]|$)|https?:\/\/[^\s/)]+\/dashboard\b)/i;

/** El modelo a veces inventa links a pantallas: el chat ya muestra el botón de navegación. */
function sinLinksInternos(texto) {
	if (!texto) return texto;
	return texto
		.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (todo, etiqueta, url) => (URL_INTERNA.test(url) ? etiqueta : todo))
		.replace(/\s*\(?https?:\/\/[^\s)]+\)?/gi, (url) => (URL_INTERNA.test(url.trim().replace(/^\(/, '')) ? '' : url));
}

/** Con historial largo el modelo a veces recapitulaba los turnos anteriores en vez de responder el nuevo. */
const RECORDATORIO_TURNO = Object.freeze({
	role: 'system',
	content:
		'Mensaje nuevo del usuario. Respondé SOLO eso, con lo que devuelvan las tools que llames ahora. No repitas ficha, estudios ni otros datos de respuestas anteriores salvo que los pida.',
});

async function correrModelo({
	mensaje,
	rutaActual,
	permisos,
	moduloActual,
	entidades,
	herramientas,
	conv,
	puedeSql,
	pantalla,
	rutaAgente,
	ctx,
	onEvento,
}) {
	if (!openai.isConfigured()) {
		const local = responderSinModelo({ texto: mensaje, permisos, rutaActual });
		sesion.agregarMensaje(conv, 'assistant', local.texto, { modo: 'local' });
		return {
			texto: local.texto,
			herramientas: [],
			navegaciones: local.navegaciones || [],
			pendientes: [],
			agente: rutaAgente?.id || 'SOPORTE',
			idConversacion: conv.id,
			modo: 'local',
		};
	}

	const prev = sesion.historialParaModelo(conv);
	const sinUltimoUser =
		!conv.openai && prev.length && prev[prev.length - 1].role === 'user' ? prev.slice(0, -1) : prev;
	const messages = [
		{
			role: 'system',
			content: construirSystemPrompt({
				rol: ctx.req.rolNombre,
				rutaActual,
				moduloActual,
				entidades: {
					...entidades,
					focoTexto: ctx.foco ? require('./ficha').textoDe(ctx.foco) : '',
				},
				herramientas,
				pantalla,
				permisosResumen: contexto.resumenPermisos(permisos),
				identidad: autoria.identidad(ctx.req),
				esAdmin: await autoria.esAdmin(ctx.req),
				agente: rutaAgente?.id || 'SOPORTE',
				avisoModulo: rutaAgente?.aviso || null,
				instrucciones: (rutaAgente?.agente || orquestador.porId('SOPORTE')).instrucciones({
					avisoModulo: rutaAgente?.aviso || null,
				}),
			}),
		},
		...sinUltimoUser,
		...[sesion.notaAcciones(conv)].filter(Boolean),
		...(sinUltimoUser.length ? [RECORDATORIO_TURNO] : []),
		{ role: 'user', content: mensaje },
	];

	const out = await agenteLoop({
		messages,
		tools: herramientas.map(catalogo.aOpenAi),
		ejecutar: (nombre, args) => ejecutarMod.ejecutar(nombre, args, ctx),
		chat: consumo.medirChat((opts) => openai.chatConHerramientas(opts), ctx.medidor),
		maxIter: MAX_ITER,
		onEvento,
	});
	sesion.guardarOpenai(conv, out.messages);

	const usadas = out.invocadas.map((i) => i.nombre);
	const texto =
		sinLinksInternos(out.texto) ||
		'No pude completar eso ahora. Probá de nuevo o pedime que te lleve a la pantalla.';
	sesion.agregarMensaje(conv, 'assistant', texto, {
		herramientas: usadas,
	});

	return {
		texto,
		disclaimer: ctx.resumido ? DISCLAIMER_RESUMEN : undefined,
		herramientas: usadas,
		navegaciones: ctx.navegaciones,
		pendientes: ctx.pendientes,
		consultas: ctx.consultas,
		inserciones: ctx.inserciones,
		agente: rutaAgente?.id || 'SOPORTE',
		idConversacion: conv.id,
		modo: 'ia',
		...(incluirTraza(ctx) ? { traza: ctx.traza } : {}),
	};
}

async function mensaje(req, res) {
	let prep;
	let ctx;
	try {
		prep = await prepararTurno(req);
		ctx = armarCtx(req, prep.permisos, prep.pantalla, prep.entidades, prep.conv);
		const atajo = respuestaAfirmaPendiente(prep.mensaje, req, prep.conv);
		const result = atajo || (await correrModelo({ ...prep, ctx }));
		await registrarMensaje(req, { prep, ctx, result });
		return res.json({ success: true, ...result, consumo: consumoParaCliente(ctx) });
	} catch (err) {
		if (ctx) await registrarMensaje(req, { prep, ctx, error: err });
		const status = err.statusCode || 500;
		return res.status(status).json({
			success: false,
			mensaje: err.message || 'Error en el asistente',
		});
	}
}

function incluirTraza(ctx) {
	const raw = ctx?.req?.body?.debug;
	return raw === true || raw === '1' || raw === 1 || process.env.ASISTENTE_TRAZA === '1';
}

function consumoParaCliente(ctx) {
	const r = ctx?.medidor?.resumen();
	if (!r || !(r.llamadas || r.llamadasExternas)) return null;
	return {
		modelo: r.modelo,
		llamadas: r.llamadas,
		llamadasExternas: r.llamadasExternas,
		ms: r.ms,
		tokens: r.tokens,
		costoUsd: r.costoUsd,
		costoArs: r.costoArs,
		composicionEntrada: r.composicionEntrada,
		porHerramienta: r.porHerramienta,
	};
}

function writeSse(res, event, data) {
	res.write(`event: ${event}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function mensajeStream(req, res) {
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders?.();

	let prep;
	let ctx;
	try {
		prep = await prepararTurno(req);
		ctx = armarCtx(req, prep.permisos, prep.pantalla, prep.entidades, prep.conv);
		writeSse(res, 'estado', { fase: 'pensando' });
		const atajo = respuestaAfirmaPendiente(prep.mensaje, req, prep.conv);
		const result =
			atajo ||
			(await correrModelo({
				...prep,
				ctx,
				onEvento: (evt) => writeSse(res, evt.tipo || 'estado', evt),
			}));
		await registrarMensaje(req, { prep, ctx, result, stream: true });
		writeSse(res, 'done', result);
		res.end();
	} catch (err) {
		if (ctx) await registrarMensaje(req, { prep, ctx, error: err, stream: true });
		writeSse(res, 'error', { mensaje: err.message || 'Error en el asistente' });
		res.end();
	}
}

const TITULO_OK = { POST: 'Guardado', PUT: 'Cambios aplicados', PATCH: 'Cambios aplicados', DELETE: 'Eliminado' };
const TITULO_ERROR = {
	POST: 'No se guardó',
	PUT: 'No se aplicaron los cambios',
	PATCH: 'No se aplicaron los cambios',
	DELETE: 'No se eliminó',
};

function motivoAmigable(status, motivo) {
	if (status === 401) return 'Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.';
	if (status === 403) return 'Tu usuario no tiene permiso para hacer esto, o el registro no es tuyo.';
	if (status === 404) return 'El registro ya no existe o lo movieron.';
	if (status === 409) return 'Ya existe un registro con esos datos.';
	if (status >= 500) return 'El sistema no pudo completar la acción. Probá de nuevo y, si sigue, avisá a soporte.';
	return `Hay un dato que falta o no es válido: ${motivo}`;
}

async function confirmar(req, res) {
	try {
		const id = String(req.body?.idPendiente || req.params?.id || '').trim();
		if (!id) {
			return res.status(400).json({ success: false, mensaje: 'Falta idPendiente' });
		}
		const previo = pendientes.peek(id, req.idEmpresa, req.valorPersonal);
		if (previo && previo.tipo !== 'http') {
			return res.status(400).json({ success: false, mensaje: 'Esta acción se aplica en la pantalla, no se confirma' });
		}
		const item = pendientes.tomar(id, req.idEmpresa, req.valorPersonal);
		if (!item) {
			return res.status(404).json({ success: false, mensaje: 'La acción expiró o no existe' });
		}
		const ahora = new Date();
		const body = marca.marcarBody(item.http.body, item.generativo, req, ahora);
		const cred = contexto.credencialesDeReq(req);
		const resp = await httpInterno.llamar({
			method: item.http.method,
			path: item.http.path,
			query: item.http.query,
			body,
			headers: httpInterno.headersDesdeReq(req, cred.token),
		});
		const recorte = recortar.deApi(resp);
		await auditoria.registrarUso({
			idEmpresa: req.idEmpresa,
			actor: req.valorPersonal,
			accion: item.generativo.length ? 'CONFIRMAR_GENERATIVO' : 'CONFIRMAR',
			idConversacion: req.body?.idConversacion || null,
			herramienta: item.herramienta,
			detalle: {
				resumen: item.resumen,
				metodo: item.http.method,
				path: item.http.path,
				status: resp.status,
				camposGenerados: item.generativo,
				validadoPor: item.generativo.length ? marca.validadorDe(req) : undefined,
			},
			ip: ipDe(req),
		});
		const ok = resp.status < 400 && !recorte.error;
		const motivo = recorte.error || `HTTP ${resp.status}`;
		const conv = sesion.obtener(req.body?.idConversacion, req.idEmpresa, req.valorPersonal);
		sesion.anotarAccion(
			conv,
			ok
				? `[Confirmado y ejecutado] ${item.resumen}`
				: `[La acción NO se ejecutó, no quedó guardado] ${item.resumen}. Motivo: ${motivo}`,
		);
		return res.json({
			success: ok,
			mensaje: ok ? item.resumen : `No se guardó. ${motivo}`,
			titulo: (ok ? TITULO_OK : TITULO_ERROR)[item.http.method] || (ok ? 'Listo' : 'No se guardó'),
			resumen: item.resumen,
			motivo: ok ? null : motivoAmigable(resp.status, motivo),
			detalleTecnico: ok ? null : motivo,
			resultado: recorte,
			herramienta: item.herramienta,
			link: item.link || null,
		});
	} catch (err) {
		return res.status(err.statusCode || 500).json({
			success: false,
			mensaje: err.message || 'Error al confirmar',
		});
	}
}

/** El usuario acepta un texto propuesto para un campo de la pantalla. */
async function aplicar(req, res) {
	const id = String(req.body?.idInsercion || '').trim();
	const previo = pendientes.peek(id, req.idEmpresa, req.valorPersonal);
	if (!previo || previo.tipo !== 'insercion') {
		return res.status(404).json({ success: false, mensaje: 'La sugerencia expiró o no existe' });
	}
	const item = pendientes.tomar(id, req.idEmpresa, req.valorPersonal);
	const ins = item.insercion;
	const ahora = new Date();
	const textoMarca = marca.textoMarca(req, ahora);
	const texto = ins.multilinea ? marca.marcar(ins.texto, req, ahora) : ins.texto;
	await auditoria.registrarUso({
		idEmpresa: req.idEmpresa,
		actor: req.valorPersonal,
		accion: 'APLICAR_GENERATIVO',
		idConversacion: req.body?.idConversacion || null,
		herramienta: 'escribir_en_campo',
		detalle: {
			campo: ins.etiqueta,
			ruta: ins.ruta,
			modo: ins.modo,
			caracteres: ins.texto.length,
			validadoPor: marca.validadorDe(req),
		},
		ip: ipDe(req),
	});
	return res.json({
		success: true,
		campoId: ins.campoId,
		modo: ins.modo,
		texto,
		marca: textoMarca,
		marcaEnTexto: Boolean(ins.multilinea),
	});
}

function cancelar(req, res) {
	const id = String(req.body?.idPendiente || req.params?.id || '').trim();
	const previo = pendientes.peek(id, req.idEmpresa, req.valorPersonal);
	const ok = pendientes.cancelar(id, req.idEmpresa, req.valorPersonal);
	if (ok && previo?.resumen) {
		const conv = sesion.obtener(req.body?.idConversacion, req.idEmpresa, req.valorPersonal);
		sesion.anotarAccion(conv, `[Cancelado por el usuario, NO se ejecutó] ${previo.resumen}`);
	}
	return res.json({ success: ok, mensaje: ok ? 'Acción cancelada' : 'No había nada que cancelar' });
}

async function capacidades(req, res) {
	const manifiesto = require('./manifiesto');
	const permisos = await contexto.permisosDeReq(req);
	const puedeSql = sqlLectura.puedeUsarSql(req.rolNombre, permisos);
	const herramientas = catalogo.seleccionar({
		permisos,
		agente: 'SOPORTE',
		moduloActual: null,
		tienePermiso: permisosService.tienePermiso,
		puedeSql,
	});
	return res.json({
		success: true,
		modelo: openai.isConfigured() ? openai.getModel() : null,
		rol: req.rolNombre || null,
		sql: puedeSql,
		agenteActivo: 'SOPORTE',
		agentes: orquestador.estado(),
		herramientas: herramientas.map((h) => h.name),
		endpoints: manifiesto.obtener().length,
		modulos: manifiesto.resumenModulos(),
		api: {
			sesion: 'POST /api/asistente/sesion',
			run: 'POST /api/asistente/mensaje',
			runStream: 'POST /api/asistente/mensaje/stream',
			confirmar: 'POST /api/asistente/confirmar',
		},
	});
}

function filtrosConsumo(req) {
	const actorQ = req.query?.actor;
	const actor = actorQ != null && actorQ !== '' ? Number(actorQ) : null;
	if (actor != null && !Number.isFinite(actor)) {
		throw Object.assign(new Error('actor inválido'), { statusCode: 400 });
	}
	return { idEmpresa: req.idEmpresa, desde: req.query?.desde, hasta: req.query?.hasta, actor };
}

async function reporteConsumo(req, res) {
	try {
		const data = await reporte.generar(filtrosConsumo(req));
		return res.json({ success: true, data });
	} catch (err) {
		if (err.statusCode === 400) return res.status(400).json({ success: false, mensaje: err.message });
		console.error('[asistente] reporte de consumo:', err);
		return res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte de consumo' });
	}
}

async function consumoMensajes(req, res) {
	try {
		const data = await reporte.listarMensajes({
			...filtrosConsumo(req),
			limite: req.query?.limite,
			pagina: req.query?.pagina,
		});
		return res.json({ success: true, data });
	} catch (err) {
		if (err.statusCode === 400) return res.status(400).json({ success: false, mensaje: err.message });
		console.error('[asistente] consumo por mensaje:', err);
		return res.status(500).json({ success: false, mensaje: 'No se pudo listar el consumo por mensaje' });
	}
}

function nuevaSesion(req, res) {
	const conv = sesion.crear({
		idEmpresa: req.idEmpresa,
		valorPersonal: req.valorPersonal,
		rutaActual: req.body?.rutaActual || null,
	});
	return res.json({ success: true, idConversacion: conv.id });
}

module.exports = {
	mensaje,
	mensajeStream,
	confirmar,
	aplicar,
	cancelar,
	nuevaSesion,
	capacidades,
	reporteConsumo,
	consumoMensajes,
};
