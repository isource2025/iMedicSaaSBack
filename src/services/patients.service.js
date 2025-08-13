/**
 * Servicio para gestión de pacientes (versión modernizada con FotoURL y baseUrl)
 */
const { executeQuery } = require('../models/db');
const { v4: uuidv4 } = require('uuid');

// Garantiza la existencia de la columna FotoURL (idempotente)
const ensureFotoURLColumn = async () => {
	try {
		const ddl = `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'impacientes' AND COLUMN_NAME = 'FotoURL')
		BEGIN
			ALTER TABLE impacientes ADD FotoURL NVARCHAR(255) NULL;
		END`;
		await executeQuery(ddl);
	} catch (err) {
		console.error('No se pudo verificar/crear columna FotoURL:', err.message);
	}
};

// Normaliza un resultado (o lista) agregando baseUrl a FotoURL relativa
const mapFotoURL = (rows, baseUrl) => {
	if (!baseUrl) return rows;
	return rows.map((r) => ({
		...r,
		FotoURL:
			r.FotoURL && !/^https?:\/\//i.test(r.FotoURL)
				? `${baseUrl}${r.FotoURL}`
				: r.FotoURL,
	}));
};

/** Lista pacientes */
const obtenerPacientes = async (baseUrl) => {
	try {
		await ensureFotoURLColumn();
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
				c.RazonSocial as Cobertura,
				p.ValorLocalidad,
				p.Provincia,
				p.Nacionalidad,
				p.CUIT,
				p.TelefonoParticular,
				p.TelefonoNegocio,
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.FotoURL
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			ORDER BY p.ApellidoyNombre`;
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
		await ensureFotoURLColumn();
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
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.FotoURL
			FROM impacientes p
			WHERE p.IDPaciente = @p0`;
		const parametros = [{ value: id }];
		const rows = await executeQuery(query, parametros);
		if (!rows.length) return null;
		return mapFotoURL(rows, baseUrl)[0];
	} catch (error) {
		console.error(`Error al obtener paciente con ID ${id}:`, error);
		throw error;
	}
};

