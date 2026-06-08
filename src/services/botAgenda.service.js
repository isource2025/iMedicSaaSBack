/**
 * Orquestación de turnos vía chatbot: RENAPER → paciente → disponibilidad → reserva.
 */
const renaperService = require('./renaper.service');
const patientsService = require('./patients.service');
const agendaService = require('./agenda.service');
const botConfigService = require('./botConfig.service');
const botLogService = require('./botLog.service');
const { STATUS_CANCELADO } = require('../utils/agendaCatalogos');
const { executeQuery } = require('../models/db');
const { convertirFechaAClarion } = require('../utils/dateUtils');

function _validarSexo(sexo) {
	const s = String(sexo || '')
		.trim()
		.toUpperCase();
	if (!/^(F|M|1|2)$/.test(s)) {
		const e = new Error('Parámetro sexo inválido. Usá M o F.');
		e.statusCode = 400;
		e.code = 'SEXO_INVALIDO';
		throw e;
	}
	return s;
}

function _validarDni(dni) {
	const n = Number(String(dni).trim());
	if (!Number.isFinite(n) || n <= 0) {
		const e = new Error('Número de documento inválido');
		e.statusCode = 400;
		e.code = 'DNI_INVALIDO';
		throw e;
	}
	return n;
}

function _sexoRenaperToLocal(sexoRenaper) {
	const s = String(sexoRenaper || '')
		.trim()
		.toUpperCase();
	if (s === 'F' || s === 'M') return s;
	return s === '1' ? 'F' : s === '2' ? 'M' : null;
}

function _nombreDesdeRenaper(persona) {
	const ap = String(persona?.apellido || persona?.Apellido || '').trim();
	const nom = String(
		persona?.nombres || persona?.Nombres || persona?.nombre || persona?.Nombre || '',
	).trim();
	if (ap && nom) return `${ap} ${nom}`.toUpperCase().slice(0, 40);
	if (ap) return ap.toUpperCase().slice(0, 40);
	if (nom) return nom.toUpperCase().slice(0, 40);
	return null;
}

function _domicilioDesdeRenaper(persona) {
	return `${persona?.calle || ''} ${persona?.numero || ''}`.trim().slice(0, 80) || null;
}

function _mapPacienteRow(row) {
	if (!row) return null;
	const fn = row.FechaNacimiento;
	let fechaNacimiento = null;
	if (fn instanceof Date && !Number.isNaN(fn.getTime())) {
		fechaNacimiento = fn.toISOString().slice(0, 10);
	} else if (fn) {
		const s = String(fn);
		fechaNacimiento = s.length >= 10 ? s.slice(0, 10) : s;
	}
	return {
		idPaciente: row.IDPaciente,
		nombre: row.ApellidoyNombre ? String(row.ApellidoyNombre).trim() : null,
		dni: row.NumeroDocumento != null ? Number(row.NumeroDocumento) : null,
		sexo: row.Sexo ? String(row.Sexo).trim() : null,
		fechaNacimiento,
		cobertura: row.Cobertura ? String(row.Cobertura).trim() : null,
		telefonoParticular: row.TelefonoParticular ? String(row.TelefonoParticular).trim() : null,
		telefonoCelular: row.TelefonoNegocio ? String(row.TelefonoNegocio).trim() : null,
		mail: row.Mail ? String(row.Mail).trim() : null,
	};
}

async function _buscarPacienteLocalPorDni(dni) {
	const rows = await patientsService.buscarPacientes(String(dni));
	const exact = rows.filter((r) => Number(r.NumeroDocumento) === dni);
	return exact[0] || rows[0] || null;
}

async function _actualizarTelefonoPaciente(idPaciente, telefono) {
	if (!telefono || !idPaciente) return;
	const tel = String(telefono).replace(/\D/g, '').slice(-15);
	if (!tel) return;
	try {
		await executeQuery(
			`UPDATE dbo.imPacientes SET TelefonoNegocio = @p0 WHERE IDPaciente = @p1`,
			[
				{ value: tel, type: 'VarChar' },
				{ value: idPaciente, type: 'Int' },
			],
		);
	} catch (err) {
		console.warn('[botAgenda] No se pudo actualizar teléfono:', err.message);
	}
}

function _renaperDataDesdePacienteLocal(pacienteLocal, dni) {
	return {
		numeroDocumento: dni,
		apellido: null,
		nombres: null,
		nombreCompleto: pacienteLocal?.nombre || null,
		fechaNacimiento: pacienteLocal?.fechaNacimiento || null,
		sexo: pacienteLocal?.sexo || null,
		domicilio: null,
		fuente: 'local',
	};
}

