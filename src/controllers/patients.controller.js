const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');
const patientsService = require('../services/patients.service');

/**
 * Lista pacientes optimizado.
 * Query params:
 *  - limit: número de pacientes (default 200, max 5000) SIEMPRE se aplica
 *  - simple=1|true => columnas reducidas (backward compatible)
 *  - mode=complete | complete=1 => columnas completas (equivalente a simple=false)
 *  - withCount=1 => agrega totalCount (COUNT(*) separado)
 *  - order=name|id (default name)
 */
const obtenerPacientes = async (req, res) => {
	try {
		const { limit, withCount } = req.query;
		let parsedLimit = 200;
		if (limit) {
			const l = parseInt(limit, 10);
			if (!isNaN(l) && l > 0) parsedLimit = Math.min(l, 5000);
		}

		const pacientes = await patientsService.obtenerPacientes();

		if (withCount === '1' || withCount === 'true') {
			const totalCount = await patientsService.contarPacientes();
			return res.json({ success: true, totalCount, data: pacientes });
		}
		res.json({ success: true, data: pacientes });
	} catch (error) {
		console.error('Error al obtener pacientes:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los pacientes',
		});
	}
};

/**
 * Busca pacientes por ID, nombre, documento o número de historia clínica
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const buscarPacientes = async (req, res) => {
	try {
		const { searchTerm } = req.query;
		if (!searchTerm || !String(searchTerm).trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'Se requiere un término de búsqueda',
			});
		}
		const baseUrl = `${req.protocol}://${req.get('host')}`;
		const pacientes = await patientsService.buscarPacientes(searchTerm, baseUrl);
		res.json({ success: true, data: pacientes });
	} catch (error) {
		console.error('Error al buscar pacientes:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al buscar pacientes',
		});
	}
};

/**
 * Obtiene un paciente por su ID
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerPacientePorId = async (req, res) => {
	try {
		const id = parseInt(req.params.id);

		if (isNaN(id)) {
			return res.status(400).json({
				success: false,
				mensaje: 'ID inválido',
			});
		}

		const baseUrl = `${req.protocol}://${req.get('host')}`;
		const paciente = await patientsService.obtenerPacientePorId(id, baseUrl);

		if (!paciente) {
			return res.status(404).json({
				success: false,
				mensaje: 'Paciente no encontrado',
			});
		}

		console.log('[obtenerPacientePorId][debug] paciente:', paciente);
		res.json({
			success: true,
			data: paciente,
		});
	} catch (error) {
		console.error('Error al obtener paciente:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener el paciente',
		});
	}
};

/**
 * Crea un nuevo paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const crearPaciente = async (req, res) => {
	try {
		// --- Helpers & sanitización mínima (solo para creación) ---
		const strOrNull = (v) =>
			v === undefined || v === null || v === '' ? null : String(v);
		const numOrNull = (v) =>
			v === undefined || v === null || v === '' || isNaN(v) ? null : Number(v);
		const trimOrNull = (v) => (v ? String(v).trim() : null);
		const cleanUndefined = (v) => (v === 'undefined' ? null : v);
		const buildAbsolute = (relativePath) => {
			if (!relativePath) return null;
			if (/^https?:\/\//i.test(relativePath)) return relativePath;
			return `${req.protocol}://${req.get('host')}${relativePath}`;
		};

		// Parseo seguro de Trabajos (multipart)
		if (typeof req.body.Trabajos === 'string') {
			try {
				const p = JSON.parse(req.body.Trabajos);
				if (Array.isArray(p)) req.body.Trabajos = p;
			} catch (e) {
				console.warn('[crearPaciente] Trabajos inválido, se ignora:', e.message);
			}
		}

		// Destructuring principal
		const {
			ApellidoyNombre,
			TipoDocumento,
			NumeroDocumento,
			Sexo,
			NumeroHC,
			FechaNacimiento,
			HoraNacimiento,
			Domicilio,
			ValorLocalidad,
			Provincia,
			Nacionalidad,
			EstadoCivil,
			Religion,
			Raza,
			TelefonoParticular,
			TelefonoNegocio,
			TelefonoCelular,
			Mail,
			CUIT,
			NumeroAfiliado,
			nAfiliado,
			NumeroCuenta,
			Cobertura,
			LicenciaConducir,
			DadorOrganos,
			OrdenNacimiento,
			LugarNacimiento,
			FechaDefuncion,
			HoraDefuncion,
			IdiomaPrimario,
			Idioma,
			GrupoEtnico,
			EstadoMilitar,
			Ciudadania,
			SituacionLaboral,
			NivelEstudios,
			Ocupacion, // NUEVO: se guarda directamente en impacientes
		} = req.body;

		// Validación mínima requerida (NumeroHC ahora opcional)
		const nombreVal = (ApellidoyNombre || '').trim();
		const sexoVal = (Sexo || '').trim();
		const numeroHCVal = (NumeroHC || '').trim();
		if (!nombreVal || !sexoVal) {
			return res.status(400).json({
				success: false,
				mensaje: 'Faltan campos obligatorios (ApellidoyNombre y Sexo)',
			});
		}

		// Hora en formato HH:MM a entero HHMM
		let horaInt = null;
		if (HoraNacimiento && /^\d{1,2}:\d{2}$/.test(HoraNacimiento)) {
			const [h, m] = HoraNacimiento.split(':').map(Number);
			if (!isNaN(h) && !isNaN(m)) horaInt = h * 100 + m;
		}

		// Alias / derivaciones
		const numeroSSNIn = strOrNull(NumeroAfiliado || nAfiliado || req.body.NumeroSSN);
		const numeroCuentaIn = strOrNull(
			NumeroCuenta || Cobertura || req.body.CoberturaMedica,
		);
		const telNegocioIn = strOrNull(TelefonoNegocio || TelefonoCelular);
		let idiomaPrimarioIn = cleanUndefined(IdiomaPrimario || Idioma);
		if (idiomaPrimarioIn === '') idiomaPrimarioIn = null;

		const pacienteData = {
			ApellidoyNombre: nombreVal,
			TipoDocumento: strOrNull(TipoDocumento),
			NumeroDocumento: numOrNull(NumeroDocumento),
			Domicilio: trimOrNull(Domicilio),
			ValorLocalidad: numOrNull(ValorLocalidad),
			Provincia: numOrNull(Provincia),
			Nacionalidad: strOrNull(Nacionalidad),
			Sexo: sexoVal,
			NumeroHC: numeroHCVal || null,
			FechaNacimiento: FechaNacimiento ? convertirFechaAClarion(FechaNacimiento) : null,
			Hora: horaInt,
			CUIT: strOrNull(CUIT),
			EstadoCivil: strOrNull(EstadoCivil),
			Religion: strOrNull(Religion),
			Raza: numOrNull(Raza),
			TelefonoParticular: strOrNull(TelefonoParticular),
			TelefonoNegocio: telNegocioIn,
			TelefonoCelular: telNegocioIn, // espejo para front
			Mail: strOrNull(Mail),
			NumeroSSN: numeroSSNIn,
			nAfiliado: numeroSSNIn,
			NumeroCuenta: numeroCuentaIn,
			Cobertura: numeroCuentaIn,
			LicenciaConducir: strOrNull(LicenciaConducir),
			DadorOrganos: strOrNull(DadorOrganos),
			OrdenNacimiento: numOrNull(OrdenNacimiento),
			LugarNacimiento: strOrNull(LugarNacimiento),
			FechaDefuncion: FechaDefuncion ? convertirFechaAClarion(FechaDefuncion) : null,
			HoraDefuncion: HoraDefuncion ? convertirHoraAClarion(HoraDefuncion) : null,
			IdiomaPrimario: idiomaPrimarioIn,
			Idioma: idiomaPrimarioIn,
			GrupoEtnico:
				GrupoEtnico && String(GrupoEtnico).trim() !== ''
					? String(GrupoEtnico).trim().substring(0, 1).toUpperCase()
					: null,
			EstadoMilitar: cleanUndefined(EstadoMilitar),
			Ciudadania: cleanUndefined(Ciudadania),
			SituacionLaboral: strOrNull(SituacionLaboral),
			NivelDeEstudios: strOrNull(NivelEstudios),
			NivelEstudios: strOrNull(NivelEstudios),
			Ocupacion: strOrNull(Ocupacion),
		};

		if (Array.isArray(req.body.Trabajos)) pacienteData.Trabajos = req.body.Trabajos;

		// Normalización de claves de trabajos (el front puede enviar RazonSocialEmpresa)
		if (Array.isArray(pacienteData.Trabajos)) {
			pacienteData.Trabajos = pacienteData.Trabajos.map((t) => ({
				RazonSocial: t.RazonSocial || t.RazonSocialEmpresa || null,
				CuitEmpresa: t.CuitEmpresa || t.CUITEmpresa || null,
				DomicilioEmpresa: t.DomicilioEmpresa || t.DireccionEmpresa || null,
				TelefonoEmpresa: t.TelefonoEmpresa || t.TelEmpresa || null,
			}));
		}

		// Foto subida
		if (req.file) {
			pacienteData.FotoURL = `/media/patients/${req.file.filename}`;
		} else if (req.body.FotoURL) {
			pacienteData.FotoURL = req.body.FotoURL; // ya absoluta o relativa
		} else if (req.body.FotoBase64) {
			// Guardar imagen enviada como base64 (data URI o puro)
			try {
				const fs = require('fs');
				const path = require('path');
				let b64 = String(req.body.FotoBase64).trim();
				let mime = 'image/jpeg';
				const dataUriMatch = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
				if (dataUriMatch) {
					mime = dataUriMatch[1];
					b64 = dataUriMatch[2];
				}
				// Validar base64
				if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
					const ext = mime.split('/')[1] || 'jpg';
					const fname = `${Date.now()}-${Math.round(Math.random() * 1e9).toString(
						36,
					)}.${ext}`;
					const destDir = path.join(
						__dirname,
						'..',
						'..',
						'uploads',
						'patient-photos',
					);
					if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
					fs.writeFileSync(path.join(destDir, fname), Buffer.from(b64, 'base64'));
					pacienteData.FotoURL = `/media/patients/${fname}`;
				} else {
					console.warn('[crearPaciente] FotoBase64 inválida, se ignora');
				}
			} catch (e) {
				console.warn('[crearPaciente] error procesando FotoBase64:', e.message);
			}
		}

		try {
			console.log('[crearPaciente][in] keys:', Object.keys(req.body));
		} catch (_) {}
		try {
			console.log('[crearPaciente][normalized]', pacienteData);
		} catch (_) {}

		const nuevoPaciente = await patientsService.crearPaciente(pacienteData);

		if (nuevoPaciente) {
			// Asegurar alias de salida
			nuevoPaciente.TelefonoCelular =
				nuevoPaciente.TelefonoCelular || nuevoPaciente.TelefonoNegocio;
			nuevoPaciente.nAfiliado = nuevoPaciente.nAfiliado || nuevoPaciente.NumeroSSN;
			nuevoPaciente.Cobertura = nuevoPaciente.Cobertura || nuevoPaciente.NumeroCuenta;
			nuevoPaciente.Idioma = nuevoPaciente.Idioma || nuevoPaciente.IdiomaPrimario;
			nuevoPaciente.NivelEstudios =
				nuevoPaciente.NivelEstudios || nuevoPaciente.NivelDeEstudios;
			if (nuevoPaciente.FotoURL)
				nuevoPaciente.FotoURL = buildAbsolute(nuevoPaciente.FotoURL);
		}

		res.status(201).json({
			success: true,
			mensaje: 'Paciente creado con éxito',
			data: nuevoPaciente,
		});
	} catch (error) {
		console.error('Error al crear paciente:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al crear el paciente',
			error: error.message,
		});
	}
};

/**
 * Actualiza un paciente existente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const actualizarPaciente = async (req, res) => {
	try {
		const buildAbsolute = (relativePath) => {
			if (!relativePath) return null;
			if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
				return relativePath;
			}
			const protocol = req.protocol;
			const host = req.get('host');
			return `${protocol}://${host}${relativePath}`;
		};
		const id = parseInt(req.params.id);
		const {
			ApellidoyNombre,
			TipoDocumento,
			NumeroDocumento,
			Sexo,
			NumeroHC,
			FechaNacimiento,
			HoraNacimiento,
			Domicilio,
			ValorLocalidad,
			Provincia,
			Nacionalidad,
			EstadoCivil,
			Religion,
			Raza,
			TelefonoParticular,
			TelefonoNegocio,
			TelefonoCelular,
			Mail,
			CUIT,
			CoberturaMedica,
			NumeroAfiliado,
			nAfiliado,
			Cobertura,
			NumeroCuenta,
			ApellidoMadre,
			GrupoSangre,
			FactorSangre,
			LugarNacimiento,
			Ocupacion,
			Observaciones,
			SituacionLaboral,
			NivelDeEstudios, // puede venir ya con este nombre
			NivelEstudios, // alias del front
			DadorOrganos,
			IdiomaPrimario,
			Idioma,
			GrupoEtnico,
			Ciudadania,
			EstadoMilitar,
			LicenciaConducir,
			OrdenNacimiento,
			FechaDefuncion,
			HoraDefuncion,
			FotoURL,
		} = req.body;

		// Parseo seguro de Trabajos si viene como string (multipart/form-data)
		if (req.body && typeof req.body.Trabajos === 'string') {
			try {
				const parsed = JSON.parse(req.body.Trabajos);
				if (Array.isArray(parsed)) req.body.Trabajos = parsed;
			} catch (e) {
				console.warn('No se pudo parsear Trabajos (update):', e.message);
			}
		}

		// Alias / normalizaciones
		const numeroSSNIn = NumeroAfiliado || nAfiliado || req.body.NumeroSSN || null;
		const numeroCuentaIn = NumeroCuenta || Cobertura || CoberturaMedica || null;
		const telefonoNegocioIn = TelefonoNegocio || TelefonoCelular || null;
		let idiomaPrimarioIn = IdiomaPrimario || Idioma || null;
		if (idiomaPrimarioIn === 'undefined' || idiomaPrimarioIn === '')
			idiomaPrimarioIn = null;
		const sane = (v) => (v === 'undefined' ? null : v);

		if (isNaN(id)) {
			return res.status(400).json({
				success: false,
				mensaje: 'ID inválido',
			});
		}

		// Validación básica
		const nombreValUpd = (ApellidoyNombre || '').trim();
		const sexoValUpd = (Sexo || '').trim();
		if (!nombreValUpd || !sexoValUpd) {
			return res.status(400).json({
				success: false,
				mensaje: 'Faltan campos obligatorios (ApellidoyNombre y Sexo)',
			});
		}
		// NumeroHC ahora es opcional en update (coherente con create). Si viene string vacía la normalizamos a null/'' según servicio.

		// Convertir hora de formato HH:MM a HHMM (entero)
		let horaInt = null;
		if (HoraNacimiento) {
			const [horas, minutos] = HoraNacimiento.split(':').map(Number);
			if (!isNaN(horas) && !isNaN(minutos)) {
				horaInt = horas * 100 + minutos;
			}
		}

		// Validación de NumeroDocumento si viene con caracteres no numéricos (politica: rechazar)
		if (NumeroDocumento && !/^\d+$/.test(String(NumeroDocumento))) {
			return res.status(400).json({
				success: false,
				mensaje: 'NumeroDocumento debe ser numérico (solo dígitos)',
			});
		}

		// Preparar datos para la BD
		const pacienteData = {
			ApellidoyNombre,
			ApellidoMadre,
			TipoDocumento,
			NumeroDocumento,
			Domicilio,
			ValorLocalidad: ValorLocalidad ? parseInt(ValorLocalidad) : null,
			Provincia: Provincia ? parseInt(Provincia) : null,
			Nacionalidad,
			Sexo,
			NumeroHC,
			FechaNacimiento: FechaNacimiento ? convertirFechaAClarion(FechaNacimiento) : null,
			Hora: horaInt != null ? horaInt : null,
			CUIT: CUIT,
			EstadoCivil,
			Religion,
			Raza: Raza ? parseInt(Raza) : null,
			TelefonoParticular,
			TelefonoNegocio: telefonoNegocioIn,
			Mail: Mail,
			NumeroSSN: numeroSSNIn,
			NumeroCuenta: numeroCuentaIn,
			GrupoSangre,
			FactorSangre,
			LugarNacimiento,
			Ocupacion: Ocupacion ? parseInt(Ocupacion) : null,
			Observaciones,
			SituacionLaboral,
			NivelDeEstudios: NivelDeEstudios || NivelEstudios || null,
			DadorOrganos,
			IdiomaPrimario: idiomaPrimarioIn,
			GrupoEtnico,
			Ciudadania: sane(Ciudadania),
			EstadoMilitar: sane(EstadoMilitar),
			LicenciaConducir,
			OrdenNacimiento: OrdenNacimiento ? parseInt(OrdenNacimiento) : null,
			FechaDefuncion: FechaDefuncion ? convertirFechaAClarion(FechaDefuncion) : null,
			HoraDefuncion: HoraDefuncion ? convertirHoraAClarion(HoraDefuncion) : null,
			FotoURL: FotoURL && FotoURL !== 'undefined' ? FotoURL : null,
		};

		// Normalizar GrupoEtnico ahora código de 1 carácter (no numérico)
		if (pacienteData.GrupoEtnico !== undefined && pacienteData.GrupoEtnico !== null) {
			let ge = String(pacienteData.GrupoEtnico).trim();
			if (ge === '' || ge.toLowerCase() === 'undefined') ge = null;
			else ge = ge.substring(0, 1).toUpperCase();
			pacienteData.GrupoEtnico = ge;
		}
		if (pacienteData.Raza !== undefined && pacienteData.Raza !== null) {
			const rz = parseInt(pacienteData.Raza);
			pacienteData.Raza = isNaN(rz) ? null : rz;
		}
		if (
			pacienteData.ValorLocalidad !== undefined &&
			pacienteData.ValorLocalidad !== null
		) {
			const vl = parseInt(pacienteData.ValorLocalidad);
			pacienteData.ValorLocalidad = isNaN(vl) ? null : vl;
		}

		// Si se sube nueva foto en esta actualización, sobrescribir FotoURL antes de llamar al servicio
		if (req.file) {
			pacienteData.FotoURL = `/media/patients/${req.file.filename}`;
		} else if (req.body.FotoBase64 && !pacienteData.FotoURL) {
			// Procesar base64 solo si no vino archivo. Si ya había FotoURL no la reemplazamos a menos que quieras forzar.
			try {
				const fs = require('fs');
				const path = require('path');
				let b64 = String(req.body.FotoBase64).trim();
				let mime = 'image/jpeg';
				const dataUriMatch = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
				if (dataUriMatch) {
					mime = dataUriMatch[1];
					b64 = dataUriMatch[2];
				}
				if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
					const ext = mime.split('/')[1] || 'jpg';
					const fname = `${Date.now()}-${Math.round(Math.random() * 1e9).toString(
						36,
					)}.${ext}`;
					const destDir = path.join(
						__dirname,
						'..',
						'..',
						'uploads',
						'patient-photos',
					);
					if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
					fs.writeFileSync(path.join(destDir, fname), Buffer.from(b64, 'base64'));
					pacienteData.FotoURL = `/media/patients/${fname}`;
				} else {
					console.warn('[actualizarPaciente] FotoBase64 inválida, se ignora');
				}
			} catch (e) {
				console.warn('[actualizarPaciente] error procesando FotoBase64:', e.message);
			}
		}
		// Asegurar alias coherente para NivelDeEstudios
		if (!pacienteData.NivelDeEstudios && pacienteData.NivelEstudios) {
			pacienteData.NivelDeEstudios = pacienteData.NivelEstudios;
		}
		try {
			console.log('[actualizarPaciente][in] FotoURL body:', FotoURL);
		} catch (_) {}
		if (Array.isArray(req.body.Trabajos)) {
			pacienteData.Trabajos = req.body.Trabajos;
		}
		// Normalizar claves de trabajos también en update
		if (Array.isArray(pacienteData.Trabajos)) {
			pacienteData.Trabajos = pacienteData.Trabajos.map((t) => ({
				ID: t.ID, // mantener si viene para reemplazo (el servicio hará delete+insert, se ignora)
				RazonSocial: t.RazonSocial || t.RazonSocialEmpresa || null,
				CuitEmpresa: t.CuitEmpresa || t.CUITEmpresa || null,
				DomicilioEmpresa: t.DomicilioEmpresa || t.DireccionEmpresa || null,
				TelefonoEmpresa: t.TelefonoEmpresa || t.TelEmpresa || null,
			}));
		}

		const pacienteActualizado = await patientsService.actualizarPaciente(id, pacienteData);
		if (pacienteActualizado) {
			if (!pacienteActualizado.TelefonoCelular && pacienteActualizado.TelefonoNegocio)
				pacienteActualizado.TelefonoCelular = pacienteActualizado.TelefonoNegocio;
			if (pacienteActualizado.NumeroSSN && !pacienteActualizado.nAfiliado)
				pacienteActualizado.nAfiliado = pacienteActualizado.NumeroSSN;
			if (pacienteActualizado.NumeroCuenta && !pacienteActualizado.Cobertura)
				pacienteActualizado.Cobertura = pacienteActualizado.NumeroCuenta;
			if (pacienteActualizado.IdiomaPrimario && !pacienteActualizado.Idioma)
				pacienteActualizado.Idioma = pacienteActualizado.IdiomaPrimario;
			if (pacienteActualizado.NivelDeEstudios && !pacienteActualizado.NivelEstudios)
				pacienteActualizado.NivelEstudios = pacienteActualizado.NivelDeEstudios;
		}

		if (req.file) {
			pacienteActualizado.FotoURL = buildAbsolute(
				`/media/patients/${req.file.filename}`,
			);
		} else if (pacienteActualizado && pacienteActualizado.FotoURL) {
			pacienteActualizado.FotoURL = buildAbsolute(pacienteActualizado.FotoURL);
		}

		if (!pacienteActualizado) {
			return res.status(404).json({
				success: false,
				mensaje: 'Paciente no encontrado',
			});
		}

		res.json({
			success: true,
			mensaje: 'Paciente actualizado con éxito',
			data: pacienteActualizado,
		});
		try {
			console.log('[actualizarPaciente][response]', {
				IDPaciente: pacienteActualizado?.IDPaciente,
				IdiomaPrimario: pacienteActualizado?.IdiomaPrimario,
				GrupoEtnico: pacienteActualizado?.GrupoEtnico,
				SituacionLaboral: pacienteActualizado?.SituacionLaboral,
				NivelDeEstudios: pacienteActualizado?.NivelDeEstudios,
				FotoURL: pacienteActualizado?.FotoURL,
			});
		} catch (_) {}
	} catch (error) {
		console.error('Error al actualizar paciente:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al actualizar el paciente',
		});
	}
};

/**
 * Elimina un paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const eliminarPaciente = async (req, res) => {
	try {
		const id = parseInt(req.params.id);

		if (isNaN(id)) {
			return res.status(400).json({
				success: false,
				mensaje: 'ID inválido',
			});
		}

		const eliminado = await patientsService.eliminarPaciente(id);

		if (!eliminado) {
			return res.status(404).json({
				success: false,
				mensaje: 'Paciente no encontrado',
			});
		}

		res.json({
			success: true,
			mensaje: 'Paciente eliminado con éxito',
		});
	} catch (error) {
		console.error('Error al eliminar paciente:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al eliminar el paciente',
		});
	}
};

/**
 * Obtiene todas las tablas de referencia necesarias para el formulario de pacientes
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerTablasReferencia = async (req, res) => {
	try {
		const tablasReferencia = await patientsService.obtenerTablasReferencia();

		res.json({
			success: true,
			data: tablasReferencia,
		});
	} catch (error) {
		console.error('Error al obtener tablas de referencia:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener las tablas de referencia',
		});
	}
};

/**
 * Obtiene los datos de una visita por su número
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerVisitaPorNumero = async (req, res) => {
	try {
		const numeroVisita = req.params.numeroVisita;
		// Eliminado console.log de debug: 'Solicitando visita con número'

		if (!numeroVisita) {
			// Eliminado console.log de debug para número de visita faltante
			return res.status(400).json({
				success: false,
				mensaje: 'Se requiere el número de visita',
			});
		}

		// Intentar convertir a entero para validar
		const numeroVisitaInt = parseInt(numeroVisita, 10);
		if (isNaN(numeroVisitaInt)) {
			console.error(
				`Error: El número de visita '${numeroVisita}' no es un número válido`,
			);
			return res.status(400).json({
				success: false,
				mensaje: `El número de visita '${numeroVisita}' no es un número válido`,
			});
		}

		const visita = await patientsService.obtenerVisitaPorNumero(numeroVisitaInt);

		if (!visita) {
			return res.status(404).json({
				success: false,
				mensaje: 'Visita no encontrada',
			});
		}

		// Eliminado console.log de debug: 'Enviando datos de visita'
		res.json({
			success: true,
			data: visita,
		});
	} catch (error) {
		console.error('Error al obtener visita:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los datos de la visita',
			error: error.message,
		});
	}
};

/**
 * Registra el egreso de un paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const registrarEgresoPaciente = async (req, res) => {
	try {
		const egresoData = req.body;

		// Validación básica
		if (
			!egresoData.numeroVisita ||
			!egresoData.fechaEgreso ||
			!egresoData.horaEgreso ||
			!egresoData.disposicionEgreso
		) {
			return res.status(400).json({
				success: false,
				mensaje: 'Faltan campos obligatorios para el egreso',
			});
		}

		// Obtener la visita para validar
		const visitaExistente = await patientsService.obtenerVisitaPorNumero(
			egresoData.numeroVisita,
		);

		if (!visitaExistente) {
			return res.status(404).json({
				success: false,
				mensaje: 'Visita no encontrada',
			});
		}

		// Validar que la fecha de egreso sea posterior o igual a la fecha de admisión
		const fechaEgreso = new Date(egresoData.fechaEgreso);
		const fechaAdmision = new Date(visitaExistente.fechaAdmision);

		if (fechaEgreso < fechaAdmision) {
			return res.status(400).json({
				success: false,
				mensaje: 'La fecha de egreso no puede ser anterior a la fecha de admisión',
			});
		}

		// Si las fechas son iguales, validar las horas
		if (fechaEgreso.getTime() === fechaAdmision.getTime()) {
			const horaEgresoArr = egresoData.horaEgreso.split(':').map(Number);
			const horaAdmisionArr = visitaExistente.horaAdmision.split(':').map(Number);

			// Convertir a minutos para comparar fácilmente
			const minutosEgreso = horaEgresoArr[0] * 60 + horaEgresoArr[1];
			const minutosAdmision = horaAdmisionArr[0] * 60 + horaAdmisionArr[1];

			if (minutosEgreso <= minutosAdmision) {
				return res.status(400).json({
					success: false,
					mensaje: 'La hora de egreso debe ser posterior a la hora de admisión',
				});
			}
		}

		const resultado = await patientsService.registrarEgresoPaciente(egresoData);

		res.json({
			success: true,
			mensaje: 'Egreso registrado con éxito',
			data: resultado,
		});
	} catch (error) {
		console.error('Error al registrar egreso:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al registrar el egreso',
		});
	}
};

// Nuevo: devuelve las tres listas en paralelo (SituacionLaboral, NivelEstudios, Ocupacion)
const obtenerCatalogosLaborales = async (req, res) => {
	try {
		const { situaciones, niveles, ocupaciones } =
			await patientsService.getLaboralCatalogs();
		res.json({
			success: true,
			data: {
				situacionLaboral: situaciones,
				nivelesEstudios: niveles,
				ocupaciones,
			},
		});
	} catch (error) {
		console.error('Error al obtener catálogos laborales:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los catálogos laborales',
		});
	}
};
module.exports = {
	obtenerPacientes,
	buscarPacientes,
	obtenerPacientePorId,
	crearPaciente,
	actualizarPaciente,
	eliminarPaciente,
	obtenerVisitaPorNumero,
	registrarEgresoPaciente,
	obtenerTablasReferencia,
	obtenerCatalogosLaborales,
};
