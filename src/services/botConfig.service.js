const { executeQuery } = require('../models/db');

let configTableExists = null;

async function checkConfigTable() {
	if (configTableExists !== null) return configTableExists;
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 1 AS ok FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotConfig'`,
		);
		configTableExists = rows.length > 0;
	} catch {
		configTableExists = false;
	}
	return configTableExists;
}

async function getDbConfigMap() {
	const hasTable = await checkConfigTable();
	if (!hasTable) return {};
	try {
		const rows = await executeQuery(
			`SELECT Clave, Valor, Tipo FROM dbo.imBotConfig WHERE Activo = 1`,
		);
		const map = {};
		for (const r of rows) {
			const key = String(r.Clave || '').trim();
			if (!key) continue;
			const tipo = String(r.Tipo || 'string').toLowerCase();
			let val = r.Valor;
			if (tipo === 'int') val = Number(val);
			else if (tipo === 'bool') val = val === '1' || val === 'true' || val === true;
			else if (tipo === 'json') {
				try {
					val = JSON.parse(val);
				} catch {
					val = r.Valor;
				}
			}
			map[key] = val;
		}
		return map;
	} catch {
		return {};
	}
}

function envInt(name, fallback) {
	const v = Number(process.env[name]);
	return Number.isFinite(v) ? v : fallback;
}

function envBool(name, fallback) {
	const raw = process.env[name];
	if (raw == null || raw === '') return fallback;
	return raw === '1' || String(raw).toLowerCase() === 'true';
}

/** Env explícito gana sobre DB; default true (un turno sugerido, no lista de profesionales). */
function resolveSugerirPrimerTurno(db) {
	const raw = process.env.BOT_SUGERIR_PRIMER_TURNO;
	if (raw != null && raw !== '') {
		return envBool('BOT_SUGERIR_PRIMER_TURNO', true);
	}
	if (db.sugerir_primer_turno_disponible != null) {
		return !!db.sugerir_primer_turno_disponible;
	}
	return true;
}

/**
 * Configuración efectiva del bot (env + overrides en imBotConfig si existe).
 */
async function getBotConfig() {
	const db = await getDbConfigMap();
	return {
		nombreInstitucion:
			db.nombre_institucion || db.nombreInstitucion || process.env.BOT_NOMBRE_INSTITUCION || 'iMedic',
		mensajes: {
			bienvenida:
				db.mensaje_bienvenida ||
				process.env.BOT_MENSAJE_BIENVENIDA ||
				'Hola, soy el asistente de turnos. Para comenzar, indicá tu DNI (sin puntos).',
			confirmacion:
				db.mensaje_confirmacion ||
				process.env.BOT_MENSAJE_CONFIRMACION ||
				'Tu turno quedó confirmado para el {fecha} a las {hora} con {medico}.',
			pedirDni:
				db.mensaje_pedir_dni ||
				process.env.BOT_MENSAJE_PEDIR_DNI ||
				'Para continuar, decime tu número de DNI (sin puntos).',
		},
		promptSistema:
			db.prompt_sistema ||
			process.env.BOT_PROMPT_SISTEMA ||
			'Sos un asistente amable de turnos médicos. Guiá al paciente paso a paso para reservar un turno. Sé breve y claro.',
		reglas: {
			anticipacionMinHoras: db.anticipacion_min_horas ?? envInt('BOT_ANTICIPACION_MIN_HORAS', 2),
			diasMaxAntelacion: db.dias_max_antelacion ?? envInt('BOT_DIAS_MAX_ANTELACION', 60),
			maxTurnosPorPacienteDia: db.max_turnos_por_paciente_dia ?? envInt('BOT_MAX_TURNOS_POR_PACIENTE_DIA', 1),
			requiereDNI: db.requiere_dni ?? envBool('BOT_REQUIERE_DNI', true),
			requiereRenaper: db.requiere_renaper ?? envBool('BOT_REQUIERE_RENAPER', true),
			permiteSobreturno: db.permite_sobreturno ?? envBool('BOT_PERMITE_SOBRETURNO', false),
			crearPacienteAutomatico: db.crear_paciente_automatico ?? envBool('BOT_CREAR_PACIENTE_AUTO', true),
			sugerirPrimerTurnoDisponible: resolveSugerirPrimerTurno(db),
		},
		api: {
			basePath: '/api/integrations/bot',
			authHeaders: ['X-API-Key', 'X-Empresa-Id'],
		},
	};
}

async function getServiciosCatalogo() {
	try {
		const rows = await executeQuery(
			`SELECT TOP 50 Valor, Descripcion FROM dbo.imServicios ORDER BY Descripcion`,
		);
		return rows.map((r) => ({
			codigo: r.Valor ? String(r.Valor).trim() : '',
			nombre: r.Descripcion ? String(r.Descripcion).trim() : '',
		}));
	} catch {
		return [];
	}
}

