/**
 * Servicio para gestión de pacientes (versión modernizada con FotoURL y baseUrl)
 */
const { executeQuery } = require('../models/db');
const { insertJobs, getJobsByPatient, replaceJobs } = require('./patientJobs.service');
const { v4: uuidv4 } = require('uuid');

// Flags de cache para evitar repetir DDL constantemente
let searchIndexesEnsured = false;
let extraColumnsEnsured = false;

// Crea índices básicos si no existen para acelerar búsquedas (solo primera vez)
const ensureSearchIndexes = async () => {
	if (searchIndexesEnsured) return;
	try {
		const ddl = `
		IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_impacientes_NumeroDocumento')
			CREATE INDEX IX_impacientes_NumeroDocumento ON impacientes(NumeroDocumento);
		IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_impacientes_NumeroHC')
			CREATE INDEX IX_impacientes_NumeroHC ON impacientes(NumeroHC);
		IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_impacientes_ApellidoyNombre')
			CREATE INDEX IX_impacientes_ApellidoyNombre ON impacientes(ApellidoyNombre);
		`;
		await executeQuery(ddl);
	} catch (e) {
		console.warn('No se pudieron crear/verificar índices de búsqueda:', e.message);
	} finally {
		searchIndexesEnsured = true;
	}
};

// Garantiza la existencia de columnas requeridas (idempotente)
const ensureExtraColumns = async () => {
	if (extraColumnsEnsured) return;
	try {
		const columns = [
			{ name: 'FotoURL', type: 'NVARCHAR(255) NULL' },
			{ name: 'LicenciaConducir', type: 'NVARCHAR(40) NULL' },
			{ name: 'DadorOrganos', type: 'NVARCHAR(1) NULL' },
			{ name: 'OrdenNacimiento', type: 'INT NULL' },
			{ name: 'LugarNacimiento', type: 'NVARCHAR(80) NULL' },
			{ name: 'FechaDefuncion', type: 'INT NULL' },
			{ name: 'HoraDefuncion', type: 'INT NULL' },
			{ name: 'IdiomaPrimario', type: 'NVARCHAR(10) NULL' },
			// GrupoEtnico: catálogo usa códigos de 1 carácter (letra), cambiar a NVARCHAR(1)
			{ name: 'GrupoEtnico', type: 'NVARCHAR(1) NULL' },
			{ name: 'EstadoMilitar', type: 'NVARCHAR(5) NULL' },
			{ name: 'Ciudadania', type: 'NVARCHAR(40) NULL' },
			{ name: 'SituacionLaboral', type: 'NVARCHAR(5) NULL' },
			{ name: 'NivelDeEstudios', type: 'NVARCHAR(5) NULL' },
		];
		for (const col of columns) {
			// Crear si no existe
			const ddl = `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'impacientes' AND COLUMN_NAME = '${col.name}')\nBEGIN\nALTER TABLE impacientes ADD ${col.name} ${col.type};\nEND`;
			await executeQuery(ddl);
			// Upgrade de longitud para IdiomaPrimario si existe con menor tamaño (ej: NVARCHAR(2))
			if (col.name === 'IdiomaPrimario') {
				const checkLenQuery = `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='impacientes' AND COLUMN_NAME='IdiomaPrimario'`;
				const lenRows = await executeQuery(checkLenQuery);
				const len = lenRows && lenRows[0] ? lenRows[0].len : null;
				if (len && len < 10) {
					try {
						await executeQuery(
							`ALTER TABLE impacientes ALTER COLUMN IdiomaPrimario NVARCHAR(10) NULL`,
						);
						console.log('Columna IdiomaPrimario ampliada a NVARCHAR(10)');
					} catch (e) {
						console.warn('No se pudo ampliar IdiomaPrimario:', e.message);
					}
				}
			} else if (col.name === 'GrupoEtnico') {
				// Convertir a NVARCHAR(1) si actualmente es numérico (int)
				try {
					const typeRows = await executeQuery(
						`SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='impacientes' AND COLUMN_NAME='GrupoEtnico'`,
					);
					const dtype = typeRows[0]?.DATA_TYPE?.toLowerCase();
					if (dtype && dtype !== 'nvarchar') {
						try {
							await executeQuery(
								`ALTER TABLE impacientes ALTER COLUMN GrupoEtnico NVARCHAR(1) NULL`,
							);
							console.log('Columna GrupoEtnico convertida a NVARCHAR(1)');
						} catch (e2) {
							console.warn(
								'No se pudo convertir GrupoEtnico a NVARCHAR(1):',
								e2.message,
							);
						}
					}
				} catch (eg) {
					console.warn('Chequeo/upgrade GrupoEtnico falló:', eg.message);
				}
			}
		}
	} catch (err) {
		console.error('No se pudo verificar/crear columnas extra:', err.message);
	} finally {
		extraColumnsEnsured = true;
	}

	// Upgrades de tipos para teléfonos (evitar overflow al intentar convertir a INT en tablas antiguas)
	try {
		const telCols = ['TelefonoParticular', 'TelefonoNegocio'];
		for (const tcol of telCols) {
			const typeRows = await executeQuery(
				`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='impacientes' AND COLUMN_NAME='${tcol}'`,
			);
			const dtype = typeRows[0]?.DATA_TYPE;
			if (dtype && dtype.toLowerCase() !== 'nvarchar') {
				try {
					await executeQuery(
						`ALTER TABLE impacientes ALTER COLUMN ${tcol} NVARCHAR(20) NULL`,
					);
					console.log(`Columna ${tcol} convertida a NVARCHAR(20)`);
				} catch (e) {
					console.warn(`No se pudo convertir ${tcol} a NVARCHAR(20):`, e.message);
				}
			}
		}
	} catch (e) {
		console.warn('Chequeo/upgrade de columnas de teléfono falló:', e.message);
	}

	// Aumentar longitud de EstadoCivil a NVARCHAR(20) si es menor (algunos entornos tienen 1 caracter)
	try {
		const estadoCivilLenRows = await executeQuery(
			`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='impacientes' AND COLUMN_NAME='EstadoCivil'`,
		);
		const ecLen =
			estadoCivilLenRows && estadoCivilLenRows[0] ? estadoCivilLenRows[0].len : null;
		if (ecLen && ecLen < 20) {
			try {
				await executeQuery(
					`ALTER TABLE impacientes ALTER COLUMN EstadoCivil NVARCHAR(20) NULL`,
				);
				console.log('Columna EstadoCivil ampliada a NVARCHAR(20)');
			} catch (e) {
				console.warn('No se pudo ampliar EstadoCivil:', e.message);
			}
		}
	} catch (e2) {
		console.warn('Chequeo de EstadoCivil falló:', e2.message);
	}
};

