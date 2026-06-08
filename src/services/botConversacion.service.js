const { executeQuery } = require('../models/db');

/** @typedef {'BOT'|'HUMANO'|'PAUSADO'} ModoControl */
/** @typedef {'IN'|'OUT'} Direccion */
/** @typedef {'PACIENTE'|'BOT'|'AGENTE'|'SISTEMA'} OrigenMensaje */

let tablesChecked = null;
let useMemory = false;

/** @type {Map<string, object>} */
const memConversaciones = new Map();
/** @type {Map<string, object[]>} */
const memMensajes = new Map();
let memIdSeq = 1;

function normalizarTelefono(tel) {
	return String(tel || '')
		.replace(/\D/g, '')
		.slice(-15);
}

function idDesdeTelefono(telefono) {
	const t = normalizarTelefono(telefono);
	return t ? `wa-${t}` : `wa-${Date.now()}`;
}

function mapConversacion(row) {
	return {
		idConversacion: row.IdConversacion ?? row.idConversacion,
		telefonoWhatsApp: row.TelefonoWhatsApp ?? row.telefonoWhatsApp,
		nombreContacto: row.NombreContacto ?? row.nombreContacto ?? null,
		idPaciente: row.IdPaciente ?? row.idPaciente ?? null,
		dniPaciente: row.DniPaciente ?? row.dniPaciente ?? null,
		modoControl: row.ModoControl ?? row.modoControl ?? 'BOT',
		pasoBot: row.PasoBot ?? row.pasoBot ?? null,
		idAgente: row.IdAgente ?? row.idAgente ?? null,
		nombreAgente: row.NombreAgente ?? row.nombreAgente ?? null,
		noLeidos: row.NoLeidos ?? row.noLeidos ?? 0,
		ultimoMensaje: row.UltimoMensaje ?? row.ultimoMensaje ?? null,
		fechaUltimoMensaje: row.FechaUltimoMensaje ?? row.fechaUltimoMensaje ?? null,
		fechaCreacion: row.FechaCreacion ?? row.fechaCreacion ?? null,
	};
}

function mapMensaje(row) {
	return {
		idMensaje: row.IdMensaje ?? row.idMensaje,
		idConversacion: row.IdConversacion ?? row.idConversacion,
		direccion: row.Direccion ?? row.direccion,
		origen: row.Origen ?? row.origen,
		contenido: row.Contenido ?? row.contenido,
		estadoEntrega: row.EstadoEntrega ?? row.estadoEntrega ?? 'ENVIADO',
		idAgente: row.IdAgente ?? row.idAgente ?? null,
		nombreAgente: row.NombreAgente ?? row.nombreAgente ?? null,
		metaMessageId: row.MetaMessageId ?? row.metaMessageId ?? null,
		fechaMensaje: row.FechaMensaje ?? row.fechaMensaje,
	};
}

async function checkConversationTables() {
	if (tablesChecked !== null) return tablesChecked;
	try {
		const rows = await executeQuery(
			`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_SCHEMA = 'dbo'
			   AND TABLE_NAME IN ('imBotConversacion', 'imBotMensaje')`,
		);
		tablesChecked = Number(rows?.[0]?.cnt) >= 2;
		useMemory = !tablesChecked;
		if (useMemory) {
			console.warn(
				'[botConversacion] Tablas imBotConversacion/imBotMensaje no encontradas — usando memoria (solo sesión actual)',
			);
		}
	} catch {
		tablesChecked = false;
		useMemory = true;
	}
	return tablesChecked;
}

function memUpsertConversacion(data) {
	const id = data.idConversacion;
	const prev = memConversaciones.get(id) || {};
	const merged = {
		...prev,
		...data,
		fechaCreacion: prev.fechaCreacion || data.fechaCreacion || new Date(),
	};
	memConversaciones.set(id, merged);
	return merged;
}

function memAddMensaje(msg) {
	const id = msg.idConversacion;
	const list = memMensajes.get(id) || [];
	const full = { ...msg, idMensaje: msg.idMensaje || memIdSeq++ };
	list.push(full);
	memMensajes.set(id, list);

	const conv = memConversaciones.get(id);
	if (conv) {
		conv.ultimoMensaje = String(msg.contenido || '').slice(0, 500);
		conv.fechaUltimoMensaje = msg.fechaMensaje || new Date();
		if (msg.direccion === 'IN' && msg.origen === 'PACIENTE') {
			conv.noLeidos = (conv.noLeidos || 0) + 1;
		}
		memConversaciones.set(id, conv);
	}
	return full;
}