function _mapRenaperData(p, dni, sexoDetectado, renaperSigned) {
	return {
		numeroDocumento: p.numeroDocumento != null ? Number(p.numeroDocumento) : dni,
		apellido: String(p.apellido || p.Apellido || '').trim() || null,
		nombres: String(p.nombres || p.Nombres || p.nombre || p.Nombre || '').trim() || null,
		nombreCompleto: _nombreDesdeRenaper(p),
		fechaNacimiento: p.fechaNacimiento ? String(p.fechaNacimiento).slice(0, 10) : null,
		sexo: sexoDetectado,
		domicilio: _domicilioDesdeRenaper(p),
		ciudad: p.ciudad ? String(p.ciudad).trim() : null,
		provincia: p.provincia ? String(p.provincia).trim() : null,
		documentoFirmado: renaperSigned,
		fuente: 'renaper',
	};
}

async function identificarPaciente({
	numeroDocumento,
	sexo,
	telefonoWhatsApp,
	crearSiNoExiste,
	idConversacion,
	omitirAvancePaso = false,
}) {
	const config = await botConfigService.getBotConfig();
	const dni = _validarDni(numeroDocumento);
	const sexoHint = sexo ? _validarSexo(sexo) : null;

	let renaperData = null;
	let renaperOk = false;
	let renaperSigned = false;
	let sexoDetectado = null;
	let renaperError = null;

	const localRow = await _buscarPacienteLocalPorDni(dni);
	let pacienteLocal = localRow ? _mapPacienteRow(localRow) : null;

	if (config.reglas.requiereRenaper !== false) {
		const renaperOpts = { debug: false, timeoutMs: 15000 };
		try {
			const renaperResult = sexoHint
				? await renaperService.search(dni, sexoHint, renaperOpts)
				: await renaperService.searchByDni(dni, renaperOpts);

			if (renaperResult.ok && renaperResult.data) {
				renaperOk = true;
				renaperSigned = !!renaperResult.meta?.signed;
				sexoDetectado =
					renaperResult.sexoDetectado ||
					_sexoRenaperToLocal(renaperResult.data.sexo) ||
					(sexoHint ? _sexoRenaperToLocal(sexoHint) : null);
				renaperData = _mapRenaperData(
					renaperResult.data,
					dni,
					sexoDetectado,
					renaperSigned,
				);
			}
		} catch (err) {
			renaperError = err;
			console.warn('[botAgenda] RENAPER error:', err.message, err.code || '');
		}
	}

	if (!renaperOk && pacienteLocal) {
		renaperData = _renaperDataDesdePacienteLocal(pacienteLocal, dni);
		renaperOk = true;
		sexoDetectado = pacienteLocal.sexo || sexoDetectado;
	} else if (!renaperOk && config.reglas.requiereRenaper === true) {
		if (renaperError) {
			const e = new Error('Servicio RENAPER no disponible desde el servidor');
			e.statusCode = 503;
			e.code = renaperError.code === 'RENAPER_TIMEOUT' ? 'RENAPER_TIMEOUT' : 'RENAPER_UNAVAILABLE';
			throw e;
		}
		const e = new Error('No se encontraron datos en RENAPER');
		e.statusCode = 404;
		e.code = 'RENAPER_NO_ENCONTRADO';
		throw e;
	}

	let idPaciente = pacienteLocal?.idPaciente ?? null;
	let accionSugerida = 'CONFIRMAR_DATOS';
	let pacienteCreado = false;

	if (pacienteLocal) {
		accionSugerida = 'USAR_PACIENTE_EXISTENTE';
		if (telefonoWhatsApp) await _actualizarTelefonoPaciente(idPaciente, telefonoWhatsApp);
	} else if (renaperOk && (crearSiNoExiste || config.reglas.crearPacienteAutomatico)) {
		const nuevo = await patientsService.crearPaciente({
			ApellidoyNombre: renaperData.nombreCompleto || `PACIENTE ${dni}`,
			NumeroDocumento: dni,
			Sexo: renaperData.sexo || sexoDetectado,
			FechaNacimiento: renaperData.fechaNacimiento,
			Domicilio: renaperData.domicilio,
			TelefonoNegocio: telefonoWhatsApp ? String(telefonoWhatsApp).replace(/\D/g, '').slice(-15) : null,
		});
		pacienteLocal = _mapPacienteRow(nuevo);
		idPaciente = pacienteLocal?.idPaciente ?? null;
		pacienteCreado = true;
		accionSugerida = 'PACIENTE_CREADO';
	} else if (renaperOk) {
		accionSugerida = 'CREAR_PACIENTE';
	} else if (!pacienteLocal) {
		accionSugerida = 'DATOS_MANUALES';
	}

	await botLogService.registrarLog({
		accion: 'IDENTIFICAR',
		idPaciente,
		telefonoWhatsApp,
		idConversacion,
		payload: { dni, sexoDetectado, renaperOk, pacienteCreado },
		resultado: 'OK',
	});

	if ((idConversacion || telefonoWhatsApp) && !omitirAvancePaso) {
		try {
			const botConversacion = require('./botConversacion.service');
			const botConfigServiceLocal = require('./botConfig.service');
			const idConv =
				idConversacion ||
				(telefonoWhatsApp ? botConversacion.idDesdeTelefono(telefonoWhatsApp) : null);
			if (idConv) {
				const flujo = await botConfigServiceLocal.getFlujoPasos();
				const confirmarActivo = flujo.find((p) => p.id === 'CONFIRMAR_IDENTIDAD' && p.activo);
				const siguiente = confirmarActivo
					? 'CONFIRMAR_IDENTIDAD'
					: flujo.find((p) => p.id === 'ELEGIR_ESPECIALIDAD' && p.activo)?.id ||
						'ELEGIR_ESPECIALIDAD';
				await botConversacion.actualizarContextoPaciente(idConv, {
					idPaciente: confirmarActivo ? null : idPaciente,
					dniPaciente: String(dni),
					nombreContacto: pacienteLocal?.nombre || renaperData?.nombreCompleto || null,
					pasoBot: siguiente,
				});
			}
		} catch (e) {
			console.warn('[botAgenda] contexto conversación:', e.message);
		}
	} else if ((idConversacion || telefonoWhatsApp) && omitirAvancePaso) {
		try {
			const botConversacion = require('./botConversacion.service');
			const idConv =
				idConversacion ||
				(telefonoWhatsApp ? botConversacion.idDesdeTelefono(telefonoWhatsApp) : null);
			if (idConv) {
				await botConversacion.actualizarContextoPaciente(idConv, {
					dniPaciente: String(dni),
					nombreContacto: pacienteLocal?.nombre || renaperData?.nombreCompleto || null,
				});
			}
		} catch (e) {
			console.warn('[botAgenda] contexto conversación:', e.message);
		}
	}

	return {
		renaper: renaperOk
			? { encontrado: true, fuente: renaperData?.fuente || 'renaper', ...renaperData }
			: { encontrado: false },
		pacienteLocal: pacienteLocal ? { existe: true, ...pacienteLocal } : { existe: false },
		idPaciente,
		pacienteCreado,
		accionSugerida,
		siguientePaso: omitirAvancePaso ? null : 'ELEGIR_ESPECIALIDAD',
	};
}

