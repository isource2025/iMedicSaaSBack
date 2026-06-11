/**
 * Persistencia unificada inbox WhatsApp en dbo.imBotChat (Tipo: SESION | MSG | LOG).
 * La turnera sigue en imTurnos / imPersonalHorarios (sin tablas extra).
 */
const { executeQuery } = require('../models/db');

function mapSesion(row) {
	if (!row) return null;
	return {
		idConversacion: row.IdSesion,
		telefonoWhatsApp: row.TelefonoWhatsApp,
		nombreContacto: row.NombreContacto ?? null,
		idPaciente: row.IdPaciente ?? null,
		dniPaciente: row.DniPaciente ?? null,
		modoControl: row.ModoControl ?? 'BOT',
		pasoBot: row.PasoBot ?? null,
		contextoBot: _parseJson(row.ContextoBotJson),
		idAgente: row.IdAgente ?? null,
		nombreAgente: row.NombreAgente ?? null,
		noLeidos: row.NoLeidos ?? 0,
		ultimoMensaje: row.UltimoMensaje ?? null,
		fechaUltimoMensaje: row.FechaUltimoMensaje ?? null,
		fechaCreacion: row.FechaRegistro ?? null,
	};
}

function mapMsg(row) {
	if (!row) return null;
	return {
		idMensaje: row.IdRegistro,
		idConversacion: row.IdSesion,
		direccion: row.Direccion,
		origen: row.Origen,
		contenido: row.Contenido,
		estadoEntrega: row.EstadoEntrega ?? 'ENVIADO',
		idAgente: row.IdAgente ?? null,
		nombreAgente: row.NombreAgente ?? null,
		metaMessageId: row.MetaMessageId ?? null,
		fechaMensaje: row.FechaRegistro,
	};
}

function _parseJson(raw) {
	if (raw == null || raw === '') return null;
	if (typeof raw === 'object') return raw;
	try {
		return JSON.parse(String(raw));
	} catch {
		return null;
	}
}

async function tableExists() {
	const rows = await executeQuery(
		`SELECT TOP 1 1 AS ok FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotChat'`,
	);
	return rows.length > 0;
}

async function obtenerSesion(idSesion) {
	const rows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotChat
		 WHERE Tipo = 'SESION' AND IdSesion = @p0 AND SesionActiva = 1`,
		[{ value: idSesion, type: 'VarChar' }],
	);
	return rows.length ? mapSesion(rows[0]) : null;
}

async function obtenerOCrearConversacion({
	idConversacion,
	telefonoWhatsApp,
	nombreContacto = null,
	idPaciente = null,
	dniPaciente = null,
}) {
	const idSesion = idConversacion;
	const existing = await obtenerSesion(idSesion);
	if (existing) {
		if (nombreContacto || idPaciente || dniPaciente) {
			await executeQuery(
				`UPDATE dbo.imBotChat SET
				   NombreContacto = COALESCE(@p1, NombreContacto),
				   IdPaciente = COALESCE(@p2, IdPaciente),
				   DniPaciente = COALESCE(@p3, DniPaciente)
				 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
				[
					{ value: idSesion, type: 'VarChar' },
					{ value: nombreContacto, type: 'VarChar' },
					{ value: idPaciente, type: 'Int' },
					{ value: dniPaciente, type: 'VarChar' },
				],
			);
		}
		return obtenerSesion(idSesion);
	}

	await executeQuery(
		`INSERT INTO dbo.imBotChat
		   (Tipo, IdSesion, TelefonoWhatsApp, NombreContacto, IdPaciente, DniPaciente, ModoControl, PasoBot)
		 VALUES ('SESION', @p0, @p1, @p2, @p3, @p4, 'BOT', 'inicio')`,
		[
			{ value: idSesion, type: 'VarChar' },
			{ value: telefonoWhatsApp, type: 'VarChar' },
			{ value: nombreContacto, type: 'VarChar' },
			{ value: idPaciente, type: 'Int' },
			{ value: dniPaciente, type: 'VarChar' },
		],
	);
	return obtenerSesion(idSesion);
}