async function obtenerOCrearConversacion({
	idConversacion,
	telefonoWhatsApp,
	nombreContacto = null,
	idPaciente = null,
	dniPaciente = null,
}) {
	await checkConversationTables();
	const tel = normalizarTelefono(telefonoWhatsApp);
	const idConv = idConversacion || idDesdeTelefono(tel);

	if (useMemory) {
		const existing = memConversaciones.get(idConv);
		if (existing) {
			if (nombreContacto && !existing.nombreContacto) existing.nombreContacto = nombreContacto;
			if (idPaciente && !existing.idPaciente) existing.idPaciente = idPaciente;
			if (dniPaciente && !existing.dniPaciente) existing.dniPaciente = dniPaciente;
			memConversaciones.set(idConv, existing);
			return mapConversacion(existing);
		}
		const created = memUpsertConversacion({
			idConversacion: idConv,
			telefonoWhatsApp: tel,
			nombreContacto,
			idPaciente,
			dniPaciente,
			modoControl: 'BOT',
			pasoBot: 'inicio',
			noLeidos: 0,
			fechaCreacion: new Date(),
		});
		return mapConversacion(created);
	}

	const rows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotConversacion WHERE IdConversacion = @p0 AND Activo = 1`,
		[{ value: idConv, type: 'VarChar' }],
	);
	if (rows.length) return mapConversacion(rows[0]);

	await executeQuery(
		`INSERT INTO dbo.imBotConversacion
		   (IdConversacion, TelefonoWhatsApp, NombreContacto, IdPaciente, DniPaciente, ModoControl, PasoBot)
		 VALUES (@p0, @p1, @p2, @p3, @p4, 'BOT', 'inicio')`,
		[
			{ value: idConv, type: 'VarChar' },
			{ value: tel, type: 'VarChar' },
			{ value: nombreContacto, type: 'VarChar' },
			{ value: idPaciente, type: 'Int' },
			{ value: dniPaciente, type: 'VarChar' },
		],
	);
	const created = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotConversacion WHERE IdConversacion = @p0`,
		[{ value: idConv, type: 'VarChar' }],
	);
	return mapConversacion(created[0]);
}