// Alias para compatibilidad con nombre anterior
const ensureFotoURLColumn = ensureExtraColumns;

// Normaliza un resultado (o lista) agregando baseUrl a FotoURL relativa
const mapFotoURL = (rows, baseUrl) => {
	if (!baseUrl) return rows;
	return rows.map((r) => ({
		...r,
		// Normalizamos rutas antiguas que apuntaban a /uploads/<archivo> cuando ahora servimos /media/patients
		FotoURL: r.FotoURL
			? /^https?:\/\//i.test(r.FotoURL)
				? r.FotoURL
				: r.FotoURL.startsWith('/media/patients/')
				? `${baseUrl}${r.FotoURL}`
				: r.FotoURL.startsWith('/uploads/')
				? // Compatibilidad: si quedó en carpeta vieja pero queremos servirla igual
				  `${baseUrl}${r.FotoURL.replace('/uploads/', '/media/patients/')}`
				: `${baseUrl}${r.FotoURL}`
			: null,
	}));
};

/** Lista pacientes */
const obtenerPacientes = async (baseUrl, { limit = 200, simple = false } = {}) => {
	try {
		await ensureExtraColumns();
		let query;
		if (limit === null || limit === undefined) {
			// Sin límite explícito
			query = `${
				simple
					? `SELECT p.IDPaciente, p.ApellidoyNombre`
					: `SELECT 
				p.IDPaciente,
				p.NumeroDocumento,
				p.ApellidoyNombre,
				p.Domicilio,
				p.Sexo,
				p.NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento < 0 OR p.FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY, p.FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				p.EstadoCivil,
				c.RazonSocial as Cobertura,
				p.ValorLocalidad,
				p.Provincia,
				p.Nacionalidad,
				p.CUIT,
				p.TelefonoParticular,
				p.TelefonoNegocio,
				p.TelefonoNegocio AS TelefonoCelular,
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.NumeroSSN AS nAfiliado,
				p.FotoURL,
				p.LicenciaConducir,
				p.DadorOrganos,
				p.OrdenNacimiento,
				p.LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaDefuncion IS NULL OR p.FechaDefuncion < 0 OR p.FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaDefuncion,'1800-12-28') END,23) AS FechaDefuncion,
				p.HoraDefuncion,
				p.IdiomaPrimario,
				p.IdiomaPrimario AS Idioma,
				p.GrupoEtnico,
				p.EstadoMilitar,
				p.Ciudadania,
				p.SituacionLaboral,
				p.NivelDeEstudios,
				p.NivelDeEstudios AS NivelEstudios`
			}
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			ORDER BY p.ApellidoyNombre`;
		} else {
			const safeLimit = isNaN(limit)
				? 200
				: Math.min(Math.max(parseInt(limit), 1), 5000);
			query = `${
				simple
					? `SELECT TOP (${safeLimit}) p.IDPaciente, p.ApellidoyNombre`
					: `SELECT TOP (${safeLimit})
				p.IDPaciente,
				p.NumeroDocumento,
				p.ApellidoyNombre,
				p.Domicilio,
				p.Sexo,
				p.NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento < 0 OR p.FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY, p.FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				p.EstadoCivil,
				c.RazonSocial as Cobertura,
				p.ValorLocalidad,
				p.Provincia,
				p.Nacionalidad,
				p.CUIT,
				p.TelefonoParticular,
				p.TelefonoNegocio,
				p.TelefonoNegocio AS TelefonoCelular,
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.NumeroSSN AS nAfiliado,
				p.FotoURL,
				p.LicenciaConducir,
				p.DadorOrganos,
				p.OrdenNacimiento,
				p.LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaDefuncion IS NULL OR p.FechaDefuncion < 0 OR p.FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaDefuncion,'1800-12-28') END,23) AS FechaDefuncion,
				p.HoraDefuncion,
				p.IdiomaPrimario,
				p.IdiomaPrimario AS Idioma,
				p.GrupoEtnico,
				p.EstadoMilitar,
				p.Ciudadania,
				p.SituacionLaboral,
				p.NivelDeEstudios,
				p.NivelDeEstudios AS NivelEstudios`
			}
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			ORDER BY p.ApellidoyNombre`;
		}
		let result = await executeQuery(query);
		result = mapFotoURL(result, baseUrl);
		return result;
	} catch (error) {
		console.error('Error al obtener pacientes de la base de datos:', error);
		throw error;
	}
};

