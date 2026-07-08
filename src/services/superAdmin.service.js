const { executePlatformQuery: executeQuery } = require('../models/db');
const tenantDb = require('../models/db');
const { runWithTenant } = require('../context/tenantContext');
const tenantRegistry = require('./tenantRegistry.service');
const { testTenantConnection } = require('../config/tenantDb');
const usersService = require('./users.service');
const rolesService = require('./roles.service');
const sectoresService = require('./sectores.service');
const authCentralService = require('./authCentral.service');
const authCentralSync = require('./authCentralSync.service');
const platformMysql = require('./platformMysql.service');
const nubeTenant = require('./nubeTenant.service');
const {
	PACKS_PRINCIPALES,
	MODULOS_GENERALES,
	PASOS_ONBOARDING,
	PLANES,
	ESTADOS_SUSCRIPCION,
	packsActivosToModulos,
	todosModulosHabilitados,
} = require('../utils/empresaModulos');

function useMysqlPlatform() {
	return authCentralService.isAuthCentralEnabled();
}

function normalizeTipoServidor(v) {
	return String(v || '').trim().toUpperCase() === 'NUBE' ? 'NUBE' : 'FISICO';
}

/**
 * true cuando la lógica de auth/gestión (usuarios, roles, sectores, login) de la empresa
 * vive en Railway (MySQL). Esto es SIEMPRE así en producción, independientemente de
 * TipoServidor: FISICO/NUBE solo describen dónde está la infraestructura CLÍNICA
 * (hoy en el servidor físico; a futuro migrada a la nube). El auth es siempre Railway.
 * En desarrollo local (plataforma SQL Server) la gestión usa el tenant físico.
 */
async function gestionAuthEnRailway() {
	return useMysqlPlatform();
}

/** true si la clínica vive 100% en Railway (TipoServidor = NUBE). */
async function esEmpresaNube(idEmpresa) {
	if (!useMysqlPlatform()) return false;
	try {
		const row = await platformMysql.obtenerEmpresaRow(Number(idEmpresa));
		return normalizeTipoServidor(row?.TipoServidor) === 'NUBE';
	} catch {
		return false;
	}
}

function mapEmpresaRow(r) {
	return {
		id: String(r.IDEMPRESA ?? r.IdEmpresa ?? r.id),
		descripcion: String(r.DESCRIPCION ?? r.Descripcion ?? '').trim(),
		cuit: r.Nro_CUIT != null ? String(r.Nro_CUIT) : '',
		localidad: String(r.localidad ?? '').trim(),
		provincia: String(r.Provincia ?? '').trim(),
		email: String(r.Email ?? '').trim(),
		telefono: String(r.TEEmpresa ?? '').trim(),
		calle: String(r.calle ?? '').trim(),
		calle_nro: r.calle_nro != null ? String(r.calle_nro) : '',
		tipoServidor: normalizeTipoServidor(r.TipoServidor),
		conexion: {
			dbServer: r.DbServer != null ? String(r.DbServer) : '',
			dbPort: r.DbPort != null ? Number(r.DbPort) : null,
			dbInstance: r.DbInstance != null ? String(r.DbInstance) : '',
			dbName: r.DbName != null ? String(r.DbName) : '',
			dbUser: r.DbUser != null ? String(r.DbUser) : '',
			tienePassword: !!r.DbPasswordEnc,
		},
	};
}

async function listarEmpresas(filtro = '') {
	if (useMysqlPlatform()) {
		const rows = await platformMysql.listarEmpresasRows(filtro);
		const empresas = rows.map(mapEmpresaRow);
		for (const emp of empresas) {
			emp.packs = await obtenerPacksEmpresa(Number(emp.id));
			emp.onboarding = await obtenerOnboardingEmpresa(Number(emp.id));
			emp.suscripcion = await obtenerSuscripcionEmpresa(Number(emp.id));
		}
		return empresas;
	}

	const q = String(filtro || '').trim();
	const params = [];
	let where = '';
	if (q) {
		where = `WHERE e.DESCRIPCION LIKE @p0 OR CAST(e.IDEMPRESA AS VARCHAR(20)) LIKE @p0`;
		params.push({ value: `%${q}%`, type: 'VarChar' });
	}

	const rows = await executeQuery(
		`
    SELECT
      e.IDEMPRESA,
      e.DESCRIPCION,
      e.Nro_CUIT,
      e.localidad,
      e.Provincia,
      e.Email,
      e.TEEmpresa,
      e.DbServer,
      e.DbPort,
      e.DbInstance,
      e.DbName,
      e.DbUser,
      e.DbPasswordEnc,
      (SELECT COUNT(*) FROM dbo.imPersonalEmpresas pe WHERE pe.IdEmpresa = e.IDEMPRESA) AS CantUsuarios
    FROM dbo.Empresas e
    ${where}
    ORDER BY e.DESCRIPCION
    `,
		params,
	);

	const empresas = rows.map(mapEmpresaRow);
	for (const emp of empresas) {
		emp.packs = await obtenerPacksEmpresa(Number(emp.id));
		emp.onboarding = await obtenerOnboardingEmpresa(Number(emp.id));
		emp.suscripcion = await obtenerSuscripcionEmpresa(Number(emp.id));
	}
	return empresas;
}

async function obtenerPacksEmpresa(idEmpresa) {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.obtenerPacks(idEmpresa);
		} catch (e) {
			console.warn('[superAdmin] obtenerPacksEmpresa MySQL:', e.message);
			return [];
		}
	}
	try {
		const rows = await executeQuery(
			`SELECT CodigoPack, Activo FROM dbo.EmpresasModuloPack WHERE IdEmpresa = @p0 AND Activo = 1`,
			[{ value: idEmpresa, type: 'Int' }],
		);
		return rows.map((r) => String(r.CodigoPack));
	} catch {
		return [];
	}
}

function parseOnboardingConfigJson(raw) {
	if (!raw) return { sectoresDefecto: [] };
	try {
		const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return {
			sectoresDefecto: Array.isArray(o?.sectoresDefecto)
				? o.sectoresDefecto.map(String)
				: [],
		};
	} catch {
		return { sectoresDefecto: [] };
	}
}