async function crearPacienteBot(body) {
	const config = await botConfigService.getBotConfig();
	const dni = body.numeroDocumento != null ? _validarDni(body.numeroDocumento) : null;
	const sexo = body.sexo ? _validarSexo(body.sexo) : null;

	let datos = {
		ApellidoyNombre: body.apellidoNombre || body.ApellidoyNombre,
		NumeroDocumento: dni,
		Sexo: sexo ? _sexoRenaperToLocal(sexo) || sexo : null,
		FechaNacimiento: body.fechaNacimiento || body.FechaNacimiento,
		Domicilio: body.domicilio || body.Domicilio,
		TelefonoNegocio: body.telefono || body.telefonoWhatsApp,
		NumeroSSN: body.numeroAfiliado || body.nAfiliado,
		NumeroCuenta: body.cobertura || body.Cobertura,
		Mail: body.mail || body.Mail,
	};

	if (dni && config.reglas.requiereRenaper !== false) {
		const renaperResult = sexo
			? await renaperService.search(dni, _validarSexo(sexo))
			: await renaperService.searchByDni(dni);
		if (renaperResult.ok && renaperResult.data) {
			const p = renaperResult.data;
			datos.ApellidoyNombre = datos.ApellidoyNombre || _nombreDesdeRenaper(p);
			datos.FechaNacimiento =
				datos.FechaNacimiento ||
				(p.fechaNacimiento ? String(p.fechaNacimiento).slice(0, 10) : null);
			datos.Sexo = datos.Sexo || _sexoRenaperToLocal(p.sexo) || renaperResult.sexoDetectado;
			datos.Domicilio = datos.Domicilio || _domicilioDesdeRenaper(p);
		}
	}

	if (!datos.ApellidoyNombre || !datos.Sexo) {
		const e = new Error('ApellidoyNombre y Sexo son requeridos');
		e.statusCode = 400;
		throw e;
	}

	if (body.telefonoWhatsApp || body.telefono) {
		datos.TelefonoNegocio = String(body.telefonoWhatsApp || body.telefono)
			.replace(/\D/g, '')
			.slice(-15);
	}

	const nuevo = await patientsService.crearPaciente(datos);
	const mapped = _mapPacienteRow(nuevo);

	await botLogService.registrarLog({
		accion: 'CREAR_PACIENTE',
		idPaciente: mapped?.idPaciente,
		telefonoWhatsApp: body.telefonoWhatsApp,
		idConversacion: body.idConversacion,
		payload: { dni },
		resultado: 'OK',
	});

	return mapped;
}