async function existeMensajePorMetaId(metaMessageId) {
	const mid = String(metaMessageId || '').trim();
	if (!mid) return null;
	await checkConversationTables();
	if (useMemory) {
		for (const list of memMensajes.values()) {
			const hit = list.find((m) => m.metaMessageId === mid);
			if (hit) return mapMensaje(hit);
		}
		return null;
	}
	const rows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotMensaje WHERE MetaMessageId = @p0 ORDER BY IdMensaje DESC`,
		[{ value: mid, type: 'VarChar' }],
	);
	return rows[0] ? mapMensaje(rows[0]) : null;
}

/** ¿Ya hay respuesta BOT/AGENTE posterior a este mensaje entrante? */
async function yaRespondidoAlMensaje(idConversacion, idMensajePaciente) {
	const idConv = String(idConversacion || '').trim();
	const idMsg = Number(idMensajePaciente);
	if (!idConv || !Number.isFinite(idMsg) || idMsg <= 0) return false;

	await checkConversationTables();
	if (useMemory) {
		const list = memMensajes.get(idConv) || [];
		return list.some(
			(m) =>
				(m.origen === 'BOT' || m.origen === 'AGENTE') &&
				Number(m.idMensaje) > idMsg,
		);
	}

	const rows = await executeQuery(
		`SELECT TOP 1 IdMensaje FROM dbo.imBotMensaje
		 WHERE IdConversacion = @p0
		   AND Origen IN ('BOT', 'AGENTE')
		   AND IdMensaje > @p1`,
		[
			{ value: idConv, type: 'VarChar' },
			{ value: idMsg, type: 'Int' },
		],
	);
	return rows.length > 0;
}

/** ¿Ya respondimos al mensaje entrante identificado por Meta wamid? */
async function yaRespondidoAMetaMessage(idConversacion, metaMessageId) {
	const mid = String(metaMessageId || '').trim();
	if (!mid) return false;

	const inbound = await existeMensajePorMetaId(mid);
	if (!inbound) return false;
	if (String(inbound.idConversacion) !== String(idConversacion)) return false;

	return yaRespondidoAlMensaje(idConversacion, inbound.idMensaje);
}

async function registrarMensajeEntrante({
	telefonoWhatsApp,
	contenido,
	idConversacion = null,
	nombreContacto = null,
	idPaciente = null,
	dniPaciente = null,
	metaMessageId = null,
	incrementarNoLeidos = true,
}) {
	const conv = await obtenerOCrearConversacion({
		idConversacion,
		telefonoWhatsApp,
		nombreContacto,
		idPaciente,
		dniPaciente,
	});
	const texto = String(contenido || '').trim();
	if (!texto) {
		const err = new Error('El mensaje no puede estar vacío');
		err.statusCode = 400;
		throw err;
	}

	if (metaMessageId) {
		const dup = await existeMensajePorMetaId(metaMessageId);
		if (dup) {
			return {
				conversacion: conv,
				mensaje: dup,
				duplicado: true,
			};
		}
	}
	if (useMemory) {
		const msg = memAddMensaje({
			idConversacion: conv.idConversacion,
			direccion: 'IN',
			origen: 'PACIENTE',
			contenido: texto,
			estadoEntrega: 'ENTREGADO',
			metaMessageId,
			fechaMensaje: new Date(),
		});
		if (!incrementarNoLeidos) {
			const c = memConversaciones.get(conv.idConversacion);
			if (c) {
				c.noLeidos = Math.max(0, (c.noLeidos || 1) - 1);
				memConversaciones.set(conv.idConversacion, c);
			}
		}
		return { conversacion: mapConversacion(memConversaciones.get(conv.idConversacion)), mensaje: mapMensaje(msg), duplicado: false };
	}

	const rows = await executeQuery(
		`INSERT INTO dbo.imBotMensaje
		   (IdConversacion, Direccion, Origen, Contenido, EstadoEntrega, MetaMessageId)
		 VALUES (@p0, 'IN', 'PACIENTE', @p1, 'ENTREGADO', @p2);
		 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdMensaje;`,
		[
			{ value: conv.idConversacion, type: 'VarChar' },
			{ value: texto, type: 'NVarChar' },
			{ value: metaMessageId, type: 'VarChar' },
		],
	);
	const idMensaje = rows?.[0]?.IdMensaje;
	const noLeidosSql = incrementarNoLeidos ? 'NoLeidos = NoLeidos + 1,' : '';
	await executeQuery(
		`UPDATE dbo.imBotConversacion SET
		   ${noLeidosSql}
		   UltimoMensaje = @p1,
		   FechaUltimoMensaje = GETDATE(),
		   NombreContacto = COALESCE(@p2, NombreContacto),
		   IdPaciente = COALESCE(@p3, IdPaciente),
		   DniPaciente = COALESCE(@p4, DniPaciente)
		 WHERE IdConversacion = @p0`,
		[
			{ value: conv.idConversacion, type: 'VarChar' },
			{ value: texto.slice(0, 500), type: 'NVarChar' },
			{ value: nombreContacto, type: 'VarChar' },
			{ value: idPaciente, type: 'Int' },
			{ value: dniPaciente, type: 'VarChar' },
		],
	);
	const msgRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotMensaje WHERE IdMensaje = @p0`,
		[{ value: idMensaje, type: 'Int' }],
	);
	const convRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotConversacion WHERE IdConversacion = @p0`,
		[{ value: conv.idConversacion, type: 'VarChar' }],
	);
	return {
		conversacion: mapConversacion(convRows[0]),
		mensaje: mapMensaje(msgRows[0]),
		duplicado: false,
	};
}

async function registrarMensajeSaliente({
	idConversacion,
	contenido,
	origen = 'AGENTE',
	idAgente = null,
	nombreAgente = null,
	metaMessageId = null,
}) {
	const texto = String(contenido || '').trim();
	if (!texto) {
		const err = new Error('El mensaje no puede estar vacío');
		err.statusCode = 400;
		throw err;
	}
	await checkConversationTables();

	if (useMemory) {
		const conv = memConversaciones.get(idConversacion);
		if (!conv) {
			const err = new Error('Conversación no encontrada');
			err.statusCode = 404;
			throw err;
		}
		const msg = memAddMensaje({
			idConversacion,
			direccion: 'OUT',
			origen,
			contenido: texto,
			estadoEntrega: 'ENVIADO',
			idAgente,
			nombreAgente,
			metaMessageId,
			fechaMensaje: new Date(),
		});
		return { conversacion: mapConversacion(memConversaciones.get(idConversacion)), mensaje: mapMensaje(msg) };
	}

	const rows = await executeQuery(
		`INSERT INTO dbo.imBotMensaje
		   (IdConversacion, Direccion, Origen, Contenido, EstadoEntrega, IdAgente, NombreAgente, MetaMessageId)
		 VALUES (@p0, 'OUT', @p1, @p2, 'ENVIADO', @p3, @p4, @p5);
		 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdMensaje;`,
		[
			{ value: idConversacion, type: 'VarChar' },
			{ value: origen, type: 'VarChar' },
			{ value: texto, type: 'NVarChar' },
			{ value: idAgente, type: 'Int' },
			{ value: nombreAgente, type: 'VarChar' },
			{ value: metaMessageId, type: 'VarChar' },
		],
	);
	await executeQuery(
		`UPDATE dbo.imBotConversacion SET
		   UltimoMensaje = @p1,
		   FechaUltimoMensaje = GETDATE()
		 WHERE IdConversacion = @p0`,
		[
			{ value: idConversacion, type: 'VarChar' },
			{ value: texto.slice(0, 500), type: 'NVarChar' },
		],
	);
	const msgRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotMensaje WHERE IdMensaje = @p0`,
		[{ value: rows?.[0]?.IdMensaje, type: 'Int' }],
	);
	const convRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotConversacion WHERE IdConversacion = @p0`,
		[{ value: idConversacion, type: 'VarChar' }],
	);
	return { conversacion: mapConversacion(convRows[0]), mensaje: mapMensaje(msgRows[0]) };
}

async function listarConversaciones({ limit = 50, soloNoLeidos = false } = {}) {
	await checkConversationTables();
	const lim = Math.min(100, Math.max(1, Number(limit) || 50));

	if (useMemory) {
		let list = [...memConversaciones.values()].map(mapConversacion);
		if (soloNoLeidos) list = list.filter((c) => (c.noLeidos || 0) > 0);
		list.sort(
			(a, b) =>
				new Date(b.fechaUltimoMensaje || b.fechaCreacion || 0).getTime() -
				new Date(a.fechaUltimoMensaje || a.fechaCreacion || 0).getTime(),
		);
		return {
			disponible: true,
			almacenamiento: 'memoria',
			conversaciones: list.slice(0, lim),
		};
	}

	const filtro = soloNoLeidos ? 'AND NoLeidos > 0' : '';
	const rows = await executeQuery(
		`SELECT TOP ${lim} *
		 FROM dbo.imBotConversacion
		 WHERE Activo = 1 ${filtro}
		 ORDER BY FechaUltimoMensaje DESC, FechaCreacion DESC`,
	);
	return {
		disponible: true,
		almacenamiento: 'sql',
		conversaciones: rows.map(mapConversacion),
	};
}

async function obtenerConversacion(idConversacion) {
	await checkConversationTables();
	if (useMemory) {
		const conv = memConversaciones.get(idConversacion);
		if (!conv) return null;
		return mapConversacion(conv);
	}
	const rows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotConversacion WHERE IdConversacion = @p0 AND Activo = 1`,
		[{ value: idConversacion, type: 'VarChar' }],
	);
	return rows.length ? mapConversacion(rows[0]) : null;
}