async function obtenerOnboardingEmpresa(idEmpresa) {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.obtenerOnboarding(idEmpresa);
		} catch (e) {
			console.warn('[superAdmin] obtenerOnboardingEmpresa MySQL:', e.message);
			return { pasoActual: 'DATOS', completado: false, notas: '', sectoresDefecto: [] };
		}
	}
	try {
		const rows = await executeQuery(
			`SELECT PasoActual, Completado, Notas, FechaInicio, FechaCompletado, ConfigJson
       FROM dbo.EmpresasOnboarding WHERE IdEmpresa = @p0`,
			[{ value: idEmpresa, type: 'Int' }],
		);
		if (!rows.length) {
			return { pasoActual: 'DATOS', completado: false, notas: '', sectoresDefecto: [] };
		}
		const r = rows[0];
		const cfg = parseOnboardingConfigJson(r.ConfigJson);
		return {
			pasoActual: r.PasoActual || 'DATOS',
			completado: !!r.Completado,
			notas: r.Notas || '',
			fechaInicio: r.FechaInicio,
			fechaCompletado: r.FechaCompletado,
			sectoresDefecto: cfg.sectoresDefecto,
		};
	} catch {
		return { pasoActual: 'DATOS', completado: false, notas: '', sectoresDefecto: [] };
	}
}

async function obtenerSuscripcionEmpresa(idEmpresa) {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.obtenerSuscripcion(idEmpresa);
		} catch (e) {
			console.warn('[superAdmin] obtenerSuscripcionEmpresa MySQL:', e.message);
			return { plan: 'STARTER', estado: 'PRUEBA', importeMensual: null, moneda: 'ARS' };
		}
	}
	try {
		const rows = await executeQuery(
			`SELECT [Plan], Estado, ImporteMensual, Moneda, FechaInicio, FechaProximoCobro, MetodoPago, Notas
       FROM dbo.EmpresasSuscripcion WHERE IdEmpresa = @p0`,
			[{ value: idEmpresa, type: 'Int' }],
		);
		if (!rows.length) {
			return { plan: 'STARTER', estado: 'PRUEBA', importeMensual: null, moneda: 'ARS' };
		}
		const r = rows[0];
		return {
			plan: r.Plan || 'STARTER',
			estado: r.Estado || 'PRUEBA',
			importeMensual: r.ImporteMensual != null ? Number(r.ImporteMensual) : null,
			moneda: r.Moneda || 'ARS',
			fechaInicio: r.FechaInicio,
			fechaProximoCobro: r.FechaProximoCobro,
			metodoPago: r.MetodoPago || '',
			notas: r.Notas || '',
		};
	} catch {
		return { plan: 'STARTER', estado: 'PRUEBA', importeMensual: null, moneda: 'ARS' };
	}
}

async function obtenerEmpresaDetalle(idEmpresa) {
	if (useMysqlPlatform()) {
		const row = await platformMysql.obtenerEmpresaRow(idEmpresa);
		if (!row) return null;
		const base = mapEmpresaRow(row);
		const packs = await obtenerPacksEmpresa(idEmpresa);
		return {
			...base,
			packs,
			modulosHabilitados: packsActivosToModulos(packs),
			modulosGenerales: [...MODULOS_GENERALES],
			onboarding: await obtenerOnboardingEmpresa(idEmpresa),
			suscripcion: await obtenerSuscripcionEmpresa(idEmpresa),
			usuarios: await listarUsuariosEmpresa(idEmpresa),
		};
	}

	const rows = await executeQuery(
		`SELECT IDEMPRESA, DESCRIPCION, calle, calle_nro, Depto, piso, localidad, Provincia,
            Nro_CUIT, Nro_IngBrutos, IdTipoIVA, TEEmpresa, Email,
            DbServer, DbPort, DbInstance, DbName, DbUser, DbPasswordEnc
     FROM dbo.Empresas WHERE IDEMPRESA = @p0`,
		[{ value: idEmpresa, type: 'Int' }],
	);
	if (!rows.length) return null;

	const base = mapEmpresaRow(rows[0]);
	const packs = await obtenerPacksEmpresa(idEmpresa);
	return {
		...base,
		packs,
		modulosHabilitados: packsActivosToModulos(packs),
		modulosGenerales: [...MODULOS_GENERALES],
		onboarding: await obtenerOnboardingEmpresa(idEmpresa),
		suscripcion: await obtenerSuscripcionEmpresa(idEmpresa),
		usuarios: await listarUsuariosEmpresa(idEmpresa),
	};
}

function provinciaParam(v) {
	if (v === undefined || v === null || v === '') return { value: null, type: 'SmallInt' };
	const n = Number(v);
	return Number.isFinite(n) ? { value: n, type: 'SmallInt' } : { value: null, type: 'SmallInt' };
}