async function buscarPaciente({ dni, telefono }) {
	if (dni) {
		const n = _validarDni(dni);
		const row = await _buscarPacienteLocalPorDni(n);
		const pacientes = row ? [_mapPacienteRow(row)] : [];
		return { encontrados: pacientes.length, pacientes };
	}
	if (telefono) {
		const tel = String(telefono).replace(/\D/g, '').slice(-15);
		const rows = await executeQuery(
			`SELECT TOP 10
			        p.IDPaciente, p.NumeroDocumento, p.ApellidoyNombre, p.Sexo,
			        CASE WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento <= 0 THEN NULL
			             ELSE CONVERT(varchar(10), DATEADD(DAY, p.FechaNacimiento, '1800-12-28'), 23)
			        END AS FechaNacimiento,
			        p.TelefonoParticular, p.TelefonoNegocio, p.Mail,
			        c.RazonSocial AS Cobertura
			 FROM dbo.imPacientes p
			 LEFT JOIN dbo.imClientes c ON c.Valor = p.NumeroCuenta
			 WHERE REPLACE(REPLACE(REPLACE(p.TelefonoNegocio,'-',''),' ',''),'+','') LIKE @p0
			    OR REPLACE(REPLACE(REPLACE(p.TelefonoParticular,'-',''),' ',''),'+','') LIKE @p0
			 ORDER BY p.IDPaciente DESC`,
			[{ value: `%${tel}%`, type: 'VarChar' }],
		);
		const pacientes = rows.map(_mapPacienteRow).filter(Boolean);
		return { encontrados: pacientes.length, pacientes };
	}
	const e = new Error('Indicá dni o telefono para buscar');
	e.statusCode = 400;
	throw e;
}

async function listarEspecialidadesBot() {
	const rows = await executeQuery(
		`SELECT e.Valor AS valor, RTRIM(LTRIM(e.Descripcion)) AS nombre,
		        COUNT(DISTINCT h.Matricula) AS cantProfesionales
		 FROM dbo.imEspecialidad e
		 INNER JOIN dbo.imPersonal p ON p.ValorEspecialidad = e.Valor
		 INNER JOIN dbo.imPersonalHorarios h ON h.Matricula = p.Matricula
		 GROUP BY e.Valor, e.Descripcion
		 HAVING COUNT(DISTINCT h.Matricula) > 0
		 ORDER BY e.Descripcion`,
	);
	return rows.map((r) => ({
		valor: Number(r.valor),
		nombre: String(r.nombre || '').trim(),
		cantProfesionales: Number(r.cantProfesionales) || 0,
	}));
}

async function listarProfesionalesBot(especialidad, servicio) {
	const esp = Number(especialidad);
	if (!Number.isFinite(esp) || esp <= 0) {
		const e = new Error('Query param especialidad es requerido');
		e.statusCode = 400;
		throw e;
	}

	const espRow = await executeQuery(
		`SELECT TOP 1 Valor, Descripcion FROM dbo.imEspecialidad WHERE Valor = @p0`,
		[{ value: esp, type: 'SmallInt' }],
	);
	const espNombre = espRow[0]?.Descripcion ? String(espRow[0].Descripcion).trim() : null;

	const profesionales = await agendaService.listarProfesionalesAgenda({
		especialidad: esp,
		servicio: servicio ? String(servicio).trim() : undefined,
	});

	const rows = await executeQuery(
		`SELECT DISTINCT h.Matricula, h.IdServicio, s.Descripcion AS ServicioNombre
		 FROM dbo.imPersonalHorarios h
		 INNER JOIN dbo.imPersonal p ON p.Matricula = h.Matricula
		 LEFT JOIN dbo.imServicios s ON RTRIM(LTRIM(s.Valor)) = RTRIM(LTRIM(h.IdServicio))
		 WHERE p.ValorEspecialidad = @p0`,
		[{ value: esp, type: 'SmallInt' }],
	);
	const serviciosPorMat = new Map();
	for (const r of rows) {
		const mat = Number(r.Matricula);
		if (!serviciosPorMat.has(mat)) serviciosPorMat.set(mat, []);
		serviciosPorMat.get(mat).push({
			codigo: r.IdServicio ? String(r.IdServicio).trim() : '',
			nombre: r.ServicioNombre ? String(r.ServicioNombre).trim() : null,
		});
	}

	return {
		especialidad: { valor: esp, nombre: espNombre },
		profesionales: profesionales.map((p) => ({
			matricula: p.matricula,
			nombre: p.nombre,
			especialidad: esp,
			especialidadNombre: espNombre,
			servicios: serviciosPorMat.get(p.matricula) || [],
		})),
		siguientePaso: 'ELEGIR_PROFESIONAL',
	};
}

