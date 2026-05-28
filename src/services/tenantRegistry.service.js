/**
 * Registro de tenants y descubrimiento de usuario para login multi-BD.
 * Catálogo: BD plataforma (.env). Datos clínicos: BD por empresa.
 */
const { connectDB } = require('../config/database');
const {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
} = require('../config/tenantDb');
const { encrypt } = require('../utils/dbCrypto');
const authCentralService = require('./authCentral.service');

const DISCOVER_MAX = Number(process.env.TENANT_DISCOVER_MAX) || 25;

async function listarEmpresasActivas() {
	const pool = await connectDB();
	const rows = await pool.request().query(`
    SELECT IDEMPRESA, DESCRIPCION
    FROM dbo.Empresas
    ORDER BY DESCRIPCION
  `);
	return rows.recordset || [];
}


/**
 * Autentica en una BD tenant concreta.
 */
async function autenticarEnTenant(idEmpresa, username, password) {
	const pool = await getTenantPool(idEmpresa);
	const result = await pool
		.request()
		.input('user', username)
		.input('pass', password)
		.query(`
      SELECT TOP 1
        pw.*,
        p.Matricula AS Matricula,
        r.IdRol AS RolId,
        r.Nombre AS RolNombre,
        r.Nivel AS RolNivel
      FROM impassword pw
      LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
      LEFT JOIN imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
      WHERE (
          UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@user)))
          OR UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@user)))
        )
        AND pw.Password = @pass
    `);

	if (!result.recordset?.length) return null;
	return result.recordset[0];
}

/** Agrupa empresas del catálogo que comparten la misma conexión SQL (evita duplicar por misma BD). */
async function agruparEmpresasPorConexion(catalog) {
	const groups = new Map();
	for (const emp of catalog) {
		const row = await loadEmpresaConnectionRow(emp.IDEMPRESA);
		const key = configCacheKey(rowToSqlConfig(row));
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(emp);
	}
	return groups;
}

const SQL_EMPRESAS_ASIGNADAS = `
  SELECT DISTINCT
    pe.IdEmpresa AS idEmpresa,
    RTRIM(LTRIM(ISNULL(e.DESCRIPCION, ''))) AS descripcionEmpresa,
    pw.ValorPersonal AS valorPersonal
  FROM impassword pw
  INNER JOIN dbo.imPersonalEmpresas pe ON pe.IdPersonal = pw.ValorPersonal
  INNER JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
  WHERE UPPER(RTRIM(LTRIM(ISNULL(pw.NombreRed, pw.nombrered)))) = UPPER(RTRIM(LTRIM(@user)))
`;

/**
 * Empresas asignadas al usuario vía imPersonalEmpresas en una BD tenant.
 */
async function consultarEmpresasAsignadasEnTenant(idEmpresaProbe, username) {
	const pool = await getTenantPool(idEmpresaProbe);
	try {
		const result = await pool.request().input('user', username).query(SQL_EMPRESAS_ASIGNADAS);
		return result.recordset || [];
	} catch (err) {
		const msg = String(err?.message || '').toLowerCase();
		if (!msg.includes('impersonalempresas')) throw err;

		const pw = await pool.request().input('user', username).query(`
      SELECT TOP 1 pw.ValorPersonal
      FROM impassword pw
      WHERE UPPER(RTRIM(LTRIM(ISNULL(pw.NombreRed, pw.nombrered)))) = UPPER(RTRIM(LTRIM(@user)))
    `);
		if (!pw.recordset?.length) return [];

		const row = await loadEmpresaConnectionRow(idEmpresaProbe);
		return [
			{
				idEmpresa: Number(idEmpresaProbe),
				descripcionEmpresa: String(row?.DESCRIPCION || '').trim(),
				valorPersonal: Number(pw.recordset[0].ValorPersonal),
			},
		];
	}
}

/**
 * Descubre empresas donde el usuario está asignado (imPersonalEmpresas), no solo si existe en impassword.
 */