async function crearEmpresa(data) {
	const desc = String(data.descripcion || '').trim();
	if (!desc) {
		const e = new Error('La descripción de la empresa es obligatoria');
		e.statusCode = 400;
		throw e;
	}

	if (useMysqlPlatform()) {
		const nuevoId = await platformMysql.crearEmpresaRow(data);
		const packsDefault = Array.isArray(data.packs) && data.packs.length ? data.packs : ['AGENDA'];
		await platformMysql.actualizarPacks(nuevoId, packsDefault);
		await platformMysql.upsertOnboarding(nuevoId, { pasoActual: 'MODULOS', completado: false });
		await platformMysql.upsertSuscripcion(nuevoId, {
			plan: data.plan || 'STARTER',
			estado: 'PRUEBA',
			importeMensual: data.importeMensual ?? null,
		});
		const esNube = normalizeTipoServidor(data.tipoServidor) === 'NUBE';
		if (!esNube && (data.conexion || data.dbServer || data.dbName)) {
			const c = data.conexion || data;
			await tenantRegistry.guardarConexionEmpresa(nuevoId, {
				dbServer: c.dbServer,
				dbPort: c.dbPort,
				dbInstance: c.dbInstance,
				dbName: c.dbName,
				dbUser: c.dbUser,
				dbPassword: c.dbPassword,
			});
		}
		return obtenerEmpresaDetalle(nuevoId);
	}

	const idRows = await executeQuery(`SELECT ISNULL(MAX(IDEMPRESA), 0) + 1 AS NuevoId FROM dbo.Empresas`);
	const nuevoId = Number(idRows[0]?.NuevoId) || 1;

	await executeQuery(
		`
    INSERT INTO dbo.Empresas (IDEMPRESA, DESCRIPCION, calle, calle_nro, localidad, Provincia, Nro_CUIT, Email, TEEmpresa)
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)
    `,
		[
			{ value: nuevoId, type: 'Int' },
			{ value: desc, type: 'VarChar' },
			{ value: data.calle || '', type: 'VarChar' },
			{ value: data.calle_nro || '', type: 'VarChar' },
			{ value: data.localidad || '', type: 'VarChar' },
			provinciaParam(data.provincia),
			{ value: data.cuit || '', type: 'VarChar' },
			{ value: data.email || '', type: 'VarChar' },
			{ value: data.telefono || '', type: 'VarChar' },
		],
	);

	const packsDefault = Array.isArray(data.packs) && data.packs.length ? data.packs : ['AGENDA'];
	await actualizarPacksEmpresa(nuevoId, packsDefault);
	await upsertOnboarding(nuevoId, { pasoActual: 'MODULOS', completado: false });
	await upsertSuscripcion(nuevoId, {
		plan: data.plan || 'STARTER',
		estado: 'PRUEBA',
		importeMensual: data.importeMensual ?? null,
	});

	if (data.conexion || data.dbServer || data.dbName) {
		const c = data.conexion || data;
		await tenantRegistry.guardarConexionEmpresa(nuevoId, {
			dbServer: c.dbServer,
			dbPort: c.dbPort,
			dbInstance: c.dbInstance,
			dbName: c.dbName,
			dbUser: c.dbUser,
			dbPassword: c.dbPassword,
		});
	}

	return obtenerEmpresaDetalle(nuevoId);
}

async function actualizarConexionEmpresa(idEmpresa, data) {
	await tenantRegistry.guardarConexionEmpresa(idEmpresa, {
		dbServer: data.dbServer,
		dbPort: data.dbPort,
		dbInstance: data.dbInstance,
		dbName: data.dbName,
		dbUser: data.dbUser,
		dbPassword: data.dbPassword,
	});
	return obtenerEmpresaDetalle(idEmpresa);
}

async function probarConexionEmpresa(idEmpresa) {
	return testTenantConnection(Number(idEmpresa));
}