/** Paciente por ID */
const obtenerPacientePorId = async (id, baseUrl) => {
	try {
		await ensureExtraColumns();
		const query = `
			SELECT 
				p.IDPaciente,
				p.NumeroDocumento,
				p.ApellidoyNombre,
				p.Domicilio,
				p.Sexo,
				p.NumeroHC,
				CONVERT(VARCHAR(10), 
					CASE 
						WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento < 0 OR p.FechaNacimiento > 1000000 THEN NULL
						ELSE DATEADD(DAY, p.FechaNacimiento, '1800-12-28')
					END, 23) AS FechaNacimiento,
				p.EstadoCivil,
				p.TipoDocumento,
				p.ValorLocalidad,
				p.Provincia,
				p.Nacionalidad,
				p.CUIT,
				p.TelefonoParticular,
				p.TelefonoNegocio,
				p.TelefonoNegocio AS TelefonoCelular,
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.NumeroSSN AS nAfiliado,
				c.RazonSocial AS Cobertura,
				p.FotoURL,
				p.LicenciaConducir,
				p.DadorOrganos,
				p.OrdenNacimiento,
				p.LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaDefuncion IS NULL OR p.FechaDefuncion < 0 OR p.FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaDefuncion,'1800-12-28') END,23) AS FechaDefuncion,
				p.HoraDefuncion,
				p.IdiomaPrimario,
				p.Raza,
				p.Religion,
				p.GrupoEtnico,
				p.EstadoMilitar,
				p.Ciudadania,
				p.SituacionLaboral,
				p.NivelDeEstudios,
				p.NivelDeEstudios AS NivelEstudios
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			WHERE p.IDPaciente = @p0`;
		const parametros = [{ value: id }];
		const rows = await executeQuery(query, parametros);
		if (!rows.length) return null;
		const paciente = mapFotoURL(rows, baseUrl)[0];
		// Adjuntar trabajos si existen
		try {
			paciente.Trabajos = await getJobsByPatient(paciente.IDPaciente);
		} catch (e) {
			console.warn('No se pudieron obtener trabajos del paciente', e.message);
		}
		return paciente;
	} catch (error) {
		console.error(`Error al obtener paciente con ID ${id}:`, error);
		throw error;
	}
};