function _diaSemanaLegible(fechaIso) {
	const date = new Date(`${String(fechaIso).slice(0, 10)}T12:00:00`);
	const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	return dias[date.getDay()];
}

function _fechaLegible(fechaIso) {
	const [y, mo, d] = String(fechaIso).slice(0, 10).split('-');
	return `${d}/${mo}/${y}`;
}

async function _buildTicket({
	idTurno,
	fecha,
	hora,
	matricula,
	idPaciente,
	sector,
	idConversacion,
}) {
	const config = await botConfigService.getBotConfig();
	const codigo = `T-${idTurno}-${String(fecha).replace(/-/g, '')}`;

	const [pacRows, medRows] = await Promise.all([
		executeQuery(
			`SELECT TOP 1 ApellidoyNombre, NumeroDocumento FROM dbo.imPacientes WHERE IDPaciente = @p0`,
			[{ value: idPaciente, type: 'Int' }],
		),
		executeQuery(
			`SELECT TOP 1 p.ApellidoNombre, p.ValorEspecialidad, e.Descripcion AS EspecialidadNombre
			 FROM dbo.imPersonal p
			 LEFT JOIN dbo.imEspecialidad e ON e.Valor = p.ValorEspecialidad
			 WHERE p.Matricula = @p0`,
			[{ value: matricula, type: 'Int' }],
		),
	]);

	const paciente = pacRows[0]?.ApellidoyNombre ? String(pacRows[0].ApellidoyNombre).trim() : null;
	const dni = pacRows[0]?.NumeroDocumento != null ? Number(pacRows[0].NumeroDocumento) : null;
	const medico = medRows[0]?.ApellidoNombre ? String(medRows[0].ApellidoNombre).trim() : null;
	const especialidad =
		medRows[0]?.EspecialidadNombre ? String(medRows[0].EspecialidadNombre).trim() : null;
	const diaSemana = _diaSemanaLegible(fecha);
	const fechaLegible = _fechaLegible(fecha);
	const emitidoEn = new Date().toISOString();

	const lineas = [
		`✅ *Turno confirmado — ${config.nombreInstitucion}*`,
		'',
		`📋 *Comprobante:* ${codigo}`,
		`👤 *Paciente:* ${paciente || '—'}${dni ? ` (DNI ${dni})` : ''}`,
		`🩺 *Especialidad:* ${especialidad || '—'}`,
		`👨‍⚕️ *Profesional:* ${medico || '—'}`,
		`📅 *Fecha:* ${diaSemana} ${fechaLegible}`,
		`🕐 *Hora:* ${hora}`,
	];
	if (sector) lineas.push(`🏥 *Sector:* ${String(sector).trim()}`);
	lineas.push('', 'Presentá este comprobante el día del turno.');

	const mensajeWhatsApp = lineas.join('\n');
	const textoTicket = [
		`COMPROBANTE DE TURNO — ${config.nombreInstitucion}`,
		`Código: ${codigo}`,
		`Paciente: ${paciente || '—'}`,
		dni ? `DNI: ${dni}` : null,
		`Especialidad: ${especialidad || '—'}`,
		`Profesional: ${medico || '—'}`,
		`Fecha: ${diaSemana} ${fechaLegible}`,
		`Hora: ${hora}`,
		sector ? `Sector: ${String(sector).trim()}` : null,
		`Emitido: ${emitidoEn}`,
	]
		.filter(Boolean)
		.join('\n');

	return {
		codigo,
		idTurno,
		idPaciente,
		matricula,
		paciente,
		dni,
		especialidad,
		medico,
		fecha,
		fechaLegible,
		diaSemana,
		hora,
		sector: sector ? String(sector).trim() : null,
		institucion: config.nombreInstitucion,
		idConversacion: idConversacion || null,
		emitidoEn,
		mensajeWhatsApp,
		textoTicket,
	};
}

