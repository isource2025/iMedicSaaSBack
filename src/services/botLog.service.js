const { executeQuery } = require('../models/db');

let logTableExists = null;
let logUseBotChat = null;

async function checkLogTable() {
	if (logTableExists !== null) return logTableExists;
	try {
		const chat = await executeQuery(
			`SELECT TOP 1 1 AS ok FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotChat'`,
		);
		if (chat.length > 0) {
			logUseBotChat = true;
			logTableExists = true;
			return true;
		}
		const rows = await executeQuery(
			`SELECT TOP 1 1 AS ok FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotTurnosLog'`,
		);
		logUseBotChat = false;
		logTableExists = rows.length > 0;
	} catch {
		logTableExists = false;
	}
	return logTableExists;
}

/**
 * Registra acción del bot (no bloquea flujo si la tabla no existe).
 */
async function registrarLog({
	accion,
	idTurno = null,
	idPaciente = null,
	telefonoWhatsApp = null,
	idConversacion = null,
	payload = null,
	resultado = 'OK',
	mensajeError = null,
}) {
	const hasTable = await checkLogTable();
	if (!hasTable) return null;
	try {
		const payloadJson = payload != null ? JSON.stringify(payload).slice(0, 4000) : null;
		if (logUseBotChat) {
			const rows = await executeQuery(
				`INSERT INTO dbo.imBotChat
				   (Tipo, IdSesion, IdTurno, IdPaciente, AccionLog, TelefonoWhatsApp, PayloadJson, ResultadoLog, MensajeErrorLog)
				 VALUES ('LOG', @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7);
				 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdLog;`,
				[
					{ value: idConversacion || `log-${Date.now()}`, type: 'VarChar' },
					{ value: idTurno, type: 'Int' },
					{ value: idPaciente, type: 'Int' },
					{ value: String(accion || '').slice(0, 30), type: 'VarChar' },
					{ value: telefonoWhatsApp ? String(telefonoWhatsApp).slice(0, 20) : null, type: 'VarChar' },
					{ value: payloadJson, type: 'NVarChar' },
					{ value: String(resultado || 'OK').slice(0, 20), type: 'VarChar' },
					{ value: mensajeError ? String(mensajeError).slice(0, 500) : null, type: 'VarChar' },
				],
			);
			return rows?.[0]?.IdLog ?? null;
		}
		const rows = await executeQuery(
			`INSERT INTO dbo.imBotTurnosLog
			   (IdConversacion, IdTurno, IdPaciente, Accion, TelefonoWhatsApp, PayloadJson, Resultado, MensajeError)
			 VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7);
			 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdLog;`,
			[
				{ value: idConversacion, type: 'VarChar' },
				{ value: idTurno, type: 'Int' },
				{ value: idPaciente, type: 'Int' },
				{ value: String(accion || '').slice(0, 30), type: 'VarChar' },
				{ value: telefonoWhatsApp ? String(telefonoWhatsApp).slice(0, 20) : null, type: 'VarChar' },
				{ value: payloadJson, type: 'NVarChar' },
				{ value: String(resultado || 'OK').slice(0, 20), type: 'VarChar' },
				{ value: mensajeError ? String(mensajeError).slice(0, 500) : null, type: 'VarChar' },
			],
		);
		return rows?.[0]?.IdLog ?? null;
	} catch (err) {
		console.warn('[botLog] No se pudo registrar:', err.message);
		return null;
	}
}

async function listarLogsRecientes(limit = 50) {
	const hasTable = await checkLogTable();
	if (!hasTable) return { disponible: false, logs: [] };
	const lim = Math.min(200, Math.max(1, Number(limit) || 50));
	const rows = logUseBotChat
		? await executeQuery(
				`SELECT TOP ${lim}
				        IdRegistro AS IdLog, IdSesion AS IdConversacion, IdTurno, IdPaciente, AccionLog AS Accion,
				        TelefonoWhatsApp, ResultadoLog AS Resultado, MensajeErrorLog AS MensajeError, FechaRegistro AS FechaAccion
				 FROM dbo.imBotChat
				 WHERE Tipo = 'LOG'
				 ORDER BY FechaRegistro DESC, IdRegistro DESC`,
			)
		: await executeQuery(
				`SELECT TOP ${lim}
				        IdLog, IdConversacion, IdTurno, IdPaciente, Accion,
				        TelefonoWhatsApp, Resultado, MensajeError, FechaAccion
				 FROM dbo.imBotTurnosLog
				 ORDER BY FechaAccion DESC, IdLog DESC`,
			);
	return {
		disponible: true,
		logs: rows.map((r) => ({
			idLog: r.IdLog,
			idConversacion: r.IdConversacion,
			idTurno: r.IdTurno,
			idPaciente: r.IdPaciente,
			accion: r.Accion,
			telefonoWhatsApp: r.TelefonoWhatsApp,
			resultado: r.Resultado,
			mensajeError: r.MensajeError,
			fechaAccion: r.FechaAccion,
		})),
	};
}

module.exports = { registrarLog, listarLogsRecientes, checkLogTable };