/** Búsqueda parametrizada */
const buscarPacientes = async (searchTerm = '', baseUrl) => {
	try {
		const term = String(searchTerm).trim();
		if (!term) return await obtenerPacientes(baseUrl);
		await ensureExtraColumns();
		// Crear índices si no existen (solo primera vez)
		await ensureSearchIndexes();
		const isNumeric = /^\d+$/.test(term);
		let query;
		let params = [];
		if (isNumeric) {
			// Búsqueda específica numérica usando igualdad (aprovecha índices) + opcional nombre
			query = `SELECT TOP 100
				p.IDPaciente, p.NumeroDocumento, p.ApellidoyNombre, p.Domicilio, p.Sexo, p.NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento < 0 OR p.FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaNacimiento,'1800-12-28') END,23) AS FechaNacimiento,
				p.EstadoCivil, c.RazonSocial AS Cobertura, p.ValorLocalidad, p.Provincia, p.Nacionalidad, p.CUIT,
				p.TelefonoParticular, p.TelefonoNegocio, p.TelefonoNegocio AS TelefonoCelular, p.Mail,
				p.NumeroCuenta, p.NumeroSSN, p.NumeroSSN AS nAfiliado, p.FotoURL, p.LicenciaConducir,
				p.DadorOrganos, p.OrdenNacimiento, p.LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaDefuncion IS NULL OR p.FechaDefuncion < 0 OR p.FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaDefuncion,'1800-12-28') END,23) AS FechaDefuncion,
				p.HoraDefuncion, p.IdiomaPrimario, p.GrupoEtnico, p.EstadoMilitar, p.Ciudadania,
				p.SituacionLaboral, p.NivelDeEstudios, p.NivelDeEstudios AS NivelEstudios
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			WHERE p.IDPaciente = @p0 OR p.NumeroDocumento = @p0 OR p.NumeroHC = @p0 OR p.ApellidoyNombre LIKE @p1
			ORDER BY p.IDPaciente DESC`;
			params = [{ value: Number(term) }, { value: `%${term}%` }];
		} else {
			// Texto: solo sobre nombre + LIKE en documento/historia si empieza por dígitos (sin CAST)
			const digitsPrefix = term.match(/^(\d{3,})/); // prefijo numérico útil
			query = `SELECT TOP 100
				p.IDPaciente, p.NumeroDocumento, p.ApellidoyNombre, p.Domicilio, p.Sexo, p.NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento < 0 OR p.FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaNacimiento,'1800-12-28') END,23) AS FechaNacimiento,
				p.EstadoCivil, c.RazonSocial AS Cobertura, p.ValorLocalidad, p.Provincia, p.Nacionalidad, p.CUIT,
				p.TelefonoParticular, p.TelefonoNegocio, p.TelefonoNegocio AS TelefonoCelular, p.Mail,
				p.NumeroCuenta, p.NumeroSSN, p.NumeroSSN AS nAfiliado, p.FotoURL, p.LicenciaConducir,
				p.DadorOrganos, p.OrdenNacimiento, p.LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN p.FechaDefuncion IS NULL OR p.FechaDefuncion < 0 OR p.FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY,p.FechaDefuncion,'1800-12-28') END,23) AS FechaDefuncion,
				p.HoraDefuncion, p.IdiomaPrimario, p.GrupoEtnico, p.EstadoMilitar, p.Ciudadania,
				p.SituacionLaboral, p.NivelDeEstudios, p.NivelDeEstudios AS NivelEstudios
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			WHERE p.ApellidoyNombre LIKE @p0
			${digitsPrefix ? ' OR p.NumeroDocumento LIKE @p1 OR p.NumeroHC LIKE @p1' : ''}
			ORDER BY p.ApellidoyNombre`;
			params.push({ value: `%${term}%` });
			if (digitsPrefix) params.push({ value: `${digitsPrefix[1]}%` });
		}
		let rows = await executeQuery(query, params);
		rows = mapFotoURL(rows, baseUrl);
		return rows;
	} catch (error) {
		console.error('Error al buscar pacientes:', error);
		throw error;
	}
};