async function disponibilidadBot(fechaIso, filtros = {}) {
	if (!fechaIso) {
		const e = new Error('fecha es requerida (YYYY-MM-DD)');
		e.statusCode = 400;
		throw e;
	}

	const matricula =
		filtros.matricula != null && filtros.matricula !== ''
			? Number(filtros.matricula)
			: null;
	const espFiltro =
		filtros.especialidad != null && Number.isFinite(Number(filtros.especialidad))
			? Number(filtros.especialidad)
			: null;

	if (!matricula || !Number.isFinite(matricula) || matricula <= 0) {
		const e = new Error(
			'matricula del profesional es requerida. Primero GET /profesionales?especialidad=',
		);
		e.statusCode = 400;
		e.code = 'MATRICULA_REQUERIDA';
		throw e;
	}

	const config = await botConfigService.getBotConfig();
	const profRows = await executeQuery(
		`SELECT TOP 1 p.Matricula, p.ApellidoNombre, p.ValorEspecialidad, e.Descripcion AS EspecialidadNombre
		 FROM dbo.imPersonal p
		 LEFT JOIN dbo.imEspecialidad e ON e.Valor = p.ValorEspecialidad
		 WHERE p.Matricula = @p0`,
		[{ value: matricula, type: 'Int' }],
	);
	if (!profRows.length) {
		const e = new Error('Profesional no encontrado');
		e.statusCode = 404;
		throw e;
	}
	if (espFiltro != null && Number(profRows[0].ValorEspecialidad) !== espFiltro) {
		const e = new Error('El profesional no pertenece a la especialidad indicada');
		e.statusCode = 409;
		e.code = 'ESPECIALIDAD_NO_COINCIDE';
		throw e;
	}

	const profesionales = await agendaService.disponibilidadDia(String(fechaIso), {
		servicio: filtros.servicio ? String(filtros.servicio).trim() : undefined,
		especialidad: espFiltro ?? undefined,
	});
	const profDia = profesionales.find((p) => p.matricula === matricula);

	const grilla = await agendaService.generarSlots(matricula, String(fechaIso), String(fechaIso));
	const dia = grilla?.dias?.[0];
	const slotsLibres = (dia?.slots || [])
		.filter((s) => !s.esSobreturno && s.estado === 'LIBRE')
		.map((s) => ({ hora: s.hora, sector: s.sector ? String(s.sector).trim() : null }));

	return {
		fecha: String(fechaIso).slice(0, 10),
		diaSemana: _diaSemanaLegible(fechaIso),
		profesional: {
			matricula,
			nombre: profRows[0].ApellidoNombre ? String(profRows[0].ApellidoNombre).trim() : null,
			especialidad: Number(profRows[0].ValorEspecialidad) || null,
			especialidadNombre: profRows[0].EspecialidadNombre
				? String(profRows[0].EspecialidadNombre).trim()
				: null,
			total: profDia?.total ?? slotsLibres.length,
			ocupados: profDia?.ocupados ?? 0,
			libres: profDia?.libres ?? slotsLibres.length,
		},
		slotsLibres,
		reglas: {
			anticipacionMinHoras: config.reglas.anticipacionMinHoras,
			diasMaxAntelacion: config.reglas.diasMaxAntelacion,
		},
		siguientePaso: 'CONFIRMAR_RESERVA',
	};
}

async function _validarAnticipacion(fecha, hora, config) {
	const now = new Date();
	const [y, mo, d] = String(fecha).slice(0, 10).split('-').map(Number);
	const [hh, mm] = String(hora || '00:00').split(':').map(Number);
	const turnoDate = new Date(y, mo - 1, d, hh || 0, mm || 0);
	const minMs = (config.reglas.anticipacionMinHoras || 0) * 3600000;
	if (turnoDate.getTime() - now.getTime() < minMs) {
		const e = new Error(
			`El turno debe reservarse con al menos ${config.reglas.anticipacionMinHoras} horas de anticipación`,
		);
		e.statusCode = 409;
		e.code = 'ANTICIPACION_INSUFICIENTE';
		throw e;
	}
	const maxDias = config.reglas.diasMaxAntelacion || 60;
	const maxDate = new Date(now);
	maxDate.setDate(maxDate.getDate() + maxDias);
	if (turnoDate > maxDate) {
		const e = new Error(`No se pueden reservar turnos con más de ${maxDias} días de anticipación`);
		e.statusCode = 409;
		e.code = 'ANTICIPACION_EXCEDIDA';
		throw e;
	}
}

async function _validarMaxTurnosDia(idPaciente, fecha, config) {
	const max = config.reglas.maxTurnosPorPacienteDia;
	if (!max || max <= 0) return;
	const fechaClarion = convertirFechaAClarion(String(fecha).slice(0, 10));
	const rows = await executeQuery(
		`SELECT COUNT(*) AS cant FROM dbo.imTurnos
		 WHERE IDPaciente = @p0 AND FechaAsignada = @p1
		   AND IDPaciente > 0 AND (Status IS NULL OR Status <> @p2)`,
		[
			{ value: idPaciente, type: 'Int' },
			{ value: fechaClarion, type: 'Int' },
			{ value: STATUS_CANCELADO, type: 'TinyInt' },
		],
	);
	const cant = Number(rows?.[0]?.cant) || 0;
	if (cant >= max) {
		const e = new Error(`El paciente ya tiene ${cant} turno(s) activo(s) para ese día`);
		e.statusCode = 409;
		e.code = 'MAX_TURNOS_DIA';
		throw e;
	}
}