async function descubrirEmpresasPorUsuario(username) {
	const u = String(username || '').trim();
	if (!u) return [];

	if (authCentralService.isAuthCentralEnabled()) {
		try {
			const central = await authCentralService.descubrirEmpresas(u);
			if (central.length) return central;
		} catch (e) {
			console.warn('[authCentral] descubrirEmpresasPorUsuario:', e.message);
		}
	}

	const catalog = await listarEmpresasActivas();
	const catalogIds = new Set(catalog.map((c) => Number(c.IDEMPRESA)));
	const groups = await agruparEmpresasPorConexion(catalog);

	const found = [];
	const seen = new Set();
	let scanned = 0;

	for (const group of groups.values()) {
		if (scanned >= DISCOVER_MAX) break;
		scanned += 1;

		const probeId = Number(group[0].IDEMPRESA);
		try {
			const rows = await consultarEmpresasAsignadasEnTenant(probeId, u);
			for (const r of rows) {
				const idEmpresa = Number(r.idEmpresa);
				if (!catalogIds.has(idEmpresa) || seen.has(idEmpresa)) continue;
				seen.add(idEmpresa);
				const plat = catalog.find((c) => Number(c.IDEMPRESA) === idEmpresa);
				found.push({
					idEmpresa,
					descripcionEmpresa: String(r.descripcionEmpresa || plat?.DESCRIPCION || '').trim(),
					valorPersonal: Number(r.valorPersonal),
					fuente: 'asignacion',
				});
			}
		} catch (e) {
			console.warn(`[tenantRegistry] descubrir tenant ${probeId}:`, e.message);
		}
	}

	if (found.length) {
		return found.sort((a, b) => a.descripcionEmpresa.localeCompare(b.descripcionEmpresa));
	}

	return [];
}

async function autenticarEnPlataforma(username, password) {
	return autenticarEnTenant(null, username, password);
}

/**
 * Login: valida password y devuelve usuario + idEmpresa.
 * Si idEmpresa viene definido, solo prueba esa BD; si no, plataforma + índice + scan.
 */
async function resolverLogin(username, password, idEmpresaPreferida = null) {
	const u = String(username || '').trim();
	const p = String(password || '');

	if (!u || !p) {
		const e = new Error('Usuario y contraseña son obligatorios');
		e.statusCode = 400;
		throw e;
	}

	// idEmpresa 0 o vacío = autenticar en BD plataforma (Super Admin)
	if (idEmpresaPreferida === 0 || idEmpresaPreferida === '0') {
		if (authCentralService.isAuthCentralEnabled()) {
			try {
				const usuarioCentral = await authCentralService.autenticarPlataforma(u, p);
				if (usuarioCentral) {
					return { idEmpresa: null, usuario: usuarioCentral };
				}
			} catch (e) {
				console.warn('[authCentral] login plataforma:', e.message);
			}
		}

		const usuario = await autenticarEnPlataforma(u, p);
		if (!usuario) {
			const e = new Error('Credenciales inválidas');
			e.statusCode = 401;
			throw e;
		}
		return { idEmpresa: null, usuario };
	}

	if (idEmpresaPreferida != null && idEmpresaPreferida !== '') {
		const id = Number(idEmpresaPreferida);
		if (authCentralService.isAuthCentralEnabled()) {
			try {
				const usuarioCentral = await authCentralService.autenticarTenant(id, u, p);
				if (usuarioCentral) {
					return { idEmpresa: id, usuario: usuarioCentral };
				}
			} catch (e) {
				console.warn(`[authCentral] login empresa ${id}:`, e.message);
			}
		}

		const usuario = await autenticarEnTenant(id, u, p);
		if (!usuario) {
			const e = new Error('Credenciales inválidas para la empresa seleccionada');
			e.statusCode = 401;
			throw e;
		}
		return { idEmpresa: id, usuario };
	}

	if (authCentralService.isAuthCentralEnabled()) {
		try {
			const usuarioPlataformaCentral = await authCentralService.autenticarPlataforma(u, p);
			if (usuarioPlataformaCentral) {
				const rolId = usuarioPlataformaCentral.RolId ?? usuarioPlataformaCentral.Rol;
				const rolNombre = String(usuarioPlataformaCentral.RolNombre || '').toUpperCase();
				if (rolNombre === 'SUPER_ADMIN' || String(rolId) === '5' || Number(usuarioPlataformaCentral.Grupo) === 11) {
					return { idEmpresa: null, usuario: usuarioPlataformaCentral };
				}
			}

			const matchesCentral = await authCentralService.autenticarEnTodasLasEmpresas(u, p);
			if (matchesCentral.length > 1) {
				const e = new Error('MULTI_EMPRESA');
				e.statusCode = 409;
				e.empresas = matchesCentral.map((m) => ({
					idEmpresa: m.idEmpresa,
					descripcionEmpresa: m.descripcionEmpresa,
				}));
				throw e;
			}
			if (matchesCentral.length === 1) {
				const { idEmpresa, usuario } = matchesCentral[0];
				return { idEmpresa, usuario };
			}
		} catch (e) {
			if (e.statusCode === 409) throw e;
			console.warn('[authCentral] resolverLogin multiempresa:', e.message);
		}
	}

	const usuarioPlataforma = await autenticarEnPlataforma(u, p);
	if (usuarioPlataforma) {
		const rolId = usuarioPlataforma.RolId ?? usuarioPlataforma.Rol;
		const rolNombre = String(usuarioPlataforma.RolNombre || '').toUpperCase();
		if (rolNombre === 'SUPER_ADMIN' || String(rolId) === '5' || Number(usuarioPlataforma.Grupo) === 11) {
			return { idEmpresa: null, usuario: usuarioPlataforma };
		}
	}

	const candidatos = await descubrirEmpresasPorUsuario(u);
	if (!candidatos.length) {
		const e = new Error('Usuario no encontrado en ninguna empresa activa');
		e.statusCode = 401;
		throw e;
	}

	const matches = [];
	for (const c of candidatos) {
		const usuario = await autenticarEnTenant(c.idEmpresa, u, p);
		if (usuario) {
			matches.push({ idEmpresa: c.idEmpresa, usuario, descripcionEmpresa: c.descripcionEmpresa });
		}
	}

	if (!matches.length) {
		const e = new Error('Credenciales inválidas');
		e.statusCode = 401;
		throw e;
	}

	if (matches.length > 1) {
		const e = new Error('MULTI_EMPRESA');
		e.statusCode = 409;
		e.empresas = matches.map((m) => ({
			idEmpresa: m.idEmpresa,
			descripcionEmpresa: m.descripcionEmpresa,
		}));
		throw e;
	}

	const { idEmpresa, usuario } = matches[0];
	return { idEmpresa, usuario };
}