/** Crear paciente */
const crearPaciente = async (pacienteData) => {
	try {
		await ensureExtraColumns();
		const limitLength = (str, max) =>
			str == null ? null : str.toString().substring(0, max);
		// Fallbacks alias del front (acepta TelefonoCelular, nAfiliado, Cobertura)
		const telefonoNegocioIn = pacienteData.TelefonoNegocio ?? pacienteData.TelefonoCelular;
		const numeroSSNIn = pacienteData.NumeroSSN ?? pacienteData.nAfiliado;
		const numeroCuentaIn = pacienteData.NumeroCuenta ?? pacienteData.Cobertura;

		const sd = {
			ListaIDPaciente: limitLength(pacienteData.ListaIDPaciente ?? uuidv4(), 80),
			IDPacienteAlt:
				pacienteData.IDPacienteAlt != null ? Number(pacienteData.IDPacienteAlt) : 0,
			ApellidoyNombre: limitLength(pacienteData.ApellidoyNombre, 40) || '',
			TipoDocumento: limitLength(pacienteData.TipoDocumento, 3) || null,
			NumeroDocumento:
				pacienteData.NumeroDocumento != null &&
				/^\d+$/.test(String(pacienteData.NumeroDocumento))
					? Number(pacienteData.NumeroDocumento)
					: null,
			Domicilio: limitLength(pacienteData.Domicilio, 80) || null,
			ValorLocalidad:
				pacienteData.ValorLocalidad != null
					? Number(pacienteData.ValorLocalidad)
					: null,
			Provincia: pacienteData.Provincia != null ? Number(pacienteData.Provincia) : null,
			Nacionalidad: limitLength(pacienteData.Nacionalidad, 2) || null,
			Sexo: limitLength(pacienteData.Sexo, 1) || null,
			NumeroHC: limitLength(pacienteData.NumeroHC, 20) || null,
			FechaNacimiento: pacienteData.FechaNacimiento || null,
			Hora: pacienteData.Hora != null ? Number(pacienteData.Hora) : null,
			CUIT: limitLength(pacienteData.CUIT, 13) || null,
			EstadoCivil: limitLength(pacienteData.EstadoCivil, 20) || null,
			Religion: limitLength(pacienteData.Religion, 3) || null,
			Raza: pacienteData.Raza != null ? Number(pacienteData.Raza) : null,
			TelefonoParticular: limitLength(pacienteData.TelefonoParticular, 20) || null,
			TelefonoNegocio: limitLength(telefonoNegocioIn, 20) || null,
			Mail: limitLength(pacienteData.Mail, 80) || null,
			NumeroSSN: limitLength(numeroSSNIn, 40) || null,
			NumeroCuenta: limitLength(numeroCuentaIn, 40) || null,
			FotoURL: limitLength(pacienteData.FotoURL, 255) || null,
			LicenciaConducir: limitLength(pacienteData.LicenciaConducir, 40) || null,
			DadorOrganos: limitLength(pacienteData.DadorOrganos, 1) || null,
			OrdenNacimiento:
				pacienteData.OrdenNacimiento != null
					? Number(pacienteData.OrdenNacimiento)
					: null,
			LugarNacimiento: limitLength(pacienteData.LugarNacimiento, 80) || null,
			FechaDefuncion: pacienteData.FechaDefuncion || null,
			HoraDefuncion: pacienteData.HoraDefuncion || null,
			IdiomaPrimario:
				limitLength(pacienteData.IdiomaPrimario || pacienteData.Idioma, 10) || null,
			GrupoEtnico:
				pacienteData.GrupoEtnico != null
					? limitLength(String(pacienteData.GrupoEtnico).trim(), 1)
					: null,
			EstadoMilitar: limitLength(pacienteData.EstadoMilitar, 5) || null,
			Ciudadania: limitLength(pacienteData.Ciudadania, 40) || null,
			SituacionLaboral: limitLength(pacienteData.SituacionLaboral, 5) || null,
			NivelDeEstudios:
				limitLength(pacienteData.NivelDeEstudios || pacienteData.NivelEstudios, 5) ||
				null,
		};

		try {
			console.log('[crearPaciente][debug] datos normalizados (sd):', JSON.stringify(sd));
		} catch (_) {}

		const insert = `
			INSERT INTO impacientes (
				ListaIDPaciente, IDPacienteAlt, ApellidoyNombre, TipoDocumento, NumeroDocumento,
				Domicilio, ValorLocalidad, Provincia, Nacionalidad, Sexo,
				NumeroHC, FechaNacimiento, Hora, CUIT, EstadoCivil,
				Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail,
				NumeroSSN, NumeroCuenta, FotoURL, LicenciaConducir, DadorOrganos, OrdenNacimiento,
				LugarNacimiento, FechaDefuncion, HoraDefuncion, IdiomaPrimario, GrupoEtnico, EstadoMilitar, Ciudadania, SituacionLaboral, NivelDeEstudios
			) VALUES (
				@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,
				@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,
				@p20,@p21,@p22,@p23,@p24,@p25,@p26,@p27,@p28,@p29,
				@p30,@p31,@p32,@p33,@p34
			);
			SELECT 
				IDPaciente, ListaIDPaciente, IDPacienteAlt, ApellidoyNombre, TipoDocumento, NumeroDocumento,
				Domicilio, ValorLocalidad, Provincia, Nacionalidad, Sexo, NumeroHC,
				CONVERT(VARCHAR(10), 
					CASE WHEN FechaNacimiento IS NULL OR FechaNacimiento < 0 OR FechaNacimiento > 1000000 THEN NULL
						 ELSE DATEADD(DAY, FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				Hora, CUIT, EstadoCivil, Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail, NumeroSSN, NumeroCuenta, FotoURL,
				LicenciaConducir, DadorOrganos, OrdenNacimiento, LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN FechaDefuncion IS NULL OR FechaDefuncion < 0 OR FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY, FechaDefuncion, '1800-12-28') END, 23) AS FechaDefuncion,
				HoraDefuncion, IdiomaPrimario, GrupoEtnico, EstadoMilitar, Ciudadania, SituacionLaboral, NivelDeEstudios, NivelDeEstudios AS NivelEstudios
			FROM impacientes WHERE IDPaciente = SCOPE_IDENTITY();`;

		const params = [
			{ value: sd.ListaIDPaciente },
			{ value: sd.IDPacienteAlt },
			{ value: sd.ApellidoyNombre },
			{ value: sd.TipoDocumento },
			{ value: sd.NumeroDocumento },
			{ value: sd.Domicilio },
			{ value: sd.ValorLocalidad },
			{ value: sd.Provincia },
			{ value: sd.Nacionalidad },
			{ value: sd.Sexo },
			{ value: sd.NumeroHC },
			{ value: sd.FechaNacimiento },
			{ value: sd.Hora },
			{ value: sd.CUIT },
			{ value: sd.EstadoCivil },
			{ value: sd.Religion },
			{ value: sd.Raza },
			{ value: sd.TelefonoParticular },
			{ value: sd.TelefonoNegocio },
			{ value: sd.Mail },
			{ value: sd.NumeroSSN },
			{ value: sd.NumeroCuenta },
			{ value: sd.FotoURL },
			{ value: sd.LicenciaConducir },
			{ value: sd.DadorOrganos },
			{ value: sd.OrdenNacimiento },
			{ value: sd.LugarNacimiento },
			{ value: sd.FechaDefuncion },
			{ value: sd.HoraDefuncion },
			{ value: sd.IdiomaPrimario },
			{ value: sd.GrupoEtnico },
			{ value: sd.EstadoMilitar },
			{ value: sd.Ciudadania },
			{ value: sd.SituacionLaboral },
			{ value: sd.NivelDeEstudios },
		];
		const [nuevo] = await executeQuery(insert, params);
		// Insertar trabajos si vienen
		if (pacienteData.Trabajos && Array.isArray(pacienteData.Trabajos)) {
			try {
				await insertJobs(nuevo.IDPaciente, pacienteData.Trabajos);
				nuevo.Trabajos = await getJobsByPatient(nuevo.IDPaciente);
			} catch (e) {
				console.warn('No se pudieron insertar trabajos:', e.message);
			}
		}
		return nuevo;
	} catch (error) {
		console.error('Error al crear paciente:', error);
		throw error;
	}
};