async function _verificarTelefonoPaciente(idPaciente, telefonoWhatsApp) {
	if (!telefonoWhatsApp) return;
	const tel = String(telefonoWhatsApp).replace(/\D/g, '').slice(-10);
	if (!tel) return;
	const rows = await executeQuery(
		`SELECT TOP 1 TelefonoNegocio, TelefonoParticular FROM dbo.imPacientes WHERE IDPaciente = @p0`,
		[{ value: idPaciente, type: 'Int' }],
	);
	if (!rows.length) return;
	const neg = String(rows[0].TelefonoNegocio || '').replace(/\D/g, '');
	const par = String(rows[0].TelefonoParticular || '').replace(/\D/g, '');
	if (!neg && !par) return;
	const ok =
		(neg && (neg.endsWith(tel) || tel.endsWith(neg.slice(-10)))) ||
		(par && (par.endsWith(tel) || tel.endsWith(par.slice(-10))));
	if (!ok) {
		const e = new Error('El teléfono no coincide con el paciente del turno');
		e.statusCode = 403;
		e.code = 'TELEFONO_NO_COINCIDE';
		throw e;
	}
}

function _mensajeConfirmacion(config, data) {
	let msg = config.mensajes.confirmacion;
	msg = msg.replace('{fecha}', data.fecha || '');
	msg = msg.replace('{hora}', data.hora || '');
	msg = msg.replace('{medico}', data.medico || '');
	return msg;
}

async function reservarTurno(body, codOperador = 0) {
	const config = await botConfigService.getBotConfig();
	const matricula = Number(body.matricula);
	const idPaciente = Number(body.idPaciente);
	const fecha = String(body.fecha || '').slice(0, 10);
	const hora = String(body.hora || '').slice(0, 5);

	if (!Number.isFinite(matricula) || matricula <= 0) {
		const e = new Error('matricula inválida');
		e.statusCode = 400;
		throw e;
	}
	if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
		const e = new Error('idPaciente inválido');
		e.statusCode = 400;
		throw e;
	}

	await _validarAnticipacion(fecha, hora, config);
	await _validarMaxTurnosDia(idPaciente, fecha, config);

	const obsBase = String(body.observaciones || 'Turno solicitado vía WhatsApp').slice(0, 950);
	const tel = body.telefonoWhatsApp ? String(body.telefonoWhatsApp).replace(/\D/g, '').slice(-15) : '';
	const observaciones = `[BOT-WA]${tel ? ` tel:${tel}` : ''} ${obsBase}`.trim();

	try {
		const result = await agendaService.asignarTurno({
			matricula,
			fecha,
			hora,
			sector: body.sector ? String(body.sector).trim() : '',
			idPaciente,
			observaciones,
			tipoTurno: config.reglas.permiteSobreturno && body.tipoTurno === 1 ? 1 : 0,
			codOperador,
		});

		const pac = await executeQuery(
			`SELECT TOP 1 ApellidoyNombre FROM dbo.imPacientes WHERE IDPaciente = @p0`,
			[{ value: idPaciente, type: 'Int' }],
		);
		const med = await executeQuery(
			`SELECT TOP 1 ApellidoNombre FROM dbo.imPersonal WHERE Matricula = @p0`,
			[{ value: matricula, type: 'Int' }],
		);

		const medicoNombre = med[0]?.ApellidoNombre ? String(med[0].ApellidoNombre).trim() : null;
		const sectorUsado = body.sector ? String(body.sector).trim() : null;

		const ticket = await _buildTicket({
			idTurno: result.idTurno,
			fecha,
			hora,
			matricula,
			idPaciente,
			sector: sectorUsado,
			idConversacion: body.idConversacion,
		});

		const payload = {
			idTurno: result.idTurno,
			accion: result.accion,
			fecha,
			hora,
			matricula,
			medico: medicoNombre,
			paciente: pac[0]?.ApellidoyNombre ? String(pac[0].ApellidoyNombre).trim() : null,
			mensajeConfirmacion: _mensajeConfirmacion(config, {
				fecha,
				hora,
				medico: medicoNombre,
			}),
			ticket,
		};

		await botLogService.registrarLog({
			accion: 'RESERVA',
			idTurno: result.idTurno,
			idPaciente,
			telefonoWhatsApp: body.telefonoWhatsApp,
			idConversacion: body.idConversacion,
			payload: { matricula, fecha, hora },
			resultado: 'OK',
		});

		if (body.telefonoWhatsApp) await _actualizarTelefonoPaciente(idPaciente, body.telefonoWhatsApp);

		return payload;
	} catch (err) {
		await botLogService.registrarLog({
			accion: 'RESERVA',
			idPaciente,
			telefonoWhatsApp: body.telefonoWhatsApp,
			idConversacion: body.idConversacion,
			payload: { matricula, fecha, hora },
			resultado: 'ERROR',
			mensajeError: err.message,
		});
		throw err;
	}
}