/** Prueba una conexión SQL con las credenciales tipeadas (sin guardarlas en Empresas). */
async function probarConexionDatos(body = {}) {
	const row = {
		DbServer: body.dbServer,
		DbPort: body.dbPort,
		DbInstance: body.dbInstance,
		DbName: body.dbName,
		DbUser: body.dbUser,
		DbPassword: body.dbPassword,
	};
	if (!String(row.DbServer || '').trim() || !String(row.DbName || '').trim() || !String(row.DbUser || '').trim()) {
		return { ok: false, error: 'Completá servidor, base de datos y usuario para probar la conexión' };
	}
	try {
		await testTenantConnection(row);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

/** Lista las tablas que se pueden importar del SQL Server físico hacia la nube. */
async function listarTablasImportables(idEmpresa) {
	return nubeTenant.listarTablasImportables(Number(idEmpresa));
}

/** Importa (snapshot) las tablas seleccionadas del SQL Server físico a Railway. */
async function importarTablasEmpresa(idEmpresa, tablas) {
	// La empresa NO cambia de TipoServidor: sigue FISICO (su clínica vive en el servidor
	// físico). El import solo trae al Railway las tablas de auth/login, que es donde el
	// sistema resuelve login y gestión de usuarios/roles/sectores para todas las empresas.
	return nubeTenant.importarTablas(Number(idEmpresa), tablas);
}

async function previewTablaImportable(idEmpresa, tabla, limite) {
	return nubeTenant.previewTabla(Number(idEmpresa), String(tabla), limite);
}

async function actualizarEmpresa(idEmpresa, data) {
	const desc = String(data.descripcion || '').trim();
	if (!desc) throw new Error('La descripción es obligatoria');

	if (useMysqlPlatform()) {
		await platformMysql.actualizarEmpresaRow(idEmpresa, data);
		if (data.tipoServidor !== undefined) {
			await platformMysql.actualizarTipoServidor(idEmpresa, data.tipoServidor);
		}
		return obtenerEmpresaDetalle(idEmpresa);
	}

	await executeQuery(
		`
    UPDATE dbo.Empresas SET
      DESCRIPCION = @p1,
      calle = @p2,
      calle_nro = @p3,
      localidad = @p4,
      Provincia = @p5,
      Nro_CUIT = @p6,
      Email = @p7,
      TEEmpresa = @p8
    WHERE IDEMPRESA = @p0
    `,
		[
			{ value: idEmpresa, type: 'Int' },
			{ value: desc, type: 'VarChar' },
			{ value: data.calle || '', type: 'VarChar' },
			{ value: data.calle_nro || '', type: 'VarChar' },
			{ value: data.localidad || '', type: 'VarChar' },
			provinciaParam(data.provincia),
			{ value: data.cuit || '', type: 'VarChar' },
			{ value: data.email || '', type: 'VarChar' },
			{ value: data.telefono || '', type: 'VarChar' },
		],
	);

	return obtenerEmpresaDetalle(idEmpresa);
}

async function actualizarPacksEmpresa(idEmpresa, packsActivos) {
	const validos = new Set(PACKS_PRINCIPALES.map((p) => p.codigo));
	const activos = (packsActivos || []).filter((c) => validos.has(String(c).toUpperCase()));

	if (useMysqlPlatform()) {
		await platformMysql.actualizarPacks(idEmpresa, activos);
		return {
			packs: activos,
			modulosHabilitados: packsActivosToModulos(activos),
			modulosGenerales: [...MODULOS_GENERALES],
		};
	}

	try {
		await executeQuery(`DELETE FROM dbo.EmpresasModuloPack WHERE IdEmpresa = @p0`, [
			{ value: idEmpresa, type: 'Int' },
		]);
		for (const codigo of activos) {
			await executeQuery(
				`INSERT INTO dbo.EmpresasModuloPack (IdEmpresa, CodigoPack, Activo) VALUES (@p0, @p1, 1)`,
				[
					{ value: idEmpresa, type: 'Int' },
					{ value: codigo, type: 'VarChar' },
				],
			);
		}
	} catch (e) {
		console.warn('[superAdmin] EmpresasModuloPack no disponible:', e.message);
	}

	return {
		packs: activos,
		modulosHabilitados: packsActivosToModulos(activos),
		modulosGenerales: [...MODULOS_GENERALES],
	};
}

async function upsertOnboarding(idEmpresa, data) {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.upsertOnboarding(idEmpresa, data);
		} catch (e) {
			console.warn('[superAdmin] upsertOnboarding MySQL:', e.message);
			return obtenerOnboardingEmpresa(idEmpresa);
		}
	}
	try {
		const exists = await executeQuery(
			`SELECT IdEmpresa, ConfigJson FROM dbo.EmpresasOnboarding WHERE IdEmpresa = @p0`,
			[{ value: idEmpresa, type: 'Int' }],
		);

		let configJson = null;
		if (data.sectoresDefecto !== undefined) {
			const prev = exists.length ? parseOnboardingConfigJson(exists[0].ConfigJson) : { sectoresDefecto: [] };
			configJson = JSON.stringify({
				...prev,
				sectoresDefecto: (data.sectoresDefecto || []).map(String),
			});
		}

		if (exists.length) {
			const sets = [
				'PasoActual = @p1',
				'Completado = @p2',
				'Notas = @p3',
				'FechaCompletado = CASE WHEN @p2 = 1 THEN GETDATE() ELSE FechaCompletado END',
			];
			const params = [
				{ value: idEmpresa, type: 'Int' },
				{ value: data.pasoActual || 'DATOS', type: 'VarChar' },
				{ value: data.completado ? 1 : 0, type: 'Bit' },
				{ value: data.notas || '', type: 'VarChar' },
			];
			if (configJson !== null) {
				sets.push('ConfigJson = @p4');
				params.push({ value: configJson, type: 'NVarChar' });
			}
			await executeQuery(
				`UPDATE dbo.EmpresasOnboarding SET ${sets.join(', ')} WHERE IdEmpresa = @p0`,
				params,
			);
		} else {
			await executeQuery(
				`
        INSERT INTO dbo.EmpresasOnboarding (IdEmpresa, PasoActual, Completado, Notas, FechaInicio, ConfigJson)
        VALUES (@p0, @p1, @p2, @p3, GETDATE(), @p4)
        `,
				[
					{ value: idEmpresa, type: 'Int' },
					{ value: data.pasoActual || 'DATOS', type: 'VarChar' },
					{ value: data.completado ? 1 : 0, type: 'Bit' },
					{ value: data.notas || '', type: 'VarChar' },
					{ value: configJson || '{"sectoresDefecto":[]}', type: 'NVarChar' },
				],
			);
		}
	} catch (e) {
		console.warn('[superAdmin] EmpresasOnboarding:', e.message);
	}
	return obtenerOnboardingEmpresa(idEmpresa);
}

/** Ficha mínima en imPersonal (mismo Valor que imPassword.ValorPersonal) para rol y permisos. */
async function asegurarFichaPersonal(valorPersonal, { apellido, nombres, numeroDocumento }) {
	const rows = await tenantDb.executeQuery(`SELECT Valor FROM dbo.imPersonal WHERE Valor = @p0`, [
		{ value: valorPersonal, type: 'Int' },
	]);
	if (rows.length) return;

	const apellidoNombre = `${String(apellido || '').trim()}, ${String(nombres || '').trim()}`.replace(
		/^,\s*|,\s*$/g,
		'',
	);
	const num =
		numeroDocumento != null && String(numeroDocumento).trim() !== ''
			? Number(String(numeroDocumento).replace(/\D/g, ''))
			: null;
	const matricula = Number.isFinite(num) && num > 0 ? num : valorPersonal;

	await tenantDb.executeQuery(
		`
    INSERT INTO dbo.imPersonal (
      Valor, Matricula, MatriculaNacional, TipoDocumento, Numero,
      ApellidoNombre, Domicilio, ValorLocalidad, Provincia, Nacionalidad,
      FechaNacimiento, Sexo, EstadoCivil, Telefono,
      ValorEspecialidad, ValorFunciones, ValorServicio, ValorCategoria,
      ValorClase, LugarTrabajo, LugarCobro, NumeroSocio,
      ConvenioFacturacion, IdEspecialidadME, Estado
    ) VALUES (
      @p0, @p1, NULL, 'DNI', @p2,
      @p3, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, 1
    )
    `,
		[
			{ value: valorPersonal, type: 'Int' },
			{ value: matricula, type: 'Int' },
			{ value: num, type: 'Int' },
			{ value: apellidoNombre || `Usuario ${valorPersonal}`, type: 'VarChar' },
		],
	);
}

/**
 * Alta completa: credencial + ficha personal + rol + empresa + sectores.
 */