async function existeMensajePorMetaId(metaMessageId) {
	const rows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotChat
		 WHERE Tipo = 'MSG' AND MetaMessageId = @p0
		 ORDER BY IdRegistro DESC`,
		[{ value: metaMessageId, type: 'VarChar' }],
	);
	return rows.length ? mapMsg(rows[0]) : null;
}

async function yaRespondidoAlMensaje(idSesion, idMensajeEntrante) {
	const rows = await executeQuery(
		`SELECT TOP 1 IdRegistro FROM dbo.imBotChat
		 WHERE Tipo = 'MSG' AND IdSesion = @p0 AND Direccion = 'OUT'
		   AND IdRegistro > @p1`,
		[
			{ value: idSesion, type: 'VarChar' },
			{ value: Number(idMensajeEntrante), type: 'Int' },
		],
	);
	return rows.length > 0;
}

async function registrarMensajeEntrante({
	conv,
	texto,
	metaMessageId,
	nombreContacto,
	idPaciente,
	dniPaciente,
	incrementarNoLeidos,
}) {
	const rows = await executeQuery(
		`INSERT INTO dbo.imBotChat
		   (Tipo, IdSesion, Direccion, Origen, Contenido, EstadoEntrega, MetaMessageId)
		 VALUES ('MSG', @p0, 'IN', 'PACIENTE', @p1, 'ENTREGADO', @p2);
		 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdRegistro;`,
		[
			{ value: conv.idConversacion, type: 'VarChar' },
			{ value: texto, type: 'NVarChar' },
			{ value: metaMessageId, type: 'VarChar' },
		],
	);
	const noLeidosSql = incrementarNoLeidos ? 'NoLeidos = NoLeidos + 1,' : '';
	await executeQuery(
		`UPDATE dbo.imBotChat SET
		   ${noLeidosSql}
		   UltimoMensaje = @p1,
		   FechaUltimoMensaje = GETDATE(),
		   NombreContacto = COALESCE(@p2, NombreContacto),
		   IdPaciente = COALESCE(@p3, IdPaciente),
		   DniPaciente = COALESCE(@p4, DniPaciente)
		 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		[
			{ value: conv.idConversacion, type: 'VarChar' },
			{ value: texto.slice(0, 500), type: 'NVarChar' },
			{ value: nombreContacto, type: 'VarChar' },
			{ value: idPaciente, type: 'Int' },
			{ value: dniPaciente, type: 'VarChar' },
		],
	);
	const msgRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotChat WHERE IdRegistro = @p0`,
		[{ value: rows?.[0]?.IdRegistro, type: 'Int' }],
	);
	const convAct = await obtenerSesion(conv.idConversacion);
	return { conversacion: convAct, mensaje: mapMsg(msgRows[0]) };
}

async function registrarMensajeSaliente({
	idConversacion,
	texto,
	origen,
	idAgente,
	nombreAgente,
	metaMessageId,
}) {
	const rows = await executeQuery(
		`INSERT INTO dbo.imBotChat
		   (Tipo, IdSesion, Direccion, Origen, Contenido, EstadoEntrega, IdAgente, NombreAgente, MetaMessageId)
		 VALUES ('MSG', @p0, 'OUT', @p1, @p2, 'ENVIADO', @p3, @p4, @p5);
		 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdRegistro;`,
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
		`UPDATE dbo.imBotChat SET UltimoMensaje = @p1, FechaUltimoMensaje = GETDATE()
		 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		[
			{ value: idConversacion, type: 'VarChar' },
			{ value: texto.slice(0, 500), type: 'NVarChar' },
		],
	);
	const msgRows = await executeQuery(
		`SELECT TOP 1 * FROM dbo.imBotChat WHERE IdRegistro = @p0`,
		[{ value: rows?.[0]?.IdRegistro, type: 'Int' }],
	);
	return { conversacion: await obtenerSesion(idConversacion), mensaje: mapMsg(msgRows[0]) };
}

async function listarConversaciones({ limit = 50, soloNoLeidos = false } = {}) {
	const lim = Math.min(100, Math.max(1, Number(limit) || 50));
	const filtro = soloNoLeidos ? 'AND NoLeidos > 0' : '';
	const rows = await executeQuery(
		`SELECT TOP ${lim} *
		 FROM dbo.imBotChat
		 WHERE Tipo = 'SESION' AND SesionActiva = 1 ${filtro}
		 ORDER BY FechaUltimoMensaje DESC, FechaRegistro DESC`,
	);
	return rows.map(mapSesion);
}