async function consultarTurnosPaciente({ idPaciente, dni, proximos = true }) {
	let id = idPaciente != null ? Number(idPaciente) : null;
	if (!id && dni) {
		const row = await _buscarPacienteLocalPorDni(_validarDni(dni));
		id = row?.IDPaciente ?? null;
	}
	if (!id) {
		const e = new Error('Paciente no encontrado');
		e.statusCode = 404;
		throw e;
	}

	const turnos = await agendaService.buscarTurnosPorPaciente(id, { matriculaMedico: null });
	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);

	let list = turnos.map((t) => ({
		idTurno: t.idTurno,
		fecha: t.fecha,
		hora: t.hora,
		matricula: t.profesional,
		medico: t.profesionalNombre,
		estado: t.status === 1 ? 'CANCELADO' : t.status === 3 ? 'ATENDIDO' : 'OCUPADO',
		status: t.status,
		observaciones: t.observaciones,
	}));

	if (proximos) {
		list = list.filter((t) => {
			if (t.status === 1) return false;
			const d = new Date(`${t.fecha}T12:00:00`);
			return d >= hoy;
		});
	}

	return { idPaciente: id, turnos: list };
}

async function cancelarTurnoBot(body) {
	const matricula = Number(body.matricula);
	const idTurno = Number(body.idTurno);
	const idPaciente = body.idPaciente != null ? Number(body.idPaciente) : null;

	if (!Number.isFinite(matricula) || !Number.isFinite(idTurno)) {
		const e = new Error('matricula e idTurno son requeridos');
		e.statusCode = 400;
		throw e;
	}

	if (idPaciente) await _verificarTelefonoPaciente(idPaciente, body.telefonoWhatsApp);

	const motivo = body.motivo ? String(body.motivo).slice(0, 200) : 'Cancelado vía WhatsApp';
	try {
		const result = await agendaService.cancelarTurno({ matricula, idTurno });
		await executeQuery(
			`UPDATE dbo.imTurnos SET MotivoCancelacion = @p0 WHERE IdTurno = @p1`,
			[
				{ value: `[BOT-WA] ${motivo}`, type: 'VarChar' },
				{ value: idTurno, type: 'Int' },
			],
		);
		await botLogService.registrarLog({
			accion: 'CANCELACION',
			idTurno,
			idPaciente,
			telefonoWhatsApp: body.telefonoWhatsApp,
			idConversacion: body.idConversacion,
			resultado: 'OK',
		});
		return { ...result, motivo };
	} catch (err) {
		await botLogService.registrarLog({
			accion: 'CANCELACION',
			idTurno,
			idPaciente,
			telefonoWhatsApp: body.telefonoWhatsApp,
			resultado: 'ERROR',
			mensajeError: err.message,
		});
		throw err;
	}
}

async function obtenerTicketTurno(idTurno) {
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const rows = await executeQuery(
		`SELECT TOP 1 IdTurno, FechaAsignada, HoraAsignada, IDPaciente, Profesional, Sector, Status
		 FROM dbo.imTurnos WHERE IdTurno = @p0`,
		[{ value: id, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}
	const t = rows[0];
	const st = t.Status != null ? Number(t.Status) : 0;
	if (st === 1) {
		const e = new Error('El turno está cancelado');
		e.statusCode = 409;
		throw e;
	}

	const { convertirFechaClarionADate, convertirHoraClarionAString } = require('../utils/dateUtils');
	const fechaDate = convertirFechaClarionADate(t.FechaAsignada);
	const fecha = fechaDate
		? `${fechaDate.getFullYear()}-${String(fechaDate.getMonth() + 1).padStart(2, '0')}-${String(fechaDate.getDate()).padStart(2, '0')}`
		: null;
	const horaRaw = convertirHoraClarionAString(t.HoraAsignada);
	const hora = horaRaw ? horaRaw.slice(0, 5) : null;

	return _buildTicket({
		idTurno: id,
		fecha,
		hora,
		matricula: Number(t.Profesional),
		idPaciente: Number(t.IDPaciente),
		sector: t.Sector,
	});
}

async function obtenerConfigCompleta() {
	const config = await botConfigService.getBotConfig();
	const servicios = await botConfigService.getServiciosCatalogo();
	const profesionales = await agendaService.listarProfesionalesAgenda({});
	const especialidades = await listarEspecialidadesBot();
	const flujo = await botConfigService.getFlujoPasos();
	return {
		...config,
		servicios,
		especialidades,
		profesionalesCount: profesionales.length,
		flujo,
	};
}

module.exports = {
	identificarPaciente,
	crearPacienteBot,
	buscarPaciente,
	listarEspecialidadesBot,
	listarProfesionalesBot,
	disponibilidadBot,
	reservarTurno,
	consultarTurnosPaciente,
	cancelarTurnoBot,
	obtenerTicketTurno,
	obtenerConfigCompleta,
};
