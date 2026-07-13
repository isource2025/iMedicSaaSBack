const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const { runWithTenant } = require('../context/tenantContext');
const tokenIndex = require('./turneroTokenIndex.service');
const turneroEvents = require('./turneroEvents.service');
const empresaService = require('./empresa.service');
const { convertirHoraClarionAString, convertirFechaAClarion, diaSemanaAgendaArgentina, fechaCalendarioArgentina, formatHoraArgentina, horaWallArgentina } = require('../utils/dateUtils');

const STATUS_CANCELADO = 1;
const STATUS_ATENDIDO = 2;

const DEFAULT_CONFIG = {
	plantilla: 'clasica',
	colores: {
		fondo: '#0f172a',
		texto: '#f1f5f9',
		destacado: '#fbbf24',
		acento: '#38bdf8',
		primario: '#10b981',
		autoTarjetas: true,
	},
	tipografia: {
		familia: 'system-ui, Segoe UI, sans-serif',
		escala: 1,
	},
	audio: {
		sonidoActivo: true,
		sonidoUrl: '',
		vozActiva: true,
		vozTexto: 'Turno de {paciente}, consultorio {consultorio}',
		vozLang: 'es-AR',
		vozRate: 0.95,
		pausaEntreLlamadosMs: 1500,
	},
	video: {
		activo: false,
		fuente: 'youtube',
		url: '',
		posicion: 'izquierda',
		proporcion: 40,
		conSonido: true,
		atenuarAlLlamar: true,
		volumenDuranteLlamado: 0.05,
		loop: true,
	},
	display: {
		tituloInstitucion: true,
		maxLlamadosLista: 8,
		mostrarHora: true,
		mostrarConsultorio: true,
		mostrarProfesional: true,
		mostrarMedicosHoy: true,
		mantenerPantallaEncendida: true,
		autoFullscreen: false,
		modoKiosk: false,
		sectoresFiltrados: [],
	},
};

let tablesChecked = false;

function _hhmm(horaClarion) {
	return _hhmmClarion(horaClarion);
}

function _hhmmClarion(val) {
	const s = convertirHoraClarionAString(val);
	return s ? s.slice(0, 5) : null;
}

function _diaAgendaHoy() {
	return diaSemanaAgendaArgentina();
}

function _isoHoy() {
	return fechaCalendarioArgentina();
}

/** Matrículas con ausencia de día completo hoy (imPersonalNoHorarios). */
async function _matriculasAusentesHoy() {
	try {
		const clarionHoy = convertirFechaAClarion(_isoHoy());
		const rows = await executeQuery(
			`SELECT DISTINCT Matricula
       FROM dbo.imPersonalNoHorarios
       WHERE DesdeFecha <= @p0 AND HastaFecha >= @p0`,
			[{ value: clarionHoy, type: 'Int' }],
		);
		return new Set(rows.map((r) => Number(r.Matricula)).filter((m) => m > 0));
	} catch {
		return new Set();
	}
}