/** Actualizar paciente */
const actualizarPaciente = async (id, pacienteData) => {
	try {
		await ensureExtraColumns();
		const limitLength = (s, m) => (s == null ? '' : s.toString().substring(0, m));
		const getNacQuery = `SELECT Valor FROM imNacionalidad WHERE Descripcion = @p0`;
		const nacRows = await executeQuery(getNacQuery, [
			{ value: pacienteData.Nacionalidad },
		]);
		const nacionalidad = nacRows[0]?.Valor || null;
		// Alias de campos que pueden venir con otros nombres desde el front
		const telefonoNegocioIn = pacienteData.TelefonoNegocio ?? pacienteData.TelefonoCelular;
		const numeroSSNIn = pacienteData.NumeroSSN ?? pacienteData.nAfiliado;
		const numeroCuentaIn = pacienteData.NumeroCuenta ?? pacienteData.Cobertura;
		const sd = {
			ApellidoyNombre: limitLength(pacienteData.ApellidoyNombre, 100) || '',
			TipoDocumento: limitLength(pacienteData.TipoDocumento, 10) || '',
			// Forzar Documento numérico; si no es dígitos válidos -> null para evitar error de conversión
			NumeroDocumento:
				pacienteData.NumeroDocumento != null &&
				/^\d+$/.test(String(pacienteData.NumeroDocumento))
					? Number(pacienteData.NumeroDocumento)
					: null,
			Domicilio: limitLength(pacienteData.Domicilio, 100) || '',
			ValorLocalidad: pacienteData.ValorLocalidad || null,
			Provincia: isNaN(pacienteData.Provincia) ? null : pacienteData.Provincia,
			Nacionalidad: limitLength(nacionalidad, 50) || null,
			Sexo: limitLength(pacienteData.Sexo, 1) || '',
			NumeroHC: limitLength(pacienteData.NumeroHC, 20) || '',
			FechaNacimiento: pacienteData.FechaNacimiento || null,
			Hora: pacienteData.Hora || null,
			CUIT: limitLength(pacienteData.CUIT, 20) || '',
			EstadoCivil: limitLength(pacienteData.EstadoCivil, 20) || '',
			Religion: limitLength(pacienteData.Religion, 50) || '',
			Raza: isNaN(pacienteData.Raza) ? null : pacienteData.Raza,
			TelefonoParticular: limitLength(pacienteData.TelefonoParticular, 20) || '',
			TelefonoNegocio: limitLength(telefonoNegocioIn, 20) || '',
			Mail: limitLength(pacienteData.Mail, 100) || '',
			NumeroSSN: limitLength(numeroSSNIn, 20) || '',
			NumeroCuenta: limitLength(numeroCuentaIn, 40) || null,
			FotoURL: pacienteData.FotoURL ? limitLength(pacienteData.FotoURL, 255) : null,
			LicenciaConducir: limitLength(pacienteData.LicenciaConducir, 40) || null,
			DadorOrganos: limitLength(pacienteData.DadorOrganos, 1) || null,
			OrdenNacimiento:
				pacienteData.OrdenNacimiento != null
					? Number(pacienteData.OrdenNacimiento)
					: null,
			LugarNacimiento: limitLength(pacienteData.LugarNacimiento, 80) || null,
			FechaDefuncion: pacienteData.FechaDefuncion || null,
			HoraDefuncion: pacienteData.HoraDefuncion || null,
			IdiomaPrimario:
				limitLength(pacienteData.IdiomaPrimario || pacienteData.Idioma, 10) || null,
			GrupoEtnico:
				pacienteData.GrupoEtnico != null
					? limitLength(String(pacienteData.GrupoEtnico).trim(), 1)
					: null,
			EstadoMilitar: limitLength(pacienteData.EstadoMilitar, 5) || null,
			Ciudadania: limitLength(pacienteData.Ciudadania, 40) || null,
			SituacionLaboral: limitLength(pacienteData.SituacionLaboral, 5) || null,
			NivelDeEstudios:
				limitLength(pacienteData.NivelDeEstudios || pacienteData.NivelEstudios, 5) ||
				null,
		};
		const setFoto = sd.FotoURL ? ', FotoURL = @p20' : '';
		// Reescritura: siempre incluimos @p20 y usamos COALESCE para no borrar FotoURL si viene null
		const query = `
			UPDATE impacientes SET
				ApellidoyNombre=@p1, TipoDocumento=@p2, NumeroDocumento=@p3,
				Domicilio=@p4, ValorLocalidad=@p5, Provincia=@p6, Nacionalidad=@p7,
				Sexo=@p8, NumeroHC=@p9, FechaNacimiento=@p10, Hora=@p11, CUIT=@p12,
				EstadoCivil=@p13, Religion=@p14, Raza=@p15, TelefonoParticular=@p16,
				TelefonoNegocio=@p17, Mail=@p18, NumeroSSN=@p19, NumeroCuenta=@p20, FotoURL=COALESCE(@p21, FotoURL),
				LicenciaConducir=@p22, DadorOrganos=@p23, OrdenNacimiento=@p24, LugarNacimiento=@p25,
				FechaDefuncion=@p26, HoraDefuncion=@p27, IdiomaPrimario=@p28, GrupoEtnico=@p29, EstadoMilitar=@p30, Ciudadania=@p31, SituacionLaboral=@p32, NivelDeEstudios=@p33
			WHERE IDPaciente=@p0;
			SELECT IDPaciente, ApellidoyNombre, TipoDocumento, NumeroDocumento, Domicilio,
				ValorLocalidad, Provincia, Nacionalidad, Sexo, NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN FechaNacimiento IS NULL OR FechaNacimiento < 0 OR FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY, FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				Hora, CUIT, EstadoCivil, Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail, NumeroSSN, NumeroCuenta, FotoURL,
				LicenciaConducir, DadorOrganos, OrdenNacimiento, LugarNacimiento,
				CONVERT(VARCHAR(10), CASE WHEN FechaDefuncion IS NULL OR FechaDefuncion < 0 OR FechaDefuncion > 1000000 THEN NULL ELSE DATEADD(DAY, FechaDefuncion, '1800-12-28') END, 23) AS FechaDefuncion,
				HoraDefuncion, IdiomaPrimario, GrupoEtnico, EstadoMilitar, Ciudadania, SituacionLaboral, NivelDeEstudios, NivelDeEstudios AS NivelEstudios
			FROM impacientes WHERE IDPaciente=@p0;`;
		const params = [
			{ value: id },
			{ value: sd.ApellidoyNombre },
			{ value: sd.TipoDocumento },
			{ value: sd.NumeroDocumento },
			{ value: sd.Domicilio },
			{ value: sd.ValorLocalidad },
			{ value: sd.Provincia },
			{ value: sd.Nacionalidad },
			{ value: sd.Sexo },
			{ value: sd.NumeroHC },
			{ value: sd.FechaNacimiento },
			{ value: sd.Hora },
			{ value: sd.CUIT },
			{ value: sd.EstadoCivil },
			{ value: sd.Religion },
			{ value: sd.Raza },
			{ value: sd.TelefonoParticular },
			{ value: sd.TelefonoNegocio },
			{ value: sd.Mail },
			{ value: sd.NumeroSSN },
			{ value: sd.NumeroCuenta },
			{ value: sd.FotoURL },
			{ value: sd.LicenciaConducir },
			{ value: sd.DadorOrganos },
			{ value: sd.OrdenNacimiento },
			{ value: sd.LugarNacimiento },
			{ value: sd.FechaDefuncion },
			{ value: sd.HoraDefuncion },
			{ value: sd.IdiomaPrimario },
			{ value: sd.GrupoEtnico },
			{ value: sd.EstadoMilitar },
			{ value: sd.Ciudadania },
			{ value: sd.SituacionLaboral },
			{ value: sd.NivelDeEstudios },
		];
		const rows = await executeQuery(query, params);
		const actualizado = rows[0];
		try {
			console.log(
				'[actualizarPaciente][debug] post-update IdiomaPrimario, GrupoEtnico:',
				{
					IdiomaPrimario: actualizado?.IdiomaPrimario,
					GrupoEtnico: actualizado?.GrupoEtnico,
				},
			);
		} catch (_) {}
		// Reemplazar trabajos si se envían
		if (pacienteData.Trabajos && Array.isArray(pacienteData.Trabajos)) {
			try {
				await replaceJobs(id, pacienteData.Trabajos);
				actualizado.Trabajos = await getJobsByPatient(id);
			} catch (e) {
				console.warn('No se pudieron actualizar trabajos:', e.message);
			}
		} else {
			// Si no se envió arreglo, opcionalmente devolver existentes
			try {
				actualizado.Trabajos = await getJobsByPatient(id);
			} catch (_) {}
		}
		return actualizado;
	} catch (error) {
		console.error('Error al actualizar paciente:', error);
		throw error;
	}
};