/** Búsqueda parametrizada */
const buscarPacientes = async (searchTerm = '', baseUrl) => {
	try {
		if (!searchTerm || String(searchTerm).trim() === '') {
			return await obtenerPacientes(baseUrl);
		}
		await ensureFotoURLColumn();
		const likeValue = `%${searchTerm}%`;
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
				c.RazonSocial as Cobertura,
				p.ValorLocalidad,
				p.Provincia,
				p.Nacionalidad,
				p.CUIT,
				p.TelefonoParticular,
				p.TelefonoNegocio,
				p.Mail,
				p.NumeroCuenta,
				p.NumeroSSN,
				p.FotoURL
			FROM impacientes p
			LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
			WHERE 
				CAST(p.IDPaciente AS VARCHAR) LIKE @p0 OR
				CAST(p.NumeroDocumento AS VARCHAR) LIKE @p1 OR
				p.ApellidoyNombre LIKE @p2 OR
				CAST(p.NumeroHC AS VARCHAR) LIKE @p3
			ORDER BY p.ApellidoyNombre`;
		const params = [
			{ value: likeValue },
			{ value: likeValue },
			{ value: likeValue },
			{ value: likeValue },
		];
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
		await ensureFotoURLColumn();
		const limitLength = (str, max) => (str == null ? null : str.toString().substring(0, max));
		const sd = {
			ListaIDPaciente: limitLength(pacienteData.ListaIDPaciente ?? uuidv4(), 80),
			IDPacienteAlt: pacienteData.IDPacienteAlt != null ? Number(pacienteData.IDPacienteAlt) : 0,
			ApellidoyNombre: limitLength(pacienteData.ApellidoyNombre, 40) || '',
			TipoDocumento: limitLength(pacienteData.TipoDocumento, 3) || null,
			NumeroDocumento: pacienteData.NumeroDocumento != null ? Number(pacienteData.NumeroDocumento) : null,
			Domicilio: limitLength(pacienteData.Domicilio, 80) || null,
			ValorLocalidad: pacienteData.ValorLocalidad != null ? Number(pacienteData.ValorLocalidad) : null,
			Provincia: pacienteData.Provincia != null ? Number(pacienteData.Provincia) : null,
			Nacionalidad: limitLength(pacienteData.Nacionalidad, 2) || null,
			Sexo: limitLength(pacienteData.Sexo, 1) || null,
			NumeroHC: limitLength(pacienteData.NumeroHC, 20) || null,
			FechaNacimiento: pacienteData.FechaNacimiento || null,
			Hora: pacienteData.Hora != null ? Number(pacienteData.Hora) : null,
			CUIT: limitLength(pacienteData.CUIT, 13) || null,
			EstadoCivil: limitLength(pacienteData.EstadoCivil, 1) || null,
			Religion: limitLength(pacienteData.Religion, 3) || null,
			Raza: pacienteData.Raza != null ? Number(pacienteData.Raza) : null,
			TelefonoParticular: limitLength(pacienteData.TelefonoParticular, 20) || null,
			TelefonoNegocio: limitLength(pacienteData.TelefonoNegocio, 20) || null,
			Mail: limitLength(pacienteData.Mail, 80) || null,
			NumeroSSN: limitLength(pacienteData.NumeroSSN, 40) || null,
			FotoURL: limitLength(pacienteData.FotoURL, 255) || null,
		};

		const insert = `
			INSERT INTO impacientes (
				ListaIDPaciente, IDPacienteAlt, ApellidoyNombre, TipoDocumento, NumeroDocumento,
				Domicilio, ValorLocalidad, Provincia, Nacionalidad, Sexo,
				NumeroHC, FechaNacimiento, Hora, CUIT, EstadoCivil,
				Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail,
				NumeroSSN, FotoURL
			) VALUES (
				@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,
				@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,@p20,@p21
			);
			SELECT 
				IDPaciente, ListaIDPaciente, IDPacienteAlt, ApellidoyNombre, TipoDocumento, NumeroDocumento,
				Domicilio, ValorLocalidad, Provincia, Nacionalidad, Sexo, NumeroHC,
				CONVERT(VARCHAR(10), 
					CASE WHEN FechaNacimiento IS NULL OR FechaNacimiento < 0 OR FechaNacimiento > 1000000 THEN NULL
							 ELSE DATEADD(DAY, FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				Hora, CUIT, EstadoCivil, Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail, NumeroSSN, FotoURL
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
			{ value: sd.FotoURL },
		];
		const [nuevo] = await executeQuery(insert, params);
		return nuevo;
	} catch (error) {
		console.error('Error al crear paciente:', error);
		throw error;
	}
};

/** Actualizar paciente */
const actualizarPaciente = async (id, pacienteData) => {
	try {
		await ensureFotoURLColumn();
		const limitLength = (s, m) => (s == null ? '' : s.toString().substring(0, m));
		const getNacQuery = `SELECT Valor FROM imNacionalidad WHERE Descripcion = @p0`;
		const nacRows = await executeQuery(getNacQuery, [{ value: pacienteData.Nacionalidad }]);
		const nacionalidad = nacRows[0]?.Valor || null;
		const sd = {
			ApellidoyNombre: limitLength(pacienteData.ApellidoyNombre, 100) || '',
			TipoDocumento: limitLength(pacienteData.TipoDocumento, 10) || '',
			NumeroDocumento: limitLength(pacienteData.NumeroDocumento, 20) || '',
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
			TelefonoNegocio: limitLength(pacienteData.TelefonoNegocio, 20) || '',
			Mail: limitLength(pacienteData.Mail, 100) || '',
			NumeroSSN: limitLength(pacienteData.NumeroSSN, 20) || '',
			FotoURL: pacienteData.FotoURL ? limitLength(pacienteData.FotoURL, 255) : null,
		};
		const setFoto = sd.FotoURL ? ', FotoURL = @p20' : '';
		const selectFoto = ', FotoURL';
		const query = `
			UPDATE impacientes SET
				ApellidoyNombre=@p1, TipoDocumento=@p2, NumeroDocumento=@p3,
				Domicilio=@p4, ValorLocalidad=@p5, Provincia=@p6, Nacionalidad=@p7,
				Sexo=@p8, NumeroHC=@p9, FechaNacimiento=@p10, Hora=@p11, CUIT=@p12,
				EstadoCivil=@p13, Religion=@p14, Raza=@p15, TelefonoParticular=@p16,
				TelefonoNegocio=@p17, Mail=@p18, NumeroSSN=@p19${setFoto}
			WHERE IDPaciente=@p0;
			SELECT IDPaciente, ApellidoyNombre, TipoDocumento, NumeroDocumento, Domicilio,
				ValorLocalidad, Provincia, Nacionalidad, Sexo, NumeroHC,
				CONVERT(VARCHAR(10), CASE WHEN FechaNacimiento IS NULL OR FechaNacimiento < 0 OR FechaNacimiento > 1000000 THEN NULL ELSE DATEADD(DAY, FechaNacimiento, '1800-12-28') END, 23) AS FechaNacimiento,
				Hora, CUIT, EstadoCivil, Religion, Raza, TelefonoParticular, TelefonoNegocio, Mail, NumeroSSN${selectFoto}
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
		];
		if (sd.FotoURL) params.push({ value: sd.FotoURL });
		const rows = await executeQuery(query, params);
		return rows[0];
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
		console.error(`Error al registrar egreso para visita ${egresoData.numeroVisita}:`, error);
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
