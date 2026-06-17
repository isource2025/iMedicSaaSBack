/**
 * Orquestación de turnos vía chatbot: RENAPER → paciente → disponibilidad → reserva.
 */
const renaperService = require('./renaper.service');
const patientsService = require('./patients.service');
const agendaService = require('./agenda.service');
const botConfigService = require('./botConfig.service');
const botLogService = require('./botLog.service');
const botOpenai = require('./botOpenai.service');
const { STATUS_CANCELADO } = require('../utils/agendaCatalogos');
const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirFechaClarionADate } = require('../utils/dateUtils');

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

function _formatFechaIsoLocal(d) {
	if (!d || Number.isNaN(d.getTime())) return null;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _fechaNacimientoDesdeRow(row) {
	const clarion = row.FechaNacimientoClarion ?? row.FechaNacimientoRaw;
	if (clarion != null && Number.isFinite(Number(clarion))) {
		const n = Number(clarion);
		if (n > 0 && n <= 1_000_000) {
			const d = convertirFechaClarionADate(n);
			if (d) return _formatFechaIsoLocal(d);
		}
	}
	const fn = row.FechaNacimiento;
	if (fn instanceof Date && !Number.isNaN(fn.getTime())) {
		return _formatFechaIsoLocal(fn);
	}
	if (fn != null && fn !== '') {
		const s = String(fn).trim();
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
	}
	return null;
}

function _mapPacienteRow(row) {
	if (!row) return null;
	return {
		idPaciente: row.IDPaciente,
		nombre: row.ApellidoyNombre ? String(row.ApellidoyNombre).trim() : null,
		dni: row.NumeroDocumento != null ? Number(row.NumeroDocumento) : null,
		sexo: row.Sexo ? String(row.Sexo).trim() : null,
		fechaNacimiento: _fechaNacimientoDesdeRow(row),
		cobertura: row.Cobertura ? String(row.Cobertura).trim() : null,
		telefonoParticular: row.TelefonoParticular ? String(row.TelefonoParticular).trim() : null,
		telefonoCelular: row.TelefonoNegocio ? String(row.TelefonoNegocio).trim() : null,
		mail: row.Mail ? String(row.Mail).trim() : null,
	};
}

async function _validarProfesionalBot(matricula, especialidadValor = null) {
	const mat = Number(matricula);
	if (!Number.isFinite(mat) || mat <= 0) {
		const e = new Error('matricula inválida');
		e.statusCode = 400;
		throw e;
	}
	const rows = await executeQuery(
		`SELECT TOP 1 p.Matricula, p.ApellidoNombre, p.ValorEspecialidad
		 FROM dbo.imPersonal p
		 INNER JOIN dbo.imPersonalHorarios h ON h.Matricula = p.Matricula
		 WHERE p.Matricula = @p0
		   AND NULLIF(LTRIM(RTRIM(p.ApellidoNombre)), '') IS NOT NULL`,
		[{ value: mat, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Profesional no encontrado en la nómina activa');
		e.statusCode = 404;
		e.code = 'PROFESIONAL_INEXISTENTE';
		throw e;
	}
	const esp = especialidadValor != null ? Number(especialidadValor) : null;
	if (esp != null && Number.isFinite(esp) && Number(rows[0].ValorEspecialidad) !== esp) {
		const e = new Error('El profesional no pertenece a la especialidad indicada');
		e.statusCode = 409;
		e.code = 'ESPECIALIDAD_NO_COINCIDE';
		throw e;
	}
	return {
		matricula: mat,
		nombre: String(rows[0].ApellidoNombre).trim(),
		especialidad: Number(rows[0].ValorEspecialidad) || null,
	};
}

async function _buscarPacienteLocalPorDni(dni) {
	const dniStr = String(dni).trim();
	try {
		const rows = await executeQuery(
			`SELECT TOP 1
				p.IDPaciente, p.NumeroDocumento, p.ApellidoyNombre, p.Sexo,
				p.FechaNacimiento AS FechaNacimientoClarion,
				p.TelefonoParticular, p.TelefonoNegocio, p.Mail, c.RazonSocial AS Cobertura, p.NumeroCuenta
			 FROM dbo.imPacientes p
			 LEFT JOIN dbo.imClientes c ON p.NumeroCuenta = c.Valor
			 WHERE p.NumeroDocumento = @p0
			    OR LTRIM(RTRIM(CAST(p.NumeroDocumento AS VARCHAR(20)))) = @p1
			    OR (TRY_CAST(LTRIM(RTRIM(CAST(p.NumeroDocumento AS VARCHAR(20)))) AS BIGINT) = @p0)
			 ORDER BY p.IDPaciente DESC`,
			[
				{ value: Number(dniStr), type: 'Int' },
				{ value: dniStr, type: 'VarChar' },
			],
		);
		return rows[0] || null;
	} catch (err) {
		console.warn('[botAgenda] Búsqueda paciente local falló:', err.message);
		return null;
	}
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

/** Alta en impacientes con el mismo servicio que admisión → pacientes. */
async function _crearPacienteDesdeRenaper({
	renaperData,
	dni,
	sexoDetectado,
	telefonoWhatsApp,
	idConversacion,
}) {
	const sexo = _sexoRenaperToLocal(renaperData?.sexo || sexoDetectado);
	if (!sexo) {
		const e = new Error('No se pudo determinar el sexo desde RENAPER para dar de alta al paciente');
		e.statusCode = 422;
		e.code = 'PACIENTE_SIN_SEXO';
		throw e;
	}

	const nombre =
		renaperData?.nombreCompleto ||
		_nombreDesdeRenaper(renaperData) ||
		`PACIENTE ${dni}`;

	const pacienteData = {
		ApellidoyNombre: nombre,
		TipoDocumento: 'DNI',
		NumeroDocumento: dni,
		Sexo: sexo,
		FechaNacimiento: renaperData?.fechaNacimiento
			? convertirFechaAClarion(renaperData.fechaNacimiento)
			: null,
		Domicilio: renaperData?.domicilio || null,
		TelefonoNegocio: telefonoWhatsApp
			? String(telefonoWhatsApp).replace(/\D/g, '').slice(-15)
			: null,
	};

	const nuevo = await patientsService.crearPaciente(pacienteData);
	const mapped = _mapPacienteRow(nuevo);

	await botLogService.registrarLog({
		accion: 'CREAR_PACIENTE',
		idPaciente: mapped?.idPaciente,
		telefonoWhatsApp,
		idConversacion,
		payload: { dni, fuente: 'renaper', nombre },
		resultado: 'OK',
	});

	return mapped;
}

async function identificarPaciente({
	numeroDocumento,
	sexo,
	telefonoWhatsApp,
	crearSiNoExiste,
	forzarAltaLocal = false,
	idConversacion,
	omitirAvancePaso = false,
	fase = 'completa',
}) {
	const config = await botConfigService.getBotConfig();
	const dni = _validarDni(numeroDocumento);
	const sexoHint = sexo ? _validarSexo(sexo) : null;
	const soloLocal = fase === 'local';
	const soloRenaper = fase === 'renaper';

	let renaperData = null;
	let renaperOk = false;
	let renaperSigned = false;
	let sexoDetectado = null;
	let renaperError = null;

	const localRow = await _buscarPacienteLocalPorDni(dni);
	let pacienteLocal = localRow ? _mapPacienteRow(localRow) : null;

	// Ficha local existente: no bloquear el flujo esperando RENAPER (LE/DNI legacy, timeouts MSAL).
	if (pacienteLocal) {
		renaperData = _renaperDataDesdePacienteLocal(pacienteLocal, dni);
		renaperOk = true;
		sexoDetectado = pacienteLocal.sexo || sexoDetectado;
	} else if (!soloLocal && config.reglas.requiereRenaper !== false) {
		const renaperOpts = {
			debug: false,
			timeoutMs: Number(process.env.BOT_RENAPER_TIMEOUT_MS || 35_000),
		};
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
	} else if (!renaperOk && !soloLocal && config.reglas.requiereRenaper === true) {
		// Último intento: ficha local (p. ej. NumeroDocumento como texto)
		if (!pacienteLocal) {
			const retryRow = await _buscarPacienteLocalPorDni(dni);
			if (retryRow) {
				pacienteLocal = _mapPacienteRow(retryRow);
				renaperData = _renaperDataDesdePacienteLocal(pacienteLocal, dni);
				renaperOk = true;
				sexoDetectado = pacienteLocal.sexo || sexoDetectado;
			}
		}
		if (!renaperOk) {
			if (renaperError) {
				const e = new Error('Servicio RENAPER no disponible desde el servidor');
				e.statusCode = 503;
				e.code =
					renaperError.code === 'RENAPER_TIMEOUT' ? 'RENAPER_TIMEOUT' : 'RENAPER_UNAVAILABLE';
				throw e;
			}
			const e = new Error('No se encontraron datos en RENAPER');
			e.statusCode = 404;
			e.code = 'RENAPER_NO_ENCONTRADO';
			throw e;
		}
	}

	let idPaciente = pacienteLocal?.idPaciente ?? null;
	let accionSugerida = 'CONFIRMAR_DATOS';
	let pacienteCreado = false;

	if (pacienteLocal) {
		accionSugerida = 'USAR_PACIENTE_EXISTENTE';
		if (telefonoWhatsApp) await _actualizarTelefonoPaciente(idPaciente, telefonoWhatsApp);
	} else if (
		!soloLocal &&
		renaperOk &&
		(crearSiNoExiste || config.reglas.crearPacienteAutomatico || forzarAltaLocal)
	) {
		try {
			pacienteLocal = await _crearPacienteDesdeRenaper({
				renaperData,
				dni,
				sexoDetectado,
				telefonoWhatsApp,
				idConversacion,
			});
			idPaciente = pacienteLocal?.idPaciente ?? null;
			pacienteCreado = true;
			accionSugerida = 'PACIENTE_CREADO';
		} catch (err) {
			console.error('[botAgenda] Alta paciente desde RENAPER falló:', err.message, err.code || '');
			if (forzarAltaLocal) throw err;
			accionSugerida = 'CREAR_PACIENTE';
		}
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

	let renaperData = null;
	let sexoDetectado = sexo ? _sexoRenaperToLocal(sexo) : null;

	if (dni && config.reglas.requiereRenaper !== false) {
		const renaperResult = sexo
			? await renaperService.search(dni, _validarSexo(sexo))
			: await renaperService.searchByDni(dni);
		if (renaperResult.ok && renaperResult.data) {
			sexoDetectado =
				_sexoRenaperToLocal(renaperResult.data.sexo) ||
				renaperResult.sexoDetectado ||
				sexoDetectado;
			renaperData = _mapRenaperData(
				renaperResult.data,
				dni,
				sexoDetectado,
				!!renaperResult.meta?.signed,
			);
		}
	}

	if (!renaperData) {
		const e = new Error('No se encontraron datos en RENAPER para crear el paciente');
		e.statusCode = 404;
		e.code = 'RENAPER_NO_ENCONTRADO';
		throw e;
	}

	const mapped = await _crearPacienteDesdeRenaper({
		renaperData,
		dni,
		sexoDetectado,
		telefonoWhatsApp: body.telefonoWhatsApp || body.telefono,
		idConversacion: body.idConversacion,
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
		profesionales: profesionales
			.filter((p) => p.matricula && p.nombre)
			.map((p) => ({
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
	await _validarProfesionalBot(
		matricula,
		body.especialidad != null ? Number(body.especialidad) : null,
	);

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
		if (!medicoNombre) {
			const e = new Error('Profesional no encontrado en la nómina activa');
			e.statusCode = 404;
			e.code = 'PROFESIONAL_INEXISTENTE';
			throw e;
		}
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

function _normalizarTextoBusqueda(texto) {
	return String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

const _STOPWORDS_ESPECIALIDAD = new Set([
	'quiero',
	'quiera',
	'un',
	'una',
	'turno',
	'para',
	'necesito',
	'hay',
	'que',
	'cual',
	'cuales',
	'especialidad',
	'especialidades',
	'medico',
	'doctor',
	'dame',
	'dar',
	'sacar',
	'pedir',
	'pedi',
	'el',
	'la',
	'los',
	'las',
	'me',
	'mi',
	'con',
	'por',
	'favor',
	'bueno',
	'hola',
	'ver',
	'disponible',
	'disponibles',
	'lista',
	'mostrar',
	'mostrame',
	'decime',
	'decir',
	'areas',
	'servicios',
	'consulta',
	'consultar',
	'ir',
	'tiene',
	'tienen',
	'alguna',
	'algun',
	'tambien',
	'otra',
	'otro',
]);

function _tokensDesdeTexto(texto) {
	const t = _normalizarTextoBusqueda(texto);
	return t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !_STOPWORDS_ESPECIALIDAD.has(w));
}

function esConsultaListaEspecialidades(texto) {
	const t = _normalizarTextoBusqueda(texto);
	if (!t) return false;
	if (t === 'especialidades' || t === 'especialidad' || t === 'mostrame' || t === 'mostrar') {
		return true;
	}
	const tema = /\b(especialidad|especialidades|areas|servicios|opciones)\b/.test(t);
	if (!tema) return false;
	const pregunta = /\b(que|cuales|cual|lista|hay|mostrar|mostrame|decime|ver|conocer|saber|informacion|info|contar|decir)\b/.test(
		t,
	);
	const consultaDirecta =
		/\b(me gustaria|quisiera|podrias|podes|pueden|tienen|tiene|ofrecen|brindan|cuentan)\b/.test(t) &&
		/\b(saber|conocer|ver|mostrar|decir|contar|informacion|info)\b/.test(t);
	const soloCatalogo =
		/\b(que especialidades|cuales especialidades|lista de especialidades|especialidades disponibles|especialidades que)\b/.test(
			t,
		);
	return pregunta || consultaDirecta || soloCatalogo;
}

function mensajeEspecialidadesDisponibles(lista) {
	const opciones = (lista || []).map((e) => `• ${e.nombre}`).join('\n');
	return `Estas son las especialidades con turno disponible:\n\n${opciones}\n\nDecime cuál necesitás (podés escribirla con tus palabras, por ejemplo *gineco* o *clínica*).`;
}

async function mensajeProfesionalesDisponibles(especialidadValor, opciones = {}) {
	const esp = Number(especialidadValor);
	if (!Number.isFinite(esp) || esp <= 0) {
		return 'Indicá la especialidad (por ejemplo: *Traumatología*) y te muestro los profesionales con agenda.';
	}
	const config = await botConfigService.getBotConfig();
	const max =
		Number(opciones.max) ||
		Number(config.reglas.busquedaMaxProfesionales) ||
		40;
	const { especialidad, profesionales } = await listarProfesionalesBot(esp);
	if (!profesionales.length) {
		return `No hay profesionales con agenda en *${especialidad?.nombre || 'esa especialidad'}* por ahora.`;
	}
	const visibles = profesionales.slice(0, max);
	const lista = visibles.map((p, i) => `${i + 1}. ${p.nombre}`).join('\n');
	const extra =
		profesionales.length > visibles.length
			? `\n\n(Mostrando ${visibles.length} de ${profesionales.length} profesionales con agenda.)`
			: '';
	return `Profesionales con agenda en *${especialidad?.nombre || 'la especialidad'}*:\n\n${lista}${extra}\n\nIndicá con quién querés atenderte o enviá el DNI para continuar con el turno.`;
}

function esConsultaListaProfesionales(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (!t) return false;
	return (
		/\b(profesional|profesionales|medico|medicos|doctor|doctores|quien atiende|quienes atienden)\b/.test(
			t,
		) &&
		/\b(que|cuales|cual|lista|hay|atienden|atiende|mostrar|mostrame|decime|ver|saber|conocer)\b/.test(t)
	);
}

function _mejorMatchPorTokens(texto, lista) {
	const tokens = _tokensDesdeTexto(texto);
	if (!tokens.length) return null;

	let best = null;
	let bestScore = 0;
	for (const e of lista) {
		const n = _normalizarTextoBusqueda(e.nombre);
		for (const token of tokens) {
			if (token.length < 4) continue;
			let score = 0;
			if (n === token) score = 100;
			else if (n.startsWith(token)) score = 80 + token.length;
			else if (n.includes(token)) score = 60 + token.length;
			else if (token.length >= 5 && n.startsWith(token.slice(0, 5))) score = 55;
			if (score > bestScore) {
				bestScore = score;
				best = e;
			}
		}
	}
	return bestScore >= 55 ? best : null;
}

function _nombreCoincideProfesional(nombreNorm, busqueda) {
	if (!busqueda || busqueda.length < 3) return false;
	if (nombreNorm === busqueda) return true;
	const tokens = nombreNorm.split(/\s+/).filter((t) => t.length >= 2);
	if (tokens.some((t) => t === busqueda || t.startsWith(busqueda) || busqueda.startsWith(t))) {
		return true;
	}
	return busqueda.length >= 4 && nombreNorm.includes(busqueda);
}

async function resolverProfesionalDesdeTexto(texto, especialidadValor) {
	const esp = Number(especialidadValor);
	if (!Number.isFinite(esp) || esp <= 0) return null;

	const { profesionales } = await listarProfesionalesBot(esp);
	if (!profesionales.length) return null;

	const numMatch = String(texto || '')
		.trim()
		.match(/^(\d{1,2})\.?\s*$/);
	if (numMatch) {
		const idx = Number(numMatch[1]) - 1;
		if (idx >= 0 && idx < profesionales.length) return profesionales[idx];
	}

	let busqueda = _normalizarTextoBusqueda(texto);
	if (!busqueda || busqueda.length < 3) return null;
	busqueda = busqueda
		.replace(/\b(con|el|la|los|las|dr|dra|doctor|doctora|profesional|medico|medicos)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!busqueda || busqueda.length < 3) return null;

	let match = profesionales.find((p) => _normalizarTextoBusqueda(p.nombre) === busqueda);
	if (match) return match;

	match = profesionales.find((p) =>
		_nombreCoincideProfesional(_normalizarTextoBusqueda(p.nombre), busqueda),
	);
	if (match) return match;

	match = _mejorMatchPorTokens(busqueda, profesionales);
	return match || null;
}

async function resolverEspecialidadDesdeTexto(texto) {
	const lista = await listarEspecialidadesBot();
	const t = _normalizarTextoBusqueda(texto);
	if (!t) return null;

	let match = lista.find((e) => _normalizarTextoBusqueda(e.nombre) === t);
	if (match) return match;

	match = lista.find(
		(e) =>
			_normalizarTextoBusqueda(e.nombre).includes(t) ||
			t.includes(_normalizarTextoBusqueda(e.nombre)),
	);
	if (match) return match;

	match = _mejorMatchPorTokens(texto, lista);
	if (match) return match;

	if (t.length >= 4) {
		match = lista.find((e) => _normalizarTextoBusqueda(e.nombre).startsWith(t.slice(0, 5)));
	}
	return match || null;
}

function _parsearJsonGpt(raw) {
	const s = String(raw || '')
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

async function resolverEspecialidadConGpt(texto) {
	if (!botOpenai.isConfigured()) return null;
	if (process.env.BOT_GPT_ENABLED === '0' || process.env.BOT_GPT_ENABLED === 'false') {
		return null;
	}

	const lista = await listarEspecialidadesBot();
	const nombres = lista.map((e) => `- ${e.nombre}`).join('\n');
	let raw;
	try {
		raw = await botOpenai.chat({
			system: `Extraé la especialidad médica que pide el paciente o si pregunta qué hay disponible.
Especialidades válidas (usá el nombre EXACTO):
${nombres}

Respondé ÚNICAMENTE JSON en una línea, sin markdown:
{"accion":"especialidad","nombre":"NOMBRE EXACTO"} si eligió o mencionó un área (ej. "gineco" → GINECOLOGÍA)
{"accion":"listar"} si pregunta qué especialidades hay
{"accion":"ninguna"} si no se puede determinar`,
			messages: [{ role: 'user', content: String(texto || '').trim() }],
		});
	} catch (err) {
		console.warn('[botAgenda] GPT especialidad:', err.message);
		return null;
	}

	const j = _parsearJsonGpt(raw);
	if (!j || j.accion === 'ninguna') return null;
	if (j.accion === 'listar') return { listar: true };

	if (j.accion === 'especialidad' && j.nombre) {
		const buscado = _normalizarTextoBusqueda(j.nombre);
		let match = lista.find((e) => _normalizarTextoBusqueda(e.nombre) === buscado);
		if (match) return match;
		match = lista.find((e) => _normalizarTextoBusqueda(e.nombre).includes(buscado));
		if (match) return match;
		match = lista.find((e) => buscado.includes(_normalizarTextoBusqueda(e.nombre)));
		if (match) return match;
	}
	return null;
}

async function resolverEspecialidadInteligente(texto) {
	if (esConsultaListaEspecialidades(texto)) {
		return { tipo: 'listar', lista: await listarEspecialidadesBot() };
	}

	let esp = await resolverEspecialidadDesdeTexto(texto);
	if (esp) return { tipo: 'especialidad', especialidad: esp };

	const gpt = await resolverEspecialidadConGpt(texto);
	if (gpt?.listar) {
		return { tipo: 'listar', lista: await listarEspecialidadesBot() };
	}
	if (gpt) return { tipo: 'especialidad', especialidad: gpt };

	return { tipo: 'no_encontrada' };
}

function _slotCumpleAnticipacion(fechaIso, hora, config) {
	const now = new Date();
	const [y, mo, d] = String(fechaIso).slice(0, 10).split('-').map(Number);
	const [hh, mm] = String(hora || '00:00').split(':').map(Number);
	const turnoDate = new Date(y, mo - 1, d, hh || 0, mm || 0);
	const minMs = (config.reglas.anticipacionMinHoras || 0) * 3600000;
	return turnoDate.getTime() - now.getTime() >= minMs;
}

function _fechaIsoOffset(dias) {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + dias);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _slotDateTime(fechaIso, hora) {
	const [y, mo, d] = String(fechaIso).slice(0, 10).split('-').map(Number);
	const [hh, mm] = String(hora || '00:00').split(':').map(Number);
	return new Date(y, mo - 1, d, hh || 0, mm || 0);
}

const _MAP_DIA_SEMANA = {
	domingo: 0,
	lunes: 1,
	martes: 2,
	miercoles: 3,
	jueves: 4,
	viernes: 5,
	sabado: 6,
};

function _normalizarExclusiones(excluir = {}) {
	const slots = Array.isArray(excluir.slots) ? excluir.slots : [];
	const fechas = new Set(
		[...(excluir.fechas || []), ...(excluir.fechasExcluidas || [])].map((f) =>
			String(f).slice(0, 10),
		),
	);
	const diasSemana = new Set(
		[...(excluir.diasSemana || []), ...(excluir.diasSemanaExcluidos || [])].map(Number),
	);
	return { slots, fechas, diasSemana };
}

function _normalizarPreferencias(preferir = {}) {
	return {
		fechas: new Set((preferir.fechas || []).map((f) => String(f).slice(0, 10))),
		diasSemana: new Set((preferir.diasSemana || []).map(Number)),
		franja: preferir.franja || null,
		horaDesde: preferir.horaDesde || null,
		horaHasta: preferir.horaHasta || null,
	};
}

function _detectarFranjaHoraria(t) {
	if (/\b(por la tarde|a la tarde|en la tarde|de tarde)\b/.test(t)) return 'tarde';
	if (/\b(por la noche|a la noche|en la noche|de noche)\b/.test(t)) return 'noche';
	if (
		/\b(por la manana|a la manana|en la manana|de manana|temprano)\b/.test(t) &&
		!/\b(el\s+)?manana\b/.test(t)
	) {
		return 'manana';
	}
	if (/\btarde\b/.test(t) && !/\b(por la manana|a la manana)\b/.test(t)) return 'tarde';
	return null;
}

function _slotCumpleFranja(hora, franja) {
	const hh = Number(String(hora || '00:00').split(':')[0]);
	if (!Number.isFinite(hh)) return true;
	if (franja === 'manana') return hh < 12;
	if (franja === 'tarde') return hh >= 12 && hh < 19;
	if (franja === 'noche') return hh >= 19;
	return true;
}

function _esPreguntaDisponibilidad(t) {
	return /\b(no\s+tenes?|tenes?|hay|habra|habrá|tienen|alguno|alguna|podes?|disponible)\b/.test(
		t,
	);
}

function _esNegacionDia(t, nombreDia) {
	return (
		new RegExp(`\\b${nombreDia}\\s+no\\b`).test(t) ||
		new RegExp(`\\bel\\s+${nombreDia}\\s+no\\b`).test(t) ||
		new RegExp(`\\bno\\s+(puedo|podria|voy|me sirve)\\b.*\\b${nombreDia}\\b`).test(t) ||
		new RegExp(`\\b${nombreDia}\\b.*\\bno\\s+(puedo|podria|voy|me sirve)\\b`).test(t)
	);
}

function _resumenPreferencia(preferir) {
	const partes = [];
	if (preferir.fechas?.length === 1) {
		partes.push(_fechaLegible(preferir.fechas[0]));
	} else if (preferir.diasSemana?.length) {
		const nombres = Object.entries(_MAP_DIA_SEMANA)
			.filter(([, n]) => preferir.diasSemana.includes(n))
			.map(([k]) => k);
		if (nombres.length) partes.push(nombres.join(', '));
	}
	if (preferir.franja === 'tarde') partes.push('por la tarde');
	else if (preferir.franja === 'manana') partes.push('por la mañana');
	else if (preferir.franja === 'noche') partes.push('por la noche');
	return partes.length ? partes.join(' ') : null;
}

function _diaCumplePreferencias(fechaIso, preferir) {
	if (!preferir.fechas.size && !preferir.diasSemana.size) return true;
	const fecha = String(fechaIso).slice(0, 10);
	if (preferir.fechas.size) return preferir.fechas.has(fecha);
	const diaNum = new Date(`${fecha}T12:00:00`).getDay();
	return preferir.diasSemana.has(diaNum);
}

function _slotCumplePreferencias(fechaIso, hora, preferir) {
	if (!_diaCumplePreferencias(fechaIso, preferir)) return false;
	if (preferir.franja && !_slotCumpleFranja(hora, preferir.franja)) return false;
	if (preferir.horaDesde) {
		const slot = String(hora || '').slice(0, 5);
		if (slot < String(preferir.horaDesde).slice(0, 5)) return false;
	}
	if (preferir.horaHasta) {
		const slot = String(hora || '').slice(0, 5);
		if (slot > String(preferir.horaHasta).slice(0, 5)) return false;
	}
	return true;
}

function _slotEstaExcluido(matricula, fechaIso, hora, excluir) {
	const fecha = String(fechaIso).slice(0, 10);
	if (excluir.fechas.has(fecha)) return true;
	const diaNum = new Date(`${fecha}T12:00:00`).getDay();
	if (excluir.diasSemana.has(diaNum)) return true;
	return excluir.slots.some(
		(s) =>
			Number(s.matricula) === Number(matricula) &&
			String(s.fecha).slice(0, 10) === fecha &&
			String(s.hora || '').slice(0, 5) === String(hora || '').slice(0, 5),
	);
}

/**
 * Interpreta rechazo o preferencia del paciente (ej. "el lunes no puedo" vs "¿tenés el miércoles a la tarde?").
 * Siempre excluye el turno sugerido actual.
 */
function interpretarAjusteTurno(texto, sugerenciaActual = null) {
	const t = _normalizarTextoBusqueda(texto);
	const excluir = { slots: [], fechas: [], diasSemana: [] };
	const preferir = { fechas: [], diasSemana: [], franja: null, horaDesde: null, horaHasta: null };

	if (sugerenciaActual?.matricula && sugerenciaActual?.fecha && sugerenciaActual?.hora) {
		excluir.slots.push({
			matricula: sugerenciaActual.matricula,
			fecha: String(sugerenciaActual.fecha).slice(0, 10),
			hora: String(sugerenciaActual.hora).slice(0, 5),
		});
	}

	const franja = _detectarFranjaHoraria(t);
	if (franja) preferir.franja = franja;

	const esPregunta = _esPreguntaDisponibilidad(t);
	const diasMencionados = [];

	for (const [nombre, num] of Object.entries(_MAP_DIA_SEMANA)) {
		if (!t.includes(nombre)) continue;
		diasMencionados.push({ nombre, num });
		if (_esNegacionDia(t, nombre)) {
			excluir.diasSemana.push(num);
		} else if (
			esPregunta ||
			franja ||
			/\b(para el|el mismo|preferi|mejor|a la|por la|mismo dia|puedo|podria|me viene bien|disponible el)\b/.test(
				t,
			)
		) {
			preferir.diasSemana.push(num);
		}
	}

	if (sugerenciaActual?.fecha && diasMencionados.length) {
		const fechaSug = String(sugerenciaActual.fecha).slice(0, 10);
		const diaSug = new Date(`${fechaSug}T12:00:00`).getDay();
		const pideMismoDia =
			preferir.diasSemana.includes(diaSug) ||
			diasMencionados.some((d) => d.num === diaSug);
		if (pideMismoDia) {
			preferir.fechas.push(fechaSug);
		}
	}

	const pideOtroDiaSemana =
		diasMencionados.length > 0 &&
		sugerenciaActual?.fecha &&
		!diasMencionados.some(
			(d) => d.num === new Date(`${String(sugerenciaActual.fecha).slice(0, 10)}T12:00:00`).getDay(),
		);

	if (
		franja &&
		sugerenciaActual?.fecha &&
		sugerenciaActual?.hora &&
		!pideOtroDiaSemana
	) {
		const fechaSug = String(sugerenciaActual.fecha).slice(0, 10);
		const hh = Number(String(sugerenciaActual.hora).split(':')[0]);
		if (hh < 12 && franja === 'tarde') {
			preferir.fechas.push(fechaSug);
		} else if (hh >= 12 && franja === 'manana') {
			preferir.fechas.push(fechaSug);
		}
	}

	if (sugerenciaActual?.fecha) {
		const fechaSug = String(sugerenciaActual.fecha).slice(0, 10);
		if (/\b(ese dia|esta fecha|ese horario|a esa hora|hoy no|mañana no)\b/.test(t)) {
			excluir.fechas.push(fechaSug);
		}
	}

	preferir.fechas = [...new Set(preferir.fechas)];
	preferir.diasSemana = [...new Set(preferir.diasSemana)];
	excluir.diasSemana = [...new Set(excluir.diasSemana)];
	excluir.fechas = [...new Set(excluir.fechas)];

	const resumen = _resumenPreferencia(preferir);
	return { excluir, preferir, resumen };
}

/** @deprecated usar interpretarAjusteTurno */
function construirExclusionesRechazo(texto, sugerenciaActual = null) {
	return interpretarAjusteTurno(texto, sugerenciaActual).excluir;
}

async function interpretarAjusteTurnoConGpt(texto, sugerenciaActual = null) {
	if (!botOpenai.isConfigured()) return null;
	if (process.env.BOT_GPT_ENABLED === '0' || process.env.BOT_GPT_ENABLED === 'false') {
		return null;
	}

	const ctxTurno = sugerenciaActual
		? `Turno sugerido actual: ${sugerenciaActual.diaSemana || ''} ${sugerenciaActual.fecha || ''} ${sugerenciaActual.hora || ''} con ${sugerenciaActual.medico || ''}.`
		: '';

	let raw;
	try {
		raw = await botOpenai.chat({
			system: `Interpretá qué turno alternativo pide el paciente en Argentina (español rioplatense).
${ctxTurno}

Respondé ÚNICAMENTE JSON en una línea:
{"excluirDiasSemana":["lunes"],"preferirDiasSemana":["miercoles"],"preferirFranja":"tarde"|"manana"|"noche"|null,"preferirFecha":"YYYY-MM-DD"|null,"excluirFechaActual":true|false}

Reglas:
- "no tenés para el miércoles a la tarde" → preferir miércoles + tarde (NO excluir miércoles)
- "el lunes no puedo" → excluir lunes
- Si pide tarde y el turno actual es a la mañana del mismo día → preferirFecha = fecha del turno actual
- Si no hay preferencia clara → preferirDiasSemana [] y preferirFranja null`,
			messages: [{ role: 'user', content: String(texto || '').trim() }],
		});
	} catch (err) {
		console.warn('[botAgenda] GPT ajuste turno:', err.message);
		return null;
	}

	const j = _parsearJsonGpt(raw);
	if (!j) return null;

	const excluir = { slots: [], fechas: [], diasSemana: [] };
	const preferir = { fechas: [], diasSemana: [], franja: null, horaDesde: null, horaHasta: null };

	if (sugerenciaActual?.matricula && sugerenciaActual?.fecha && sugerenciaActual?.hora) {
		excluir.slots.push({
			matricula: sugerenciaActual.matricula,
			fecha: String(sugerenciaActual.fecha).slice(0, 10),
			hora: String(sugerenciaActual.hora).slice(0, 5),
		});
	}

	for (const d of j.excluirDiasSemana || []) {
		if (_MAP_DIA_SEMANA[d] != null) excluir.diasSemana.push(_MAP_DIA_SEMANA[d]);
	}
	for (const d of j.preferirDiasSemana || []) {
		if (_MAP_DIA_SEMANA[d] != null) preferir.diasSemana.push(_MAP_DIA_SEMANA[d]);
	}
	if (j.preferirFranja) preferir.franja = j.preferirFranja;
	if (j.preferirFecha) preferir.fechas.push(String(j.preferirFecha).slice(0, 10));
	if (j.excluirFechaActual && sugerenciaActual?.fecha) {
		excluir.fechas.push(String(sugerenciaActual.fecha).slice(0, 10));
	}

	return { excluir, preferir, resumen: _resumenPreferencia(preferir) };
}

async function interpretarAjusteTurnoInteligente(texto, sugerenciaActual = null) {
	const local = interpretarAjusteTurno(texto, sugerenciaActual);
	const tienePreferencia =
		local.preferir.fechas.length ||
		local.preferir.diasSemana.length ||
		local.preferir.franja ||
		local.excluir.diasSemana.length ||
		local.excluir.fechas.length;

	if (tienePreferencia) return local;

	const gpt = await interpretarAjusteTurnoConGpt(texto, sugerenciaActual);
	if (gpt && (gpt.preferir.fechas.length || gpt.preferir.diasSemana.length || gpt.preferir.franja)) {
		return gpt;
	}

	return local;
}

function _fechasCandidatasBusqueda(maxDias, excluir, preferir) {
	if (preferir.fechas.size) {
		return [...preferir.fechas].filter((f) => !excluir.fechas.has(f)).sort();
	}

	const fechas = [];
	for (let d = 0; d <= maxDias; d++) {
		const fechaIso = _fechaIsoOffset(d);
		if (excluir.fechas.has(fechaIso)) continue;
		const diaNum = new Date(`${fechaIso}T12:00:00`).getDay();
		if (excluir.diasSemana.has(diaNum)) continue;
		if (!_diaCumplePreferencias(fechaIso, preferir)) continue;
		fechas.push(fechaIso);
	}
	return fechas;
}

function _busquedaTurnoTimeoutMs(reglas) {
	return Math.max(
		3000,
		Math.min(60_000, Number(reglas?.busquedaTimeoutMs ?? 12_000)),
	);
}

function _busquedaTurnoConcurrencia(reglas) {
	return Math.max(1, Math.min(8, Number(reglas?.busquedaConcurrencia ?? 4)));
}

function _maxDiasBusquedaBot(config, preferir) {
	const cfg = config.reglas.diasMaxAntelacion || 60;
	const cap = Number(config.reglas.busquedaMaxDias ?? 21);
	if (preferir.fechas.size || preferir.diasSemana.size) return cfg;
	return Math.min(cfg, cap);
}

function _maxProfesionalesBusqueda(reglas) {
	return Math.max(1, Math.min(60, Number(reglas?.busquedaMaxProfesionales ?? 40)));
}

async function _profesionalesConLibresEnDia(fechaIso, esp, ordenados) {
	try {
		const resumen = await agendaService.disponibilidadDia(String(fechaIso), { especialidad: esp });
		const mats = new Set(
			resumen.filter((r) => Number(r.libres) > 0).map((r) => Number(r.matricula)),
		);
		if (!mats.size) return [];
		return ordenados.filter((p) => mats.has(Number(p.matricula)));
	} catch (err) {
		console.warn('[botAgenda] disponibilidadDia falló:', err.message);
		return [];
	}
}

async function _mapEnLotes(items, tamano, fn) {
	const out = [];
	for (let i = 0; i < items.length; i += tamano) {
		const parte = await Promise.all(items.slice(i, i + tamano).map(fn));
		out.push(...parte);
	}
	return out;
}

function _empaquetarTurnoSugerido(mejor, especialidadMeta, esp) {
	if (!mejor) return null;
	return {
		matricula: mejor.matricula,
		medico: mejor.medico,
		especialidad: especialidadMeta?.valor ?? esp,
		especialidadNombre: especialidadMeta?.nombre || null,
		fecha: mejor.fecha,
		fechaLegible: _fechaLegible(mejor.fecha),
		diaSemana: mejor.diaSemana,
		hora: mejor.hora,
		sector: mejor.sector,
	};
}

async function _elegirMejorTurnoValido(candidatos, esp) {
	if (!candidatos.length) return null;
	const ordenados = [...candidatos]
		.filter(Boolean)
		.sort((a, b) => {
			const diff = a.dt - b.dt;
			if (diff !== 0) return diff;
			return String(a.medico || '').localeCompare(String(b.medico || ''), 'es');
		});
	for (const c of ordenados) {
		try {
			await _validarProfesionalBot(c.matricula, esp);
			return c;
		} catch (err) {
			console.warn(
				'[botAgenda] Turno descartado — profesional no habilitado:',
				c.matricula,
				err.message,
			);
		}
	}
	return null;
}

async function _validarSugerenciaTurno(sugerencia, esp) {
	if (!sugerencia?.matricula) return null;
	try {
		const prof = await _validarProfesionalBot(sugerencia.matricula, esp);
		return { ...sugerencia, medico: prof.nombre };
	} catch (err) {
		console.warn('[botAgenda] Sugerencia rechazada:', err.message);
		return null;
	}
}

/** Solo generarSlots — sin disponibilidadDia ni validación SQL extra por médico. */
async function _primerSlotEnFecha(matricula, medicoNombre, fechaIso, esp, config, excluir, preferir) {
	let grilla;
	try {
		grilla = await agendaService.generarSlots(matricula, String(fechaIso), String(fechaIso));
	} catch {
		return null;
	}

	const dia = grilla?.dias?.[0];
	if (dia?.bloqueado) return null;

	const slotsOrdenados = [...(dia?.slots || [])]
		.filter((s) => !s.esSobreturno && s.estado === 'LIBRE')
		.sort((a, b) => _slotDateTime(fechaIso, a.hora) - _slotDateTime(fechaIso, b.hora));

	for (const slot of slotsOrdenados) {
		const hora = String(slot.hora || '').slice(0, 5);
		if (!_slotCumpleAnticipacion(fechaIso, hora, config)) continue;
		if (_slotEstaExcluido(matricula, fechaIso, hora, excluir)) continue;
		if (!_slotCumplePreferencias(fechaIso, hora, preferir)) continue;

		return {
			dt: _slotDateTime(fechaIso, hora),
			matricula,
			medico: medicoNombre,
			fecha: fechaIso,
			hora,
			sector: slot.sector ? String(slot.sector).trim() : null,
			diaSemana: dia?.dia || _diaSemanaLegible(fechaIso),
		};
	}
	return null;
}

/**
 * Turno libre más cercano: recorre fechas en orden y consulta profesionales en paralelo por día.
 */
async function sugerirPrimerTurnoDisponible(especialidadValor, opciones = {}) {
	const config = await botConfigService.getBotConfig();
	const esp = Number(especialidadValor);
	if (!Number.isFinite(esp) || esp <= 0) return null;

	const excluir = _normalizarExclusiones(opciones.excluir);
	const preferir = _normalizarPreferencias(opciones.preferir);
	const { profesionales, especialidad } = await listarProfesionalesBot(esp);
	if (!profesionales.length) return null;

	const maxDias = _maxDiasBusquedaBot(config, preferir);
	const ordenados = [...profesionales]
		.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
		.slice(0, _maxProfesionalesBusqueda(config.reglas));
	const matriculaFiltro =
		opciones.matricula != null && Number.isFinite(Number(opciones.matricula))
			? Number(opciones.matricula)
			: null;
	const candidatos = matriculaFiltro
		? ordenados.filter((p) => Number(p.matricula) === matriculaFiltro)
		: ordenados;
	if (!candidatos.length) return null;
	const fechas = _fechasCandidatasBusqueda(maxDias, excluir, preferir);
	const deadline = Date.now() + _busquedaTurnoTimeoutMs(config.reglas);
	const concurrencia = _busquedaTurnoConcurrencia(config.reglas);

	for (const fechaIso of fechas) {
		if (Date.now() > deadline) break;

		const profsDia = await _profesionalesConLibresEnDia(fechaIso, esp, candidatos);
		if (!profsDia.length) continue;

		const turnos = await _mapEnLotes(profsDia, concurrencia, (prof) =>
			_primerSlotEnFecha(
				prof.matricula,
				prof.nombre,
				fechaIso,
				esp,
				config,
				excluir,
				preferir,
			),
		);
		const mejor = await _elegirMejorTurnoValido(turnos.filter(Boolean), esp);
		if (mejor) return _empaquetarTurnoSugerido(mejor, especialidad, esp);
	}

	return null;
}

async function listarCoberturasBot(q = '', limit = 20) {
	return agendaService.buscarClientes({ q: String(q || '').trim(), limit });
}

async function _resolverNumeroCuenta(input) {
	if (input == null) return null;
	const raw = String(input).trim();
	if (!raw) return null;
	if (/^\d+$/.test(raw)) {
		const n = Number(raw);
		if (!Number.isFinite(n)) return null;
		const rows = await executeQuery(
			`SELECT TOP 1 Valor, RTRIM(LTRIM(RazonSocial)) AS RazonSocial
			 FROM dbo.imClientes WHERE Valor = @p0`,
			[{ value: n, type: 'Int' }],
		);
		if (rows.length) {
			return {
				valor: Number(rows[0].Valor),
				nombre: String(rows[0].RazonSocial || '').trim() || String(n),
			};
		}
		return null;
	}
	const like = `%${raw.replace(/\s+/g, '%')}%`;
	const rows = await executeQuery(
		`SELECT TOP 5 Valor, RTRIM(LTRIM(RazonSocial)) AS RazonSocial
		 FROM dbo.imClientes
		 WHERE RazonSocial LIKE @p0 OR CAST(Valor AS VARCHAR(20)) LIKE @p0
		 ORDER BY CASE WHEN RazonSocial = @p1 THEN 0 ELSE 1 END, RazonSocial`,
		[
			{ value: like, type: 'VarChar' },
			{ value: raw, type: 'VarChar' },
		],
	);
	if (!rows.length) return null;
	return {
		valor: Number(rows[0].Valor),
		nombre: String(rows[0].RazonSocial || '').trim(),
	};
}

async function resolverCoberturaDesdeTexto(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase();
	if (!t) return null;
	if (/^(particular|sin cobertura|no tengo|ninguna|omitir|saltar)$/.test(t)) {
		return { valor: null, nombre: 'Particular', omitido: true };
	}
	return _resolverNumeroCuenta(texto);
}

async function actualizarCoberturaPacienteBot(idPaciente, cobertura) {
	const id = Number(idPaciente);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idPaciente inválido');
		e.statusCode = 400;
		throw e;
	}
	if (cobertura?.omitido) {
		return { idPaciente: id, cobertura: null, nombre: 'Particular', omitido: true };
	}
	const valor = cobertura?.valor != null ? Number(cobertura.valor) : null;
	if (!Number.isFinite(valor) || valor <= 0) {
		const e = new Error('Cobertura no reconocida');
		e.statusCode = 404;
		e.code = 'COBERTURA_NO_ENCONTRADA';
		throw e;
	}
	await executeQuery(
		`UPDATE dbo.imPacientes SET NumeroCuenta = @p0 WHERE IDPaciente = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: id, type: 'Int' },
		],
	);
	return {
		idPaciente: id,
		cobertura: valor,
		nombre: cobertura?.nombre || String(valor),
	};
}

async function mensajeListaCoberturas(limit = 12) {
	const rows = await listarCoberturasBot('', limit);
	if (!rows.length) return 'Escribí el nombre de tu obra social tal como figura en tu credencial.';
	const lineas = rows.map((r) => `• ${r.razonSocial}`).join('\n');
	return `Algunas coberturas registradas:\n${lineas}`;
}

async function mensajePasoCobertura(pasoCfg, idPaciente) {
	const pasoMsg =
		pasoCfg?.mensajeUsuario ||
		'Indicá tu obra social o cobertura médica. Si no tenés, escribí *Particular*.';
	let actual = '';
	if (idPaciente) {
		const rows = await executeQuery(
			`SELECT TOP 1 c.RazonSocial
			 FROM dbo.imPacientes p
			 LEFT JOIN dbo.imClientes c ON c.Valor = p.NumeroCuenta
			 WHERE p.IDPaciente = @p0`,
			[{ value: Number(idPaciente), type: 'Int' }],
		);
		if (rows[0]?.RazonSocial) {
			actual = `\n\nCobertura actual en ficha: *${String(rows[0].RazonSocial).trim()}*`;
		}
	}
	const lista = await mensajeListaCoberturas(10);
	return `${pasoMsg}${actual}\n\n${lista}`;
}

function coberturaPasoHabilitado(flujo, config) {
	return (
		config?.reglas?.preguntarCobertura === true &&
		(flujo || []).some((p) => p.id === 'ELEGIR_COBERTURA' && p.activo !== false)
	);
}

function mensajeAvisoBusquedaDisponibilidad(_opts = {}) {
	return 'Voy a consultar la disponibilidad. En breve te respondo.';
}

function mensajeSugerenciaTurno(sugerencia, pasoCfg, opts = {}) {
	if (!sugerencia) {
		return (
			pasoCfg?.mensajeUsuario ||
			'No hay turnos disponibles en los próximos días para esa especialidad. Probá con otra especialidad o contactá al centro.'
		);
	}
	let encabezado;
	if (opts.preferencia) {
		encabezado = `Para *${opts.preferencia}* encontré este turno en *${sugerencia.especialidadNombre || 'la especialidad'}*:`;
	} else if (opts.alternativa) {
		encabezado = `Encontré el *siguiente turno libre* en *${sugerencia.especialidadNombre || 'la especialidad'}*:`;
	} else {
		encabezado = `Te sugiero el *turno libre más cercano* en *${sugerencia.especialidadNombre || 'la especialidad'}*:`;
	}
	return [
		encabezado,
		'',
		`👨‍⚕️ *${sugerencia.medico}*`,
		`📅 *${sugerencia.diaSemana} ${sugerencia.fechaLegible}* a las *${sugerencia.hora}*`,
		'',
		pasoCfg?.mensajeUsuario ||
			'¿Confirmás este turno? Respondé *Sí* para reservarlo. Si no te sirve, decime qué día u horario no podés y busco el siguiente disponible.',
	].join('\n');
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
	listarCoberturasBot,
	resolverCoberturaDesdeTexto,
	actualizarCoberturaPacienteBot,
	mensajePasoCobertura,
	mensajeListaCoberturas,
	coberturaPasoHabilitado,
	validarSugerenciaTurno: _validarSugerenciaTurno,
	disponibilidadBot,
	resolverEspecialidadDesdeTexto,
	resolverProfesionalDesdeTexto,
	resolverEspecialidadConGpt,
	resolverEspecialidadInteligente,
	esConsultaListaEspecialidades,
	esConsultaListaProfesionales,
	mensajeEspecialidadesDisponibles,
	mensajeProfesionalesDisponibles,
	sugerirPrimerTurnoDisponible,
	mensajeAvisoBusquedaDisponibilidad,
	construirExclusionesRechazo,
	interpretarAjusteTurno,
	interpretarAjusteTurnoInteligente,
	mensajeSugerenciaTurno,
	reservarTurno,
	consultarTurnosPaciente,
	cancelarTurnoBot,
	obtenerTicketTurno,
	obtenerConfigCompleta,
};