async function listarMensajes(idConversacion, { limit = 100, desdeId = null } = {}) {
	await checkConversationTables();
	const lim = Math.min(200, Math.max(1, Number(limit) || 100));

	if (useMemory) {
		let list = (memMensajes.get(idConversacion) || []).map(mapMensaje);
		if (desdeId) list = list.filter((m) => m.idMensaje > Number(desdeId));
		list.sort((a, b) => new Date(a.fechaMensaje).getTime() - new Date(b.fechaMensaje).getTime());
		return list.slice(-lim);
	}

	let filtro = '';
	const params = [{ value: idConversacion, type: 'VarChar' }];
	if (desdeId) {
		filtro = 'AND IdMensaje > @p1';
		params.push({ value: Number(desdeId), type: 'Int' });
	}
	const rows = await executeQuery(
		`SELECT TOP ${lim} *
		 FROM dbo.imBotMensaje
		 WHERE IdConversacion = @p0 ${filtro}
		 ORDER BY FechaMensaje ASC, IdMensaje ASC`,
		params,
	);
	return rows.map(mapMensaje);
}

async function marcarLeida(idConversacion) {
	await checkConversationTables();
	if (useMemory) {
		const conv = memConversaciones.get(idConversacion);
		if (conv) {
			conv.noLeidos = 0;
			memConversaciones.set(idConversacion, conv);
		}
		return obtenerConversacion(idConversacion);
	}
	await executeQuery(
		`UPDATE dbo.imBotConversacion SET NoLeidos = 0 WHERE IdConversacion = @p0`,
		[{ value: idConversacion, type: 'VarChar' }],
	);
	return obtenerConversacion(idConversacion);
}