/** Empresas del usuario en el tenant (imPersonalEmpresas) + catálogo plataforma. */
async function empresasDelUsuarioEnTenant(idEmpresa, username) {
	const u = String(username || '').trim();
	const pool = await getTenantPool(idEmpresa);

	try {
		const rows = await pool.request().input('user', u).query(`
      SELECT pe.IdEmpresa AS idEmpresa, RTRIM(LTRIM(ISNULL(e.DESCRIPCION, ''))) AS descripcionEmpresa
      FROM impassword pw
      INNER JOIN dbo.imPersonalEmpresas pe ON pe.IdPersonal = pw.ValorPersonal
      INNER JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
      WHERE UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@user)))
         OR UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@user)))
      ORDER BY e.DESCRIPCION
    `);
		if (rows.recordset?.length) return rows.recordset;
	} catch (err) {
		const msg = String(err?.message || '').toLowerCase();
		if (!msg.includes('impersonalempresas')) throw err;
	}

	const row = await loadEmpresaConnectionRow(idEmpresa);
	return [
		{
			idEmpresa: Number(idEmpresa),
			descripcionEmpresa: String(row?.DESCRIPCION || '').trim(),
		},
	];
}

async function guardarConexionEmpresa(idEmpresa, data) {
	const id = Number(idEmpresa);
	const enc =
		data.dbPassword != null && String(data.dbPassword).trim() !== ''
			? encrypt(String(data.dbPassword))
			: data.dbPasswordEnc !== undefined
				? data.dbPasswordEnc
				: null;

	const pool = await connectDB();
	const cols = await pool.request().query(`
    SELECT LOWER(name) AS col
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Empresas')
  `);
	const colSet = new Set((cols.recordset || []).map((r) => String(r.col || '').trim()));
	const has = (name) => colSet.has(String(name).toLowerCase());

	const request = pool
		.request()
		.input('id', id)
		.input('srv', data.dbServer || null)
		.input('port', data.dbPort != null ? Number(data.dbPort) : null)
		.input('inst', data.dbInstance || null)
		.input('db', data.dbName || null)
		.input('usr', data.dbUser || null)
		.input('pwd', enc);

	const sets = [];
	if (has('DbServer')) sets.push('DbServer = COALESCE(@srv, DbServer)');
	if (has('DbPort')) sets.push('DbPort = COALESCE(@port, DbPort)');
	if (has('DbInstance')) sets.push('DbInstance = @inst');
	if (has('DbName')) sets.push('DbName = COALESCE(@db, DbName)');
	if (has('DbUser')) sets.push('DbUser = COALESCE(@usr, DbUser)');
	if (has('DbPasswordEnc')) {
		sets.push('DbPasswordEnc = CASE WHEN @pwd IS NOT NULL THEN @pwd ELSE DbPasswordEnc END');
	}
	if (sets.length) {
		await request.query(`
      UPDATE dbo.Empresas SET
        ${sets.join(',\n        ')}
      WHERE IDEMPRESA = @id
    `);
	}

	return loadEmpresaConnectionRow(id);
}

module.exports = {
	listarEmpresasActivas,
	descubrirEmpresasPorUsuario,
	resolverLogin,
	autenticarEnTenant,
	autenticarEnPlataforma,
	empresasDelUsuarioEnTenant,
	guardarConexionEmpresa,
};