async function crearUsuarioEmpresa(idEmpresa, body) {
	if (await esEmpresaNube(idEmpresa)) {
		return nubeTenant.crearUsuarioEmpresa(idEmpresa, body);
	}
	return runWithTenant(idEmpresa, async () => {
		const {
			nombreRed,
			password,
			apellido,
			nombres,
			numeroDocumento,
			legajo,
			codOperador,
			idRol,
			sectores,
		} = body;

		if (!nombreRed?.trim() || !password?.trim()) {
			const e = new Error('Usuario de red y contraseña son obligatorios');
			e.statusCode = 400;
			throw e;
		}
		if (!apellido?.trim() || !nombres?.trim()) {
			const e = new Error('Apellido y nombres son obligatorios');
			e.statusCode = 400;
			throw e;
		}

		const usuario = await usersService.crearUsuario({
			codOperador: codOperador || '',
			apellido: apellido.trim(),
			nombres: nombres.trim(),
			nombreRed: nombreRed.trim(),
			password: password.trim(),
			numeroDocumento: numeroDocumento || '',
			legajo: legajo || '',
		});

		const valorPersonal = Number(usuario.ValorPersonal ?? usuario.valorPersonal);
		if (!Number.isFinite(valorPersonal)) {
			const e = new Error('No se pudo obtener el ID del usuario creado');
			e.statusCode = 500;
			throw e;
		}

		await asegurarFichaPersonal(valorPersonal, { apellido, nombres, numeroDocumento });

		if (idRol != null && idRol !== '') {
			await rolesService.asignarRolAPersonal(valorPersonal, Number(idRol));
			await authCentralSync.syncPersonal(idEmpresa, valorPersonal);
		}

		await vincularUsuarioEmpresa(idEmpresa, valorPersonal);

		const sectoresAsignar =
			Array.isArray(sectores) && sectores.length
				? sectores
				: (await obtenerOnboardingEmpresa(idEmpresa)).sectoresDefecto || [];

		for (const idSector of sectoresAsignar) {
			try {
				await usersService.asignarSector(valorPersonal, String(idSector));
			} catch (err) {
				if (!String(err.message || '').includes('ya tiene asignado')) throw err;
			}
		}

		await authCentralSync.syncUserLoginBundle(idEmpresa, valorPersonal);

		const lista = await listarUsuariosEmpresa(idEmpresa);
		return lista.find((u) => u.idPersonal === valorPersonal) || lista[lista.length - 1];
	});
}

async function actualizarUsuarioEmpresa(idEmpresa, idPersonal, body) {
	if (await esEmpresaNube(idEmpresa)) {
		return nubeTenant.actualizarUsuarioEmpresa(idEmpresa, idPersonal, body);
	}
	return runWithTenant(idEmpresa, async () => {
		const vinculo = await tenantDb.executeQuery(
			`SELECT TOP 1 1 FROM dbo.imPersonalEmpresas WHERE IdEmpresa = @p0 AND IdPersonal = @p1`,
			[
				{ value: idEmpresa, type: 'Int' },
				{ value: idPersonal, type: 'Int' },
			],
		);
		if (!vinculo.length) {
			const e = new Error('El usuario no está vinculado a esta empresa');
			e.statusCode = 404;
			throw e;
		}

		if (
			body.apellido != null ||
			body.nombres != null ||
			body.nombreRed != null ||
			body.numeroDocumento != null ||
			body.codOperador != null ||
			body.legajo != null
		) {
			const actual = await usersService.obtenerUsuarioPorId(idPersonal);
			await usersService.actualizarUsuario(idPersonal, {
				codOperador: body.codOperador ?? actual?.CodOperador ?? '',
				apellido: body.apellido ?? actual?.Apellido ?? '',
				nombres: body.nombres ?? actual?.Nombres ?? '',
				nombreRed: body.nombreRed ?? actual?.NombreRed ?? '',
				numeroDocumento: body.numeroDocumento ?? actual?.NumeroDocumento ?? '',
				legajo: body.legajo ?? actual?.Legajo ?? '',
			});
		}

		if (body.password?.trim()) {
			await usersService.cambiarPassword(idPersonal, body.password.trim());
		}

		if (body.idRol != null && body.idRol !== '') {
			await rolesService.asignarRolAPersonal(idPersonal, Number(body.idRol));
			await authCentralSync.syncPersonal(idEmpresa, idPersonal);
		}

		if (Array.isArray(body.sectores)) {
			await tenantDb.executeQuery(`DELETE FROM dbo.imPersonalSectores WHERE idPersonal = @p0`, [
				{ value: idPersonal, type: 'Int' },
			]);
			for (const idSector of body.sectores) {
				try {
					await usersService.asignarSector(idPersonal, String(idSector));
				} catch (err) {
					if (!String(err.message || '').includes('ya tiene asignado')) throw err;
				}
			}
		}

		await authCentralSync.syncUserLoginBundle(idEmpresa, idPersonal);

		const lista = await listarUsuariosEmpresa(idEmpresa);
		return lista.find((u) => u.idPersonal === idPersonal) || null;
	});
}

async function eliminarEmpresa(idEmpresa) {
	if (useMysqlPlatform()) {
		return platformMysql.eliminarEmpresa(idEmpresa);
	}

	const exists = await executeQuery(`SELECT TOP 1 IDEMPRESA FROM dbo.Empresas WHERE IDEMPRESA = @p0`, [
		{ value: idEmpresa, type: 'Int' },
	]);
	if (!exists.length) {
		const e = new Error('Empresa no encontrada');
		e.statusCode = 404;
		throw e;
	}

	const tablas = [
		'EmpresasModuloPack',
		'EmpresasOnboarding',
		'EmpresasSuscripcion',
		'imPersonalEmpresas',
	];
	for (const t of tablas) {
		try {
			await executeQuery(`DELETE FROM dbo.${t} WHERE IdEmpresa = @p0`, [
				{ value: idEmpresa, type: 'Int' },
			]);
		} catch (e) {
			console.warn(`[superAdmin] eliminarEmpresa ${t}:`, e.message);
		}
	}

	await executeQuery(`DELETE FROM dbo.Empresas WHERE IDEMPRESA = @p0`, [
		{ value: idEmpresa, type: 'Int' },
	]);
	return { ok: true, idEmpresa };
}