/** Eliminar paciente */
const eliminarPaciente = async (id) => {
	try {
		const existente = await obtenerPacientePorId(id);
		if (!existente) return false;
		const query = 'DELETE FROM impacientes WHERE IDPaciente = @p0';
		await executeQuery(query, [{ value: id }]);
		return true;
	} catch (error) {
		console.error(`Error al eliminar paciente con ID ${id}:`, error);
		throw error;
	}
};

/** Visita por número */
const obtenerVisitaPorNumero = async (numeroVisita) => {
	try {
		const query = `
			SELECT 
				v.NumeroVisita,
				v.FechaAdmisionS AS fechaAdmisionS,
				CONVERT(VARCHAR(10), v.FechaAdmisionS, 23) AS fechaAdmision,
				CONVERT(VARCHAR(5), v.FechaAdmisionS, 108) AS horaAdmision,
				dbo.fn_ClarionDATE2SQL(v.FechaEgreso) AS fechaEgreso,
				dbo.fn_ClarionTIME2SQL(v.HoraEgreso) AS horaEgreso,
				v.DisposicionEgreso AS disposicionEgreso,
				v.DiagnosticoEgreso AS diagnosticoEgreso,
				p.IDPaciente AS idPaciente,
				p.ApellidoyNombre AS nombrePaciente,
				h.ValorHabitacionCama AS habitacionCama,
				h.Observaciones AS descripcionHabitacionCama
			FROM imvisita v
			LEFT JOIN impacientes p ON v.IDPaciente = p.IDPaciente
			LEFT JOIN imhabitacioncamas h ON v.NumeroVisita = h.NumeroVisita
			WHERE v.NumeroVisita = @p0`;
		const result = await executeQuery(query, [{ value: numeroVisita }]);
		if (!result.length) return null;
		return result[0];
	} catch (error) {
		console.error(`Error al obtener visita con número ${numeroVisita}:`, error);
		throw error;
	}
};