function defaultFlujoPasos() {
	return [
		{
			paso: 1,
			id: 'IDENTIFICAR',
			titulo: 'Identificación',
			mensajeUsuario: 'Para comenzar, indicá tu DNI (sin puntos).',
			descripcion: 'Validación RENAPER y ficha local del paciente',
			activo: true,
		},
		{
			paso: 2,
			id: 'CONFIRMAR_IDENTIDAD',
			titulo: 'Confirmar identidad',
			mensajeUsuario: '¿Confirmás que sos esta persona? Respondé Sí o No.',
			descripcion: 'Muestra datos RENAPER y espera confirmación antes de continuar',
			activo: true,
		},
		{
			paso: 3,
			id: 'ELEGIR_ESPECIALIDAD',
			titulo: 'Especialidad',
			mensajeUsuario: '¿Qué especialidad necesitás? Te muestro las disponibles.',
			descripcion: 'Listado de especialidades con agenda',
			activo: true,
		},
		{
			paso: 4,
			id: 'ELEGIR_PROFESIONAL',
			titulo: 'Profesional',
			mensajeUsuario: 'Elegí el profesional de la especialidad seleccionada.',
			descripcion: 'Profesionales con turnos disponibles',
			activo: true,
		},
		{
			paso: 5,
			id: 'ELEGIR_FECHA_HORA',
			titulo: 'Fecha y hora',
			mensajeUsuario: 'Indicá la fecha y te muestro los horarios libres.',
			descripcion: 'Disponibilidad del profesional',
			activo: true,
		},
		{
			paso: 6,
			id: 'CONFIRMAR',
			titulo: 'Confirmación',
			mensajeUsuario: '¿Confirmás este turno? Te envío el comprobante.',
			descripcion: 'Reserva y ticket WhatsApp',
			activo: true,
		},
	];
}

async function getFlujoPasos() {
	const db = await getDbConfigMap();
	if (Array.isArray(db.flujo_pasos) && db.flujo_pasos.length) {
		return db.flujo_pasos.map((p, i) => ({
			paso: p.paso ?? i + 1,
			id: p.id || `PASO_${i + 1}`,
			titulo: p.titulo || p.id || `Paso ${i + 1}`,
			mensajeUsuario: p.mensajeUsuario || '',
			descripcion: p.descripcion || '',
			activo: p.activo !== false,
		}));
	}
	return defaultFlujoPasos();
}

async function upsertConfigClave(clave, valor, tipo = 'string') {
	const hasTable = await checkConfigTable();
	if (!hasTable) {
		const err = new Error(
			'Tabla imBotConfig no disponible. Ejecutá scripts/sql/create_bot_tables.sql',
		);
		err.statusCode = 503;
		throw err;
	}
	const valStr =
		tipo === 'json' ? JSON.stringify(valor) : valor == null ? '' : String(valor);
	await executeQuery(
		`UPDATE dbo.imBotConfig SET Activo = 0 WHERE Clave = @p0 AND Activo = 1;
		 INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo, Activo)
		 VALUES (@p0, @p1, @p2, 1);`,
		[
			{ value: clave, type: 'VarChar' },
			{ value: valStr, type: 'NVarChar' },
			{ value: tipo, type: 'VarChar' },
		],
	);
}

/**
 * Persiste configuración editable del bot en imBotConfig.
 */
async function saveBotConfig(payload = {}) {
	const {
		nombreInstitucion,
		promptSistema,
		mensajes = {},
		reglas = {},
		flujo = [],
	} = payload;

	if (nombreInstitucion != null) {
		await upsertConfigClave('nombre_institucion', nombreInstitucion, 'string');
	}
	if (promptSistema != null) {
		await upsertConfigClave('prompt_sistema', promptSistema, 'string');
	}
	if (mensajes.bienvenida != null) {
		await upsertConfigClave('mensaje_bienvenida', mensajes.bienvenida, 'string');
	}
	if (mensajes.pedirDni != null) {
		await upsertConfigClave('mensaje_pedir_dni', mensajes.pedirDni, 'string');
	}
	if (mensajes.confirmacion != null) {
		await upsertConfigClave('mensaje_confirmacion', mensajes.confirmacion, 'string');
	}
	if (reglas.anticipacionMinHoras != null) {
		await upsertConfigClave('anticipacion_min_horas', reglas.anticipacionMinHoras, 'int');
	}
	if (reglas.diasMaxAntelacion != null) {
		await upsertConfigClave('dias_max_antelacion', reglas.diasMaxAntelacion, 'int');
	}
	if (reglas.maxTurnosPorPacienteDia != null) {
		await upsertConfigClave('max_turnos_por_paciente_dia', reglas.maxTurnosPorPacienteDia, 'int');
	}
	if (reglas.requiereRenaper != null) {
		await upsertConfigClave('requiere_renaper', reglas.requiereRenaper ? 'true' : 'false', 'bool');
	}
	if (reglas.crearPacienteAutomatico != null) {
		await upsertConfigClave(
			'crear_paciente_automatico',
			reglas.crearPacienteAutomatico ? 'true' : 'false',
			'bool',
		);
	}
	if (reglas.permiteSobreturno != null) {
		await upsertConfigClave(
			'permite_sobreturno',
			reglas.permiteSobreturno ? 'true' : 'false',
			'bool',
		);
	}
	if (reglas.sugerirPrimerTurnoDisponible != null) {
		await upsertConfigClave(
			'sugerir_primer_turno_disponible',
			reglas.sugerirPrimerTurnoDisponible ? 'true' : 'false',
			'bool',
		);
	}
	if (Array.isArray(flujo) && flujo.length) {
		await upsertConfigClave('flujo_pasos', flujo, 'json');
	}
	configTableExists = null;
	return getBotConfig();
}

module.exports = {
	getBotConfig,
	getServiciosCatalogo,
	getDbConfigMap,
	checkConfigTable,
	getFlujoPasos,
	defaultFlujoPasos,
	saveBotConfig,
	upsertConfigClave,
};