async function crearSector(data) {
	const idEmpresa = Number(data.idEmpresa);
	if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
		const e = new Error('idEmpresa es obligatorio para crear sectores en el tenant');
		e.statusCode = 400;
		throw e;
	}

	if (await esEmpresaNube(idEmpresa)) {
		return nubeTenant.crearSector(idEmpresa, { valor: data.valor, descripcion: data.descripcion, ambInt: data.ambInt });
	}

	return runWithTenant(idEmpresa, async () => {
		const valor = String(data.valor || '')
			.trim()
			.toUpperCase()
			.slice(0, 3);
		const descripcion = String(data.descripcion || '').trim();
		if (!valor || valor.length < 2) {
			const e = new Error('El código del sector es obligatorio (2-3 caracteres)');
			e.statusCode = 400;
			throw e;
		}
		if (!descripcion) {
			const e = new Error('La descripción del sector es obligatoria');
			e.statusCode = 400;
			throw e;
		}

		const dup = await tenantDb.executeQuery(`SELECT TOP 1 Valor FROM dbo.imSectores WHERE Valor = @p0`, [
			{ value: valor, type: 'VarChar' },
		]);
		if (dup.length) {
			const e = new Error('Ya existe un sector con ese código');
			e.statusCode = 409;
			throw e;
		}

		const ambInt = String(data.ambInt || 'A').trim().slice(0, 1) || 'A';
		const valorServicio = `${valor} `.slice(0, 4);

		await tenantDb.executeQuery(
			`
    INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt)
    VALUES (@p0, @p1, @p2, 0, @p3)
    `,
			[
				{ value: valor, type: 'VarChar' },
				{ value: valorServicio, type: 'VarChar' },
				{ value: descripcion, type: 'VarChar' },
				{ value: ambInt, type: 'Char' },
			],
		);

		await authCentralSync.syncSector(idEmpresa, valor);
		return { id: valor, descripcion, ambInt };
	});
}

async function actualizarSector(valor, data) {
	const idEmpresa = Number(data.idEmpresa);
	if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
		const e = new Error('idEmpresa es obligatorio para actualizar sectores del tenant');
		e.statusCode = 400;
		throw e;
	}

	if (await esEmpresaNube(idEmpresa)) {
		return nubeTenant.actualizarSector(idEmpresa, valor, { descripcion: data.descripcion, ambInt: data.ambInt });
	}

	return runWithTenant(idEmpresa, async () => {
		const id = String(valor || '').trim().toUpperCase();
		const descripcion = String(data.descripcion || '').trim();
		if (!descripcion) {
			const e = new Error('La descripción es obligatoria');
			e.statusCode = 400;
			throw e;
		}

		const ambInt =
			data.ambInt != null ? String(data.ambInt).trim().slice(0, 1) || 'A' : undefined;

		if (ambInt) {
			await tenantDb.executeQuery(
				`UPDATE dbo.imSectores SET Descripcion = @p1, AmbInt = @p2 WHERE Valor = @p0`,
				[
					{ value: id, type: 'VarChar' },
					{ value: descripcion, type: 'VarChar' },
					{ value: ambInt, type: 'Char' },
				],
			);
		} else {
			await tenantDb.executeQuery(`UPDATE dbo.imSectores SET Descripcion = @p1 WHERE Valor = @p0`, [
				{ value: id, type: 'VarChar' },
				{ value: descripcion, type: 'VarChar' },
			]);
		}

		await authCentralSync.syncSector(idEmpresa, id);
		return { id, descripcion, ambInt: ambInt || null };
	});
}

async function eliminarSector(valor, idEmpresa) {
	const tenantId = Number(idEmpresa);
	if (!Number.isFinite(tenantId) || tenantId <= 0) {
		const e = new Error('idEmpresa es obligatorio para eliminar sectores del tenant');
		e.statusCode = 400;
		throw e;
	}

	if (await esEmpresaNube(tenantId)) {
		return nubeTenant.eliminarSector(tenantId, valor);
	}

	return runWithTenant(tenantId, async () => {
		const id = String(valor || '').trim().toUpperCase();
		const enUso = await tenantDb.executeQuery(
			`SELECT TOP 1 1 FROM dbo.imPersonalSectores WHERE idSector = @p0`,
			[{ value: id, type: 'VarChar' }],
		);
		if (enUso.length) {
			const e = new Error('No se puede eliminar: el sector está asignado a personal');
			e.statusCode = 409;
			throw e;
		}

		await tenantDb.executeQuery(`DELETE FROM dbo.imSectores WHERE Valor = @p0`, [
			{ value: id, type: 'VarChar' },
		]);
		await authCentralSync.removeSector(tenantId, id);
		return { ok: true, id };
	});
}

async function upsertSuscripcion(idEmpresa, data) {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.upsertSuscripcion(idEmpresa, data);
		} catch (e) {
			console.warn('[superAdmin] upsertSuscripcion MySQL:', e.message);
			return obtenerSuscripcionEmpresa(idEmpresa);
		}
	}
	try {
		const exists = await executeQuery(
			`SELECT IdEmpresa FROM dbo.EmpresasSuscripcion WHERE IdEmpresa = @p0`,
			[{ value: idEmpresa, type: 'Int' }],
		);
		const params = [
			{ value: idEmpresa, type: 'Int' },
			{ value: data.plan || 'STARTER', type: 'VarChar' },
			{ value: data.estado || 'PRUEBA', type: 'VarChar' },
			{ value: data.importeMensual ?? null, type: 'Decimal' },
			{ value: data.moneda || 'ARS', type: 'VarChar' },
			{ value: data.fechaProximoCobro || null, type: 'Date' },
			{ value: data.metodoPago || '', type: 'VarChar' },
			{ value: data.notas || '', type: 'VarChar' },
		];
		if (exists.length) {
			await executeQuery(
				`
        UPDATE dbo.EmpresasSuscripcion SET
          [Plan] = @p1, Estado = @p2, ImporteMensual = @p3, Moneda = @p4,
          FechaProximoCobro = @p5, MetodoPago = @p6, Notas = @p7
        WHERE IdEmpresa = @p0
        `,
				params,
			);
		} else {
			await executeQuery(
				`
        INSERT INTO dbo.EmpresasSuscripcion
          (IdEmpresa, [Plan], Estado, ImporteMensual, Moneda, FechaInicio, FechaProximoCobro, MetodoPago, Notas)
        VALUES (@p0, @p1, @p2, @p3, @p4, GETDATE(), @p5, @p6, @p7)
        `,
				params,
			);
		}
	} catch (e) {
		console.warn('[superAdmin] EmpresasSuscripcion:', e.message);
	}
	return obtenerSuscripcionEmpresa(idEmpresa);
}