async function cambiarModoControl(idConversacion, modo, agente = null) {
	const modosValidos = ['BOT', 'HUMANO', 'PAUSADO'];
	const modoUp = String(modo || '').toUpperCase();
	if (!modosValidos.includes(modoUp)) {
		const err = new Error(`Modo inválido. Use: ${modosValidos.join(', ')}`);
		err.statusCode = 400;
		throw err;
	}
	await checkConversationTables();

	const idAgente = agente?.idAgente ?? agente?.valorPersonal ?? null;
	const nombreAgente = agente?.nombreAgente ?? agente?.nombre ?? null;

	if (useMemory) {
		const conv = memConversaciones.get(idConversacion);
		if (!conv) {
			const err = new Error('Conversación no encontrada');
			err.statusCode = 404;
			throw err;
		}
		conv.modoControl = modoUp;
		if (modoUp === 'HUMANO') {
			conv.idAgente = idAgente;
			conv.nombreAgente = nombreAgente;
		} else if (modoUp === 'BOT') {
			conv.idAgente = null;
			conv.nombreAgente = null;
		}
		memConversaciones.set(idConversacion, conv);
		memAddMensaje({
			idConversacion,
			direccion: 'OUT',
			origen: 'SISTEMA',
			contenido:
				modoUp === 'BOT'
					? '🤖 El bot retomó la conversación.'
					: modoUp === 'HUMANO'
						? `👤 ${nombreAgente || 'Un agente'} tomó el control del chat.`
						: '⏸️ Bot pausado. Un agente puede responder manualmente.',
			estadoEntrega: 'ENTREGADO',
			fechaMensaje: new Date(),
		});
		return mapConversacion(conv);
	}

	const conv = await obtenerConversacion(idConversacion);
	if (!conv) {
		const err = new Error('Conversación no encontrada');
		err.statusCode = 404;
		throw err;
	}

	await executeQuery(
		`UPDATE dbo.imBotConversacion SET
		   ModoControl = @p1,
		   IdAgente = @p2,
		   NombreAgente = @p3
		 WHERE IdConversacion = @p0`,
		[
			{ value: idConversacion, type: 'VarChar' },
			{ value: modoUp, type: 'VarChar' },
			{ value: modoUp === 'HUMANO' ? idAgente : null, type: 'Int' },
			{ value: modoUp === 'HUMANO' ? nombreAgente : null, type: 'VarChar' },
		],
	);

	const sysMsg =
		modoUp === 'BOT'
			? '🤖 El bot retomó la conversación.'
			: modoUp === 'HUMANO'
				? `👤 ${nombreAgente || 'Un agente'} tomó el control del chat.`
				: '⏸️ Bot pausado. Un agente puede responder manualmente.';

	await registrarMensajeSaliente({
		idConversacion,
		contenido: sysMsg,
		origen: 'SISTEMA',
	});

	return obtenerConversacion(idConversacion);
}

async function puedeResponderBot(idConversacion) {
	const conv = await obtenerConversacion(idConversacion);
	if (!conv) return { existe: false, puedeResponderBot: true, modoControl: 'BOT' };
	return {
		existe: true,
		puedeResponderBot: conv.modoControl === 'BOT',
		modoControl: conv.modoControl,
		pasoBot: conv.pasoBot,
		idPaciente: conv.idPaciente,
		dniPaciente: conv.dniPaciente,
	};
}

async function puedeResponderBotPorTelefono(telefono) {
	const tel = normalizarTelefono(telefono);
	const idConv = idDesdeTelefono(tel);
	return puedeResponderBot(idConv);
}