/** Registrar egreso */
const registrarEgresoPaciente = async (egresoData) => {
	try {
		const queryUpdateVisita = `
			UPDATE imvisitas SET 
				FechaEgreso=@p1, HoraEgreso=@p2, DisposicionEgreso=@p3,
				DiagnosticoEgreso=@p4, CodOperadorEgreso=@p5
			WHERE NumeroVisita=@p0;
			SELECT NumeroVisita,
				CONVERT(VARCHAR(10), FechaAdmision, 23) AS fechaAdmision,
				CONVERT(VARCHAR(5), HoraAdmision, 108) AS horaAdmision,
				CONVERT(VARCHAR(10), FechaEgreso, 23) AS fechaEgreso,
				CONVERT(VARCHAR(5), HoraEgreso, 108) AS horaEgreso,
				DisposicionEgreso AS disposicionEgreso,
				DiagnosticoEgreso AS diagnosticoEgreso
			FROM imvisitas WHERE NumeroVisita=@p0;`;
		const paramsVisita = [
			{ value: egresoData.numeroVisita },
			{ value: egresoData.fechaEgreso },
			{ value: egresoData.horaEgreso },
			{ value: egresoData.disposicionEgreso },
			{ value: egresoData.diagnosticoEgreso || null },
			{ value: egresoData.codOperador || null },
		];
		const visitaRows = await executeQuery(queryUpdateVisita, paramsVisita);
		if (egresoData.bedId) {
			const qBed = `UPDATE imhabitacioncamastmp SET EstadoCama='DISPONIBLE', IDPaciente=NULL WHERE ValorHabitacionCama=@p0`;
			await executeQuery(qBed, [{ value: egresoData.bedId }]);
		}
		return visitaRows[0];
	} catch (error) {
		console.error(
			`Error al registrar egreso para visita ${egresoData.numeroVisita}:`,
			error,
		);
		throw error;
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
};