async function listarUsuariosEmpresa(idEmpresa) {
	if (await gestionAuthEnRailway()) {
		try {
			return await nubeTenant.listarUsuariosEmpresa(idEmpresa);
		} catch {
			return [];
		}
	}
	// Los nombres de rol son globales de plataforma (Railway), no del SQL físico legacy.
	const rolesNube = await nubeTenant.listarRoles().catch(() => []);
	const rolNombrePorId = new Map(rolesNube.map((r) => [Number(r.idRol), r.nombre]));

	return runWithTenant(idEmpresa, async () => {
		try {
			const rows = await tenantDb.executeQuery(
				`
      SELECT
        pw.ValorPersonal AS IdPersonal,
        pw.NombreRed AS Usuario,
        pw.Nombres AS Nombre,
        pw.Apellido AS Apellido,
        pw.NumeroDocumento AS NumeroDocumento,
        pw.CodOperador AS CodOperador,
        LTRIM(RTRIM(p.Rol)) AS IdRol,
        p.Estado AS EstadoPersonal
      FROM dbo.imPersonalEmpresas pe
      INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = pe.IdPersonal
      LEFT JOIN dbo.imPersonal p ON p.Valor = pe.IdPersonal
      WHERE pe.IdEmpresa = @p0
      ORDER BY pw.Apellido, pw.Nombres
      `,
				[{ value: idEmpresa, type: 'Int' }],
			);

			const usuarios = [];
			for (const r of rows) {
				const idPersonal = Number(r.IdPersonal);
				let sectores = [];
				try {
					const secRows = await tenantDb.executeQuery(
						`
          SELECT ps.idSector AS idSector, s.Descripcion AS descripcion
          FROM dbo.imPersonalSectores ps
          LEFT JOIN dbo.imSectores s ON s.Valor = ps.idSector
          WHERE ps.idPersonal = @p0
          `,
						[{ value: idPersonal, type: 'Int' }],
					);
					sectores = (secRows || []).map((s) => ({
						id: String(s.idSector || ''),
						descripcion: String(s.descripcion || s.idSector || ''),
					}));
				} catch {
					sectores = [];
				}
				usuarios.push({
					idPersonal,
					usuario: String(r.Usuario || '').trim(),
					nombre: String(r.Nombre || '').trim(),
					apellido: String(r.Apellido || '').trim(),
					numeroDocumento: String(r.NumeroDocumento || '').trim(),
					codOperador: r.CodOperador,
					idRol: r.IdRol != null && r.IdRol !== '' ? Number(r.IdRol) : null,
					rol: r.IdRol != null ? rolNombrePorId.get(Number(r.IdRol)) || null : null,
					activo: r.EstadoPersonal == null || Number(r.EstadoPersonal) === 1,
					sectores,
				});
			}
			return usuarios;
		} catch {
			return [];
		}
	});
}

async function listarTodosUsuarios(filtro = '') {
	const q = String(filtro || '').trim();
	const params = [];
	let where = '';
	if (q) {
		where = `WHERE pw.NombreRed LIKE @p0 OR pw.Nombres LIKE @p0 OR pw.Apellido LIKE @p0`;
		params.push({ value: `%${q}%`, type: 'VarChar' });
	}

	const sqlConEmpresas = `
    SELECT TOP 200
      pw.ValorPersonal AS IdPersonal,
      pw.NombreRed AS Usuario,
      pw.Nombres AS Nombre,
      pw.Apellido AS Apellido,
      r.Nombre AS RolNombre,
      STUFF((
        SELECT ', ' + e.DESCRIPCION
        FROM dbo.imPersonalEmpresas pe2
        INNER JOIN dbo.Empresas e ON e.IDEMPRESA = pe2.IdEmpresa
        WHERE pe2.IdPersonal = pw.ValorPersonal
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Empresas
    FROM dbo.imPassword pw
    LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
    LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
    ${where}
    ORDER BY pw.Apellido, pw.Nombres`;

	const sqlSimple = `
    SELECT TOP 200
      pw.ValorPersonal AS IdPersonal,
      pw.NombreRed AS Usuario,
      pw.Nombres AS Nombre,
      pw.Apellido AS Apellido,
      r.Nombre AS RolNombre,
      CAST('' AS NVARCHAR(500)) AS Empresas
    FROM dbo.imPassword pw
    LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
    LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
    ${where}
    ORDER BY pw.Apellido, pw.Nombres`;

	let rows;
	try {
		rows = await executeQuery(sqlConEmpresas, params);
	} catch (e) {
		const msg = String(e?.message || '').toLowerCase();
		if (msg.includes('impersonalempresas') || msg.includes('invalid object name')) {
			rows = await executeQuery(sqlSimple, params);
		} else {
			throw e;
		}
	}

	return rows.map((r) => ({
		idPersonal: Number(r.IdPersonal),
		usuario: String(r.Usuario || '').trim(),
		nombre: String(r.Nombre || '').trim(),
		apellido: String(r.Apellido || '').trim(),
		rol: r.RolNombre || null,
		empresas: r.Empresas || '',
	}));
}

async function vincularUsuarioEmpresa(idEmpresa, idPersonal) {
	if (await esEmpresaNube(idEmpresa)) {
		await nubeTenant.vincularUsuarioEmpresa(idEmpresa, idPersonal);
		return listarUsuariosEmpresa(idEmpresa);
	}
	return runWithTenant(idEmpresa, async () => {
		await tenantDb.executeQuery(
			`
    IF NOT EXISTS (SELECT 1 FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1)
      INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)
    `,
			[
				{ value: idPersonal, type: 'Int' },
				{ value: idEmpresa, type: 'Int' },
			],
		);
		await authCentralSync.syncPersonalEmpresa(idEmpresa, idPersonal);
		return listarUsuariosEmpresa(idEmpresa);
	});
}