async function actualizarContextoPaciente(idConversacion, { idPaciente, dniPaciente, nombreContacto, pasoBot }) {
	await checkConversationTables();
	if (useMemory) {
		const conv = memConversaciones.get(idConversacion);
		if (!conv) return null;
		if (idPaciente != null) conv.idPaciente = idPaciente;
		if (dniPaciente != null) conv.dniPaciente = dniPaciente;
		if (nombreContacto != null) conv.nombreContacto = nombreContacto;
		if (pasoBot != null) conv.pasoBot = pasoBot;
		memConversaciones.set(idConversacion, conv);
		return mapConversacion(conv);
	}
	await executeQuery(
		`UPDATE dbo.imBotConversacion SET
		   IdPaciente = COALESCE(@p1, IdPaciente),
		   DniPaciente = COALESCE(@p2, DniPaciente),
		   NombreContacto = COALESCE(@p3, NombreContacto),
		   PasoBot = COALESCE(@p4, PasoBot)
		 WHERE IdConversacion = @p0`,
		[
			{ value: idConversacion, type: 'VarChar' },
			{ value: idPaciente, type: 'Int' },
			{ value: dniPaciente, type: 'VarChar' },
			{ value: nombreContacto, type: 'VarChar' },
			{ value: pasoBot, type: 'VarChar' },
		],
	);
	return obtenerConversacion(idConversacion);
}

/**
 * Borra conversación + mensajes de un teléfono (testing desde WhatsApp).
 */
async function resetConversacionPorTelefono(telefonoWhatsApp) {
	await checkConversationTables();
	const tel = normalizarTelefono(telefonoWhatsApp);
	const idConv = idDesdeTelefono(tel);

	if (useMemory) {
		const nMsg = (memMensajes.get(idConv) || []).length;
		memMensajes.delete(idConv);
		memConversaciones.delete(idConv);
		return {
			idConversacion: idConv,
			telefono: tel,
			mensajesEliminados: nMsg,
			conversacionesEliminadas: 1,
		};
	}

	const countRows = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imBotMensaje WHERE IdConversacion = @p0`,
		[{ value: idConv, type: 'VarChar' }],
	);
	const mensajesEliminados = Number(countRows?.[0]?.n || 0);

	await executeQuery(
		`DELETE FROM dbo.imBotMensaje WHERE IdConversacion = @p0`,
		[{ value: idConv, type: 'VarChar' }],
	);
	await executeQuery(
		`DELETE FROM dbo.imBotConversacion WHERE IdConversacion = @p0`,
		[{ value: idConv, type: 'VarChar' }],
	);

	return {
		idConversacion: idConv,
		telefono: tel,
		mensajesEliminados,
		conversacionesEliminadas: 1,
	};
}

/**
 * Borra todas las conversaciones y mensajes del tenant (solo testing con PIN).
 */
async function resetTodasLasConversaciones() {
	await checkConversationTables();

	if (useMemory) {
		let mensajesEliminados = 0;
		for (const list of memMensajes.values()) mensajesEliminados += list.length;
		const conversacionesEliminadas = memConversaciones.size;
		memMensajes.clear();
		memConversaciones.clear();
		return { mensajesEliminados, conversacionesEliminadas };
	}

	const msgCount = await executeQuery(`SELECT COUNT(*) AS n FROM dbo.imBotMensaje`);
	const convCount = await executeQuery(`SELECT COUNT(*) AS n FROM dbo.imBotConversacion`);
	const mensajesEliminados = Number(msgCount?.[0]?.n || 0);
	const conversacionesEliminadas = Number(convCount?.[0]?.n || 0);

	await executeQuery(`DELETE FROM dbo.imBotMensaje`);
	await executeQuery(`DELETE FROM dbo.imBotConversacion`);

	try {
		await executeQuery(`DELETE FROM dbo.imBotTurnosLog`);
	} catch {
		/* tabla opcional */
	}

	return { mensajesEliminados, conversacionesEliminadas };
}

module.exports = {
	checkConversationTables,
	normalizarTelefono,
	idDesdeTelefono,
	obtenerOCrearConversacion,
	registrarMensajeEntrante,
	existeMensajePorMetaId,
	yaRespondidoAlMensaje,
	yaRespondidoAMetaMessage,
	registrarMensajeSaliente,
	listarConversaciones,
	obtenerConversacion,
	listarMensajes,
	marcarLeida,
	cambiarModoControl,
	puedeResponderBot,
	puedeResponderBotPorTelefono,
	actualizarContextoPaciente,
	resetConversacionPorTelefono,
	resetTodasLasConversaciones,
};