/** Profesionales con horario configurado para el día de hoy. */
async function listarMedicosAtiendenHoy() {
	const dia = _diaAgendaHoy();
	const ausentes = await _matriculasAusentesHoy();
	const rows = await executeQuery(
		`SELECT h.Matricula, p.ApellidoNombre, h.HoraDesde, h.HoraHasta, h.IDConsultorio
     FROM dbo.imPersonalHorarios h
     INNER JOIN dbo.imPersonal p ON p.Matricula = h.Matricula
     WHERE LTRIM(RTRIM(h.Dia)) = @p0
       AND NULLIF(LTRIM(RTRIM(p.ApellidoNombre)), '') IS NOT NULL
     ORDER BY p.ApellidoNombre, h.HoraDesde`,
		[{ value: dia, type: 'NVarChar' }],
	);

	const map = new Map();
	for (const r of rows) {
		const mat = Number(r.Matricula);
		if (ausentes.has(mat)) continue;
		if (!map.has(mat)) {
			map.set(mat, {
				matricula: mat,
				nombre: String(r.ApellidoNombre).trim(),
				consultorio: r.IDConsultorio ? String(r.IDConsultorio).trim() : '',
				rangos: [],
			});
		}
		const entry = map.get(mat);
		const inicio = _hhmmClarion(r.HoraDesde);
		const fin = _hhmmClarion(r.HoraHasta);
		if (inicio && fin) entry.rangos.push({ inicio, fin });
		if (!entry.consultorio && r.IDConsultorio) {
			entry.consultorio = String(r.IDConsultorio).trim();
		}
	}

	return [...map.values()]
		.map((m) => ({
			matricula: m.matricula,
			nombre: m.nombre,
			consultorio: m.consultorio,
			horarioTexto: m.rangos.map((rg) => `${rg.inicio} – ${rg.fin}`).join(', '),
		}))
		.filter((m) => m.horarioTexto)
		.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function mergeConfig(raw) {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
	return {
		...DEFAULT_CONFIG,
		...raw,
		colores: {
			...DEFAULT_CONFIG.colores,
			...(raw.colores || {}),
			autoTarjetas: raw.colores?.autoTarjetas !== false,
		},
		tipografia: { ...DEFAULT_CONFIG.tipografia, ...(raw.tipografia || {}) },
		audio: { ...DEFAULT_CONFIG.audio, ...(raw.audio || {}) },
		video: {
			...DEFAULT_CONFIG.video,
			...(raw.video || {}),
			conSonido: raw.video?.conSonido !== false,
			atenuarAlLlamar:
				raw.video?.silenciarConVoz === true ? true : raw.video?.atenuarAlLlamar !== false,
			volumenDuranteLlamado:
				raw.video?.silenciarConVoz === true
					? 0
					: (() => {
							const v = Number(raw.video?.volumenDuranteLlamado);
							if (!Number.isFinite(v) || v === 0.1) return 0.05;
							return Math.max(0, Math.min(1, v));
						})(),
			loop: raw.video?.loop !== false,
		},
		display: {
			...DEFAULT_CONFIG.display,
			...(raw.display || {}),
			sectoresFiltrados: Array.isArray(raw.display?.sectoresFiltrados)
				? raw.display.sectoresFiltrados
				: [],
		},
	};
}

function parseConfigJson(str) {
	if (!str) return { ...DEFAULT_CONFIG };
	try {
		return mergeConfig(JSON.parse(str));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

async function ensureTables() {
	if (tablesChecked) return true;
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 1 AS ok FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imTurneroPantalla'`,
		);
		tablesChecked = rows.length > 0;
	} catch {
		tablesChecked = false;
	}
	return tablesChecked;
}

function _schemaMissingError() {
	const e = new Error(
		'Tablas de turnero no instaladas. Ejecutá scripts/sql/setup_turnero.sql en la base del tenant.',
	);
	e.statusCode = 503;
	e.code = 'TURNERO_SCHEMA_MISSING';
	return e;
}

async function _requireTables() {
	const has = await ensureTables();
	if (!has) throw _schemaMissingError();
	return true;
}

async function _listarPantallasActivasRows() {
	await _requireTables();
	return executeQuery(
		`SELECT IdPantalla, Nombre, PublicToken, ConfigJson, Activa
     FROM dbo.imTurneroPantalla
     WHERE Activa = 1
     ORDER BY IdPantalla ASC`,
	);
}

async function _getPantallaRowById(idPantalla) {
	await _requireTables();
	const id = Number(idPantalla);
	if (!Number.isFinite(id) || id <= 0) return null;
	const rows = await executeQuery(
		`SELECT TOP 1 IdPantalla, Nombre, PublicToken, ConfigJson, Activa
     FROM dbo.imTurneroPantalla
     WHERE IdPantalla = @p0 AND Activa = 1`,
		[{ value: id, type: 'Int' }],
	);
	return rows[0] || null;
}

async function _getPantallaPrincipalRow() {
	const rows = await _listarPantallasActivasRows();
	return rows[0] || null;
}

function _rowToAdminState(row) {
	const config = parseConfigJson(row.ConfigJson);
	return {
		idPantalla: row.IdPantalla,
		nombre: String(row.Nombre || 'Pantalla general').trim(),
		publicToken: String(row.PublicToken || '').trim(),
		config,
		activa: !!row.Activa,
	};
}

async function _syncTokenIndex(row) {
	const idEmpresa = getTenantId();
	const token = String(row.PublicToken || '').trim();
	if (idEmpresa && token) await tokenIndex.upsertToken(token, idEmpresa);
}

async function getOrCreatePantallaPrincipal() {
	let row = await _getPantallaPrincipalRow();
	if (row) return row;

	const token = tokenIndex.newToken();
	const configJson = JSON.stringify(DEFAULT_CONFIG);
	await executeQuery(
		`INSERT INTO dbo.imTurneroPantalla (Nombre, PublicToken, ConfigJson, Activa)
     VALUES (@p0, @p1, @p2, 1)`,
		[
			{ value: 'Pantalla general', type: 'NVarChar' },
			{ value: token, type: 'NVarChar' },
			{ value: configJson, type: 'NVarChar' },
		],
	);

	const idEmpresa = getTenantId();
	if (idEmpresa) await tokenIndex.upsertToken(token, idEmpresa);

	row = await _getPantallaPrincipalRow();
	return row;
}

async function listarPantallas() {
	let rows = await _listarPantallasActivasRows();
	if (!rows.length) {
		await getOrCreatePantallaPrincipal();
		rows = await _listarPantallasActivasRows();
	}
	return rows.map((row) => {
		const cfg = parseConfigJson(row.ConfigJson);
		const sectores = cfg.display?.sectoresFiltrados || [];
		return {
			idPantalla: row.IdPantalla,
			nombre: String(row.Nombre || 'Pantalla').trim(),
			publicToken: String(row.PublicToken || '').trim(),
			sectoresResumen: sectores.length ? sectores.join(', ') : 'Todos los sectores',
			activa: !!row.Activa,
		};
	});
}

async function getAdminState(idPantalla) {
	let row = null;
	if (idPantalla != null && idPantalla !== '') {
		row = await _getPantallaRowById(idPantalla);
		if (!row) {
			const e = new Error('Pantalla no encontrada');
			e.statusCode = 404;
			throw e;
		}
	} else {
		row = await getOrCreatePantallaPrincipal();
	}
	await _syncTokenIndex(row);
	return _rowToAdminState(row);
}

async function crearPantalla({ nombre, sectoresFiltrados, copiarDesdeIdPantalla }) {
	await _requireTables();
	const nombreSafe = String(nombre || 'Nueva pantalla').trim().slice(0, 100) || 'Nueva pantalla';
	let config = mergeConfig(DEFAULT_CONFIG);

	const copiarId = Number(copiarDesdeIdPantalla);
	if (Number.isFinite(copiarId) && copiarId > 0) {
		const src = await _getPantallaRowById(copiarId);
		if (!src) {
			const e = new Error('Pantalla origen no encontrada');
			e.statusCode = 404;
			throw e;
		}
		config = mergeConfig(parseConfigJson(src.ConfigJson));
		config.display.sectoresFiltrados = [];
	}

	if (Array.isArray(sectoresFiltrados) && sectoresFiltrados.length) {
		config.display.sectoresFiltrados = sectoresFiltrados
			.map((s) => String(s || '').trim())
			.filter(Boolean);
	}
	const token = tokenIndex.newToken();
	const inserted = await executeQuery(
		`INSERT INTO dbo.imTurneroPantalla (Nombre, PublicToken, ConfigJson, Activa)
     OUTPUT INSERTED.IdPantalla
     VALUES (@p0, @p1, @p2, 1)`,
		[
			{ value: nombreSafe, type: 'NVarChar' },
			{ value: token, type: 'NVarChar' },
			{ value: JSON.stringify(config), type: 'NVarChar' },
		],
	);
	const idPantalla = inserted[0]?.IdPantalla;
	const row = await _getPantallaRowById(idPantalla);
	await _syncTokenIndex(row);
	return _rowToAdminState(row);
}

async function desactivarPantalla(idPantalla) {
	await _requireTables();
	const row = await _getPantallaRowById(idPantalla);
	if (!row) {
		const e = new Error('Pantalla no encontrada');
		e.statusCode = 404;
		throw e;
	}
	const activas = await _listarPantallasActivasRows();
	if (activas.length <= 1) {
		const e = new Error('Debe quedar al menos una pantalla activa');
		e.statusCode = 409;
		throw e;
	}
	const oldToken = String(row.PublicToken || '').trim();
	await executeQuery(
		`UPDATE dbo.imTurneroPantalla
     SET Activa = 0, FechaModificacion = GETDATE()
     WHERE IdPantalla = @p0`,
		[{ value: row.IdPantalla, type: 'Int' }],
	);
	await tokenIndex.removeToken(oldToken);
	return { ok: true, idPantalla: row.IdPantalla };
}

async function saveAdminConfig({ idPantalla, nombre, config }) {
	let row = null;
	if (idPantalla != null && idPantalla !== '') {
		row = await _getPantallaRowById(idPantalla);
		if (!row) {
			const e = new Error('Pantalla no encontrada');
			e.statusCode = 404;
			throw e;
		}
	} else {
		row = await getOrCreatePantallaPrincipal();
	}
	const merged = mergeConfig(config);
	const nombreSafe = String(nombre || row.Nombre || 'Pantalla general').trim().slice(0, 100);
	await executeQuery(
		`UPDATE dbo.imTurneroPantalla
     SET Nombre = @p0, ConfigJson = @p1, FechaModificacion = GETDATE()
     WHERE IdPantalla = @p2`,
		[
			{ value: nombreSafe, type: 'NVarChar' },
			{ value: JSON.stringify(merged), type: 'NVarChar' },
			{ value: row.IdPantalla, type: 'Int' },
		],
	);

	const token = String(row.PublicToken || '').trim();
	turneroEvents.publishConfig(token, merged);
	return getAdminState(row.IdPantalla);
}

async function regenerarToken(idPantalla) {
	let row = null;
	if (idPantalla != null && idPantalla !== '') {
		row = await _getPantallaRowById(idPantalla);
		if (!row) {
			const e = new Error('Pantalla no encontrada');
			e.statusCode = 404;
			throw e;
		}
	} else {
		row = await getOrCreatePantallaPrincipal();
	}
	const oldToken = String(row.PublicToken || '').trim();
	const newTok = tokenIndex.newToken();
	await executeQuery(
		`UPDATE dbo.imTurneroPantalla
     SET PublicToken = @p0, FechaModificacion = GETDATE()
     WHERE IdPantalla = @p1`,
		[
			{ value: newTok, type: 'NVarChar' },
			{ value: row.IdPantalla, type: 'Int' },
		],
	);

	await tokenIndex.removeToken(oldToken);
	await _syncTokenIndex({ ...row, PublicToken: newTok });

	return getAdminState(row.IdPantalla);
}

function _sectorVisible(sector, config) {
	const filtros = config?.display?.sectoresFiltrados;
	if (!Array.isArray(filtros) || filtros.length === 0) return true;
	const s = String(sector || '').trim();
	return filtros.some((f) => String(f || '').trim() === s);
}

function _filtrarLlamadosPorSector(llamados, config) {
	return llamados.filter((l) => _sectorVisible(l.sector, config));
}

function _mapLlamadoRow(r) {
	const llamadoEnRaw = r.LlamadoEn || null;
	return {
		idLlamado: r.IdLlamado,
		idTurno: r.IdTurno,
		paciente: r.Paciente ? String(r.Paciente).trim() : '',
		consultorio: r.Consultorio ? String(r.Consultorio).trim() : '',
		profesional: r.Profesional ? String(r.Profesional).trim() : '',
		sector: r.Sector ? String(r.Sector).trim() : '',
		horaTurno: r.HoraTurno ? String(r.HoraTurno).trim() : null,
		llamadoEn: llamadoEnRaw
			? String(llamadoEnRaw instanceof Date ? llamadoEnRaw.toISOString() : llamadoEnRaw)
			: null,
		llamadoEnHora: llamadoEnRaw ? formatHoraArgentina(llamadoEnRaw) : null,
	};
}

async function listarLlamadosDelDia(idPantalla, limit = 20) {
	const has = await ensureTables();
	if (!has) return [];
	const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
	const rows = await executeQuery(
		`SELECT TOP (${lim})
       IdLlamado, IdTurno, Paciente, Consultorio, Profesional, Sector, HoraTurno, LlamadoEn
     FROM dbo.imTurneroLlamado
     WHERE CAST(LlamadoEn AS DATE) = CAST(GETDATE() AS DATE)
       AND (IdPantalla IS NULL OR IdPantalla = @p0)
     ORDER BY LlamadoEn DESC, IdLlamado DESC`,
		[{ value: idPantalla, type: 'Int' }],
	);
	return rows.map(_mapLlamadoRow);
}

async function getDisplayUrl() {
	const pantallas = await listarPantallas();
	const principal = pantallas[0] || null;
	const token = principal ? String(principal.publicToken || '').trim() : '';
	return {
		displayPath: token ? `/display/${token}` : '',
		publicToken: token,
		nombre: principal ? String(principal.nombre || 'Pantalla general').trim() : 'Pantalla general',
		pantallas: pantallas.map((p) => ({
			idPantalla: p.idPantalla,
			nombre: p.nombre,
			displayPath: `/display/${p.publicToken}`,
			publicToken: p.publicToken,
			sectoresResumen: p.sectoresResumen,
		})),
	};
}

async function _obtenerTurnoParaLlamado(idTurno) {
	const rows = await executeQuery(
		`SELECT TOP 1
       t.IdTurno, t.Profesional, t.Sector, t.HoraAsignada, t.Horallegada, t.HoraIngreso,
       t.HoraSalida, t.Status, t.IDPaciente,
       pac.ApellidoyNombre AS PacienteNombre,
       per.ApellidoNombre AS ProfesionalNombre
     FROM dbo.imTurnos t
     LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = t.IDPaciente
     LEFT JOIN dbo.imPersonal per ON per.Matricula = t.Profesional
     WHERE t.IdTurno = @p0`,
		[{ value: idTurno, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}
	return rows[0];
}

async function _consultorioProfesional(matricula) {
	const rows = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(IDConsultorio)) AS Consultorio
     FROM dbo.imPersonalHorarios
     WHERE Matricula = @p0 AND IDConsultorio IS NOT NULL AND RTRIM(IDConsultorio) <> ''
     ORDER BY Dia`,
		[{ value: matricula, type: 'Int' }],
	);
	return rows[0]?.Consultorio ? String(rows[0].Consultorio).trim() : '';
}

async function registrarLlamado({ matricula, idTurno, porIdTurno }) {
	await ensureTables();
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}

	const row = await _obtenerTurnoParaLlamado(id);
	const st = row.Status != null ? Number(row.Status) : 0;
	const idP = Number(row.IDPaciente) || 0;
	if (idP <= 0) {
		const e = new Error('No hay paciente asignado en este turno');
		e.statusCode = 409;
		throw e;
	}
	if (st === STATUS_CANCELADO) {
		const e = new Error('El turno está cancelado');
		e.statusCode = 409;
		throw e;
	}
	const hs = Number(row.HoraSalida) || 0;
	if (st === STATUS_ATENDIDO || hs > 0) {
		const e = new Error('El turno ya fue cerrado');
		e.statusCode = 409;
		throw e;
	}
	const hl = Number(row.Horallegada) || 0;
	if (hl <= 0) {
		const e = new Error('Primero debe marcarse la llegada del paciente');
		e.statusCode = 409;
		throw e;
	}

	if (!porIdTurno) {
		const mat = Number(matricula);
		const prof = Number(row.Profesional);
		if (!Number.isFinite(mat) || mat !== prof) {
			const e = new Error('El turno no pertenece al profesional indicado');
			e.statusCode = 403;
			throw e;
		}
	}

	const pantallas = await _listarPantallasActivasRows();
	if (!pantallas.length) await getOrCreatePantallaPrincipal();
	const pantallasActivas = pantallas.length ? pantallas : [await getOrCreatePantallaPrincipal()];

	const consultorio = await _consultorioProfesional(Number(row.Profesional));
	const paciente = row.PacienteNombre ? String(row.PacienteNombre).trim() : 'Paciente';
	const profesional = row.ProfesionalNombre
		? String(row.ProfesionalNombre).trim()
		: `Mat. ${row.Profesional}`;
	const horaTurno = _hhmm(row.HoraAsignada);

	const inserted = await executeQuery(
		`INSERT INTO dbo.imTurneroLlamado
       (IdTurno, IdPantalla, Paciente, Consultorio, Profesional, Sector, HoraTurno)
     OUTPUT INSERTED.IdLlamado, INSERTED.LlamadoEn
     VALUES (@p0, NULL, @p1, @p2, @p3, @p4, @p5)`,
		[
			{ value: id, type: 'Int' },
			{ value: paciente, type: 'NVarChar' },
			{ value: consultorio || null, type: 'NVarChar' },
			{ value: profesional, type: 'NVarChar' },
			{ value: String(row.Sector || '').trim() || null, type: 'NVarChar' },
			{ value: horaTurno, type: 'NVarChar' },
		],
	);

	const llamado = {
		idLlamado: inserted[0].IdLlamado,
		idTurno: id,
		paciente,
		consultorio,
		profesional,
		sector: String(row.Sector || '').trim(),
		horaTurno,
		llamadoEn: inserted[0].LlamadoEn
			? String(
					inserted[0].LlamadoEn instanceof Date
						? inserted[0].LlamadoEn.toISOString()
						: inserted[0].LlamadoEn,
				)
			: null,
		llamadoEnHora: inserted[0].LlamadoEn
			? formatHoraArgentina(inserted[0].LlamadoEn)
			: horaWallArgentina(false),
	};

	const displayPaths = [];
	for (const pantalla of pantallasActivas) {
		const config = parseConfigJson(pantalla.ConfigJson);
		if (_sectorVisible(llamado.sector, config)) {
			const token = String(pantalla.PublicToken || '').trim();
			turneroEvents.publishLlamado(token, llamado);
			displayPaths.push(`/display/${token}`);
		}
	}

	return {
		...llamado,
		displayPath: displayPaths[0] || null,
		displayPaths,
		publicadoEnPantalla: displayPaths.length > 0,
		pantallasPublicadas: displayPaths.length,
	};
}

async function obtenerDisplayPorToken(publicToken) {
	const token = String(publicToken || '').trim();
	if (!token) {
		const e = new Error('Token inválido');
		e.statusCode = 400;
		throw e;
	}

	const idEmpresa = await tokenIndex.resolveEmpresaByToken(token);
	if (!idEmpresa) {
		const e = new Error('Pantalla no encontrada');
		e.statusCode = 404;
		throw e;
	}

	return runWithTenant(idEmpresa, async () => {
		const has = await ensureTables();
		if (!has) {
			const e = new Error('Pantalla no disponible');
			e.statusCode = 503;
			throw e;
		}

		const rows = await executeQuery(
			`SELECT TOP 1 IdPantalla, Nombre, PublicToken, ConfigJson, Activa
       FROM dbo.imTurneroPantalla
       WHERE PublicToken = @p0 AND Activa = 1`,
			[{ value: token, type: 'NVarChar' }],
		);
		if (!rows.length) {
			const e = new Error('Pantalla no encontrada');
			e.statusCode = 404;
			throw e;
		}

		const pantalla = rows[0];
		const config = parseConfigJson(pantalla.ConfigJson);
		const llamadosRaw = await listarLlamadosDelDia(
			pantalla.IdPantalla,
			config.display?.maxLlamadosLista || 8,
		);
		const llamados = _filtrarLlamadosPorSector(llamadosRaw, config);
		const medicosHoy =
			config.display?.mostrarMedicosHoy !== false ? await listarMedicosAtiendenHoy() : [];

		let empresa = null;
		try {
			empresa = await empresaService.obtenerInfoEmpresaPorId(idEmpresa);
		} catch {
			empresa = { descripcion: 'iMedic', razonSocial: 'iMedic' };
		}

		return {
			idPantalla: pantalla.IdPantalla,
			nombre: String(pantalla.Nombre || '').trim(),
			publicToken: token,
			config,
			empresa: {
				nombre: empresa?.descripcion || empresa?.razonSocial || 'iMedic',
			},
			ultimoLlamado: llamados[0] || null,
			llamados,
			medicosHoy,
		};
	});
}

module.exports = {
	DEFAULT_CONFIG,
	mergeConfig,
	listarPantallas,
	getAdminState,
	crearPantalla,
	desactivarPantalla,
	saveAdminConfig,
	regenerarToken,
	getDisplayUrl,
	registrarLlamado,
	obtenerDisplayPorToken,
	listarLlamadosDelDia,
	listarMedicosAtiendenHoy,
	getOrCreatePantallaPrincipal,
};