async function desvincularUsuarioEmpresa(idEmpresa, idPersonal) {
	if (await esEmpresaNube(idEmpresa)) {
		return nubeTenant.desvincularUsuarioEmpresa(idEmpresa, idPersonal);
	}
	return runWithTenant(idEmpresa, async () => {
		await tenantDb.executeQuery(
			`DELETE FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1`,
			[
				{ value: idPersonal, type: 'Int' },
				{ value: idEmpresa, type: 'Int' },
			],
		);
		await authCentralSync.removePersonalEmpresa(idEmpresa, idPersonal);
		await authCentralSync.purgePersonalAuthIfOrphan(idPersonal);
		return listarUsuariosEmpresa(idEmpresa);
	});
}

async function obtenerDashboard() {
	const empresas = await listarEmpresas();
	const activas = empresas.filter((e) => e.suscripcion?.estado === 'ACTIVA').length;
	const prueba = empresas.filter((e) => e.suscripcion?.estado === 'PRUEBA').length;
	const suspendidas = empresas.filter((e) => e.suscripcion?.estado === 'SUSPENDIDA').length;
	const onboardingPend = empresas.filter((e) => !e.onboarding?.completado).length;

	let usuariosTotal = 0;
	try {
		if (useMysqlPlatform()) {
			usuariosTotal = await platformMysql.contarUsuariosAuth();
		} else {
			const u = await executeQuery(`SELECT COUNT(DISTINCT ValorPersonal) AS c FROM dbo.imPassword`);
			usuariosTotal = Number(u[0]?.c) || 0;
		}
	} catch {
		/* ignore */
	}

	return {
		totalEmpresas: empresas.length,
		suscripcionesActivas: activas,
		enPrueba: prueba,
		suspendidas,
		onboardingPendiente: onboardingPend,
		totalUsuarios: usuariosTotal,
		empresasRecientes: empresas.slice(0, 8),
	};
}

async function obtenerCatalogos() {
	return {
		packs: PACKS_PRINCIPALES,
		modulosGenerales: MODULOS_GENERALES,
		pasosOnboarding: PASOS_ONBOARDING,
		planes: PLANES,
		estadosSuscripcion: ESTADOS_SUSCRIPCION,
		sectores: [],
		roles: [],
	};
}

async function obtenerCatalogosTenant(idEmpresa) {
	const base = await obtenerCatalogos();

	// Los roles son un catálogo GLOBAL de plataforma (viven en Railway). Los servidores
	// clínicos físicos legacy no tienen imRoles, así que siempre se leen de la nube.
	const roles = await nubeTenant.listarRoles().catch(() => []);

	if (await gestionAuthEnRailway()) {
		const sectores = await nubeTenant.listarSectores(idEmpresa).catch(() => []);
		return { ...base, sectores, roles };
	}

	return runWithTenant(idEmpresa, async () => {
		const sectores = await sectoresService.obtenerSectores().catch(() => []);
		return {
			...base,
			sectores: (sectores || []).map((s) => ({
				id: String(s.IdSector ?? s.idSector ?? ''),
				descripcion: String(s.Descripcion ?? s.descripcionSector ?? ''),
				ambInt: s.AmbInt != null ? String(s.AmbInt).trim() : undefined,
			})),
			roles,
		};
	});
}

async function obtenerModulosEmpresaActiva(idEmpresa) {
	const packs = await obtenerPacksEmpresa(idEmpresa);
	return {
		packs,
		modulosHabilitados: todosModulosHabilitados(),
		modulosGenerales: [...MODULOS_GENERALES],
	};
}

async function listarConfigPlataforma() {
	if (useMysqlPlatform()) {
		try {
			return await platformMysql.listarConfigPlataforma();
		} catch {
			return [];
		}
	}
	try {
		const rows = await executeQuery(
			`SELECT Clave, Valor, Descripcion FROM dbo.imPlataformaConfig ORDER BY Clave`,
		);
		return rows.map((r) => ({
			clave: r.Clave,
			valor: r.Valor,
			descripcion: r.Descripcion || '',
		}));
	} catch {
		return [];
	}
}

async function guardarConfigPlataforma(clave, valor) {
	if (useMysqlPlatform()) {
		return platformMysql.guardarConfigPlataforma(clave, valor);
	}
	await executeQuery(
		`
    IF EXISTS (SELECT 1 FROM dbo.imPlataformaConfig WHERE Clave = @p0)
      UPDATE dbo.imPlataformaConfig SET Valor = @p1, FechaMod = GETDATE() WHERE Clave = @p0
    ELSE
      INSERT INTO dbo.imPlataformaConfig (Clave, Valor) VALUES (@p0, @p1)
    `,
		[
			{ value: clave, type: 'VarChar' },
			{ value: valor, type: 'NVarChar' },
		],
	);
	return listarConfigPlataforma();
}

module.exports = {
	listarEmpresas,
	obtenerEmpresaDetalle,
	crearEmpresa,
	actualizarEmpresa,
	actualizarConexionEmpresa,
	probarConexionEmpresa,
	probarConexionDatos,
	listarTablasImportables,
	previewTablaImportable,
	importarTablasEmpresa,
	eliminarEmpresa,
	actualizarPacksEmpresa,
	upsertOnboarding,
	upsertSuscripcion,
	listarUsuariosEmpresa,
	listarTodosUsuarios,
	vincularUsuarioEmpresa,
	desvincularUsuarioEmpresa,
	crearUsuarioEmpresa,
	actualizarUsuarioEmpresa,
	crearSector,
	actualizarSector,
	eliminarSector,
	obtenerDashboard,
	obtenerCatalogos,
	obtenerCatalogosTenant,
	obtenerModulosEmpresaActiva,
	listarConfigPlataforma,
	guardarConfigPlataforma,
};