async function listarMensajes(idSesion, { limit = 100, desdeId = null } = {}) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 100));
	let filtro = '';
	const params = [{ value: idSesion, type: 'VarChar' }];
	if (desdeId) {
		filtro = 'AND IdRegistro > @p1';
		params.push({ value: Number(desdeId), type: 'Int' });
	}
	const rows = await executeQuery(
		`SELECT TOP ${lim} *
		 FROM dbo.imBotChat
		 WHERE Tipo = 'MSG' AND IdSesion = @p0 ${filtro}
		 ORDER BY FechaRegistro ASC, IdRegistro ASC`,
		params,
	);
	return rows.map(mapMsg);
}

async function marcarLeida(idSesion) {
	await executeQuery(
		`UPDATE dbo.imBotChat SET NoLeidos = 0 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		[{ value: idSesion, type: 'VarChar' }],
	);
	return obtenerSesion(idSesion);
}

async function actualizarSesion(idSesion, sets, params) {
	if (!sets.length) return obtenerSesion(idSesion);
	await executeQuery(
		`UPDATE dbo.imBotChat SET ${sets.join(', ')} WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		params,
	);
	return obtenerSesion(idSesion);
}

async function guardarContextoBot(idSesion, contextoBot) {
	const json = contextoBot != null ? JSON.stringify(contextoBot).slice(0, 8000) : null;
	await executeQuery(
		`UPDATE dbo.imBotChat SET ContextoBotJson = @p1 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		[
			{ value: idSesion, type: 'VarChar' },
			{ value: json, type: 'NVarChar' },
		],
	);
	return obtenerSesion(idSesion);
}

async function limpiarEstadoWizard(idSesion) {
	await executeQuery(
		`UPDATE dbo.imBotChat SET
		   PasoBot = 'inicio', IdPaciente = NULL, DniPaciente = NULL,
		   NoLeidos = 0, UltimoMensaje = NULL, ContextoBotJson = NULL
		 WHERE Tipo = 'SESION' AND IdSesion = @p0`,
		[{ value: idSesion, type: 'VarChar' }],
	);
	return true;
}

async function contarMensajesNoLeidos() {
	const rows = await executeQuery(
		`SELECT ISNULL(SUM(NoLeidos), 0) AS total FROM dbo.imBotChat WHERE Tipo = 'SESION' AND SesionActiva = 1`,
	);
	return Number(rows?.[0]?.total ?? 0);
}

async function resetConversacionPorTelefono(idSesion) {
	const countRows = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imBotChat WHERE IdSesion = @p0 AND Tipo IN ('MSG','LOG')`,
		[{ value: idSesion, type: 'VarChar' }],
	);
	const mensajesEliminados = Number(countRows?.[0]?.n || 0);
	await executeQuery(`DELETE FROM dbo.imBotChat WHERE IdSesion = @p0`, [
		{ value: idSesion, type: 'VarChar' },
	]);
	return { idConversacion: idSesion, mensajesEliminados, conversacionesEliminadas: 1 };
}

async function resetTodasLasConversaciones() {
	const msgCount = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imBotChat WHERE Tipo IN ('MSG','LOG','SESION')`,
	);
	const total = Number(msgCount?.[0]?.n || 0);
	await executeQuery(`DELETE FROM dbo.imBotChat WHERE Tipo IN ('MSG','LOG','SESION')`);
	return { mensajesEliminados: total, conversacionesEliminadas: 0 };
}

module.exports = {
	tableExists,
	mapSesion,
	mapMsg,
	obtenerSesion,
	obtenerOCrearConversacion,
	existeMensajePorMetaId,
	yaRespondidoAlMensaje,
	registrarMensajeEntrante,
	registrarMensajeSaliente,
	listarConversaciones,
	listarMensajes,
	marcarLeida,
	actualizarSesion,
	guardarContextoBot,
	limpiarEstadoWizard,
	contarMensajesNoLeidos,
	resetConversacionPorTelefono,
	resetTodasLasConversaciones,
};
