/**
 * Configuración del módulo Almacén (todo en BD, sin catálogos hardcodeados).
 * - Sectores orígenes (imSectores del hospital habilitados para pedir)
 * - Rubros
 * - Depósitos
 */
const { executeQuery } = require('../models/db');
const { ensureAlmacenSchema } = require('./almacen.schema');

function httpError(message, statusCode = 400) {
	const err = new Error(message);
	err.statusCode = statusCode;
	return err;
}

function str(v, max) {
	const s = v == null ? '' : String(v).trim();
	return max ? s.slice(0, max) : s;
}

function num(v, def = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : def;
}

async function ensure() {
	await ensureAlmacenSchema();
}

// ─── Sectores hospital (maestro) ─────────────────────────────────────────────

async function listarSectoresHospital() {
	await ensure();
	try {
		return (
			(await executeQuery(`
        SELECT
          CAST(s.Valor AS NVARCHAR(50)) AS IdSector,
          s.Descripcion AS Nombre,
          s.AmbInt
        FROM dbo.imSectores s
        ORDER BY s.Descripcion
      `)) || []
		);
	} catch (e) {
		console.warn('[almacen.config] imSectores no disponible:', e.message);
		return [];
	}
}

/** Sectores asignados al personal en sesión (origen real del pedido). */
async function listarSectoresDelUsuario(valorPersonal) {
	await ensure();
	if (valorPersonal == null || !Number.isFinite(Number(valorPersonal))) return [];
	try {
		return (
			(await executeQuery(
				`
        SELECT
          CAST(ps.idSector AS NVARCHAR(50)) AS IdSector,
          ISNULL(s.Descripcion, CAST(ps.idSector AS NVARCHAR(100))) AS Nombre
        FROM dbo.imPersonalSectores ps
        LEFT JOIN dbo.imSectores s ON CAST(s.Valor AS NVARCHAR(50)) = CAST(ps.idSector AS NVARCHAR(50))
        WHERE ps.idPersonal = @p0
        ORDER BY s.Descripcion
        `,
				[{ value: Number(valorPersonal) }],
			)) || []
		);
	} catch (e) {
		console.warn('[almacen.config] imPersonalSectores:', e.message);
		return [];
	}
}

// ─── Config sectores (origen habilitado en almacén) ──────────────────────────

async function listarConfigSectores({ soloActivos = false } = {}) {
	await ensure();
	const where = soloActivos ? 'WHERE c.Activo = 1' : '';
	return (
		(await executeQuery(`
      SELECT
        c.IdConfig,
        CAST(c.IdSector AS NVARCHAR(50)) AS IdSector,
        ISNULL(s.Descripcion, CAST(c.IdSector AS NVARCHAR(100))) AS Nombre,
        c.IdDeposito,
        d.Codigo AS DepositoCodigo,
        d.Nombre AS DepositoNombre,
        c.PuedeSolicitar,
        c.Activo,
        c.Orden,
        c.Observaciones
      FROM dbo.imAlmacenConfigSector c
      LEFT JOIN dbo.imSectores s ON CAST(s.Valor AS NVARCHAR(50)) = CAST(c.IdSector AS NVARCHAR(50))
      LEFT JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = c.IdDeposito
      ${where}
      ORDER BY c.Orden, Nombre
    `)) || []
	);
}

/**
 * Orígenes de solicitud:
 * - Por defecto (soloMios): sectores/servicios del personal en sesión.
 * - gestionaTodo + !soloMios: catálogo config/almacén (filtros administrativos).
 */
async function listarOrigenesParaUsuario(authCtx = {}, { soloMios = true } = {}) {
	await ensure();
	const valorPersonal = authCtx.valorPersonal != null ? Number(authCtx.valorPersonal) : null;
	const gestionaTodo = !!authCtx.gestionaTodo;

	const delUser = await listarSectoresDelUsuario(valorPersonal);
	const config = await listarConfigSectores({ soloActivos: true });
	const confById = new Map(config.map((c) => [String(c.IdSector), c]));

	const mapUserSector = (u) => {
		const c = confById.get(String(u.IdSector));
		return {
			IdSector: String(u.IdSector),
			Nombre: u.Nombre || String(u.IdSector),
			IdConfig: c?.IdConfig ?? null,
			IdDeposito: c?.IdDeposito ?? null,
			DepositoCodigo: c?.DepositoCodigo || null,
			DepositoNombre: c?.DepositoNombre || null,
		};
	};

	// Producto: el origen es siempre el sector del usuario logueado
	if (soloMios || !gestionaTodo) {
		if (delUser.length) return delUser.map(mapUserSector);
		return [];
	}

	const confOk = config.filter(
		(c) => c.PuedeSolicitar === 1 || c.PuedeSolicitar === true || c.PuedeSolicitar == null,
	);
	const list = confOk.length ? confOk : await listarOrigenesDesdeSolicitudes();
	return list.map((r) => ({
		IdSector: String(r.IdSector),
		Nombre: r.Nombre || String(r.IdSector),
		IdConfig: r.IdConfig ?? null,
		IdDeposito: r.IdDeposito ?? null,
		DepositoCodigo: r.DepositoCodigo || null,
		DepositoNombre: r.DepositoNombre || null,
	}));
}

async function listarOrigenesDesdeSolicitudes() {
	return (
		(await executeQuery(`
      SELECT DISTINCT
        CAST(s.IdSector AS NVARCHAR(50)) AS IdSector,
        ISNULL(sec.Descripcion, ISNULL(s.Destino, CAST(s.IdSector AS NVARCHAR(100)))) AS Nombre,
        NULL AS IdConfig,
        NULL AS IdDeposito,
        NULL AS DepositoCodigo,
        NULL AS DepositoNombre,
        1 AS PuedeSolicitar,
        1 AS Activo
      FROM dbo.imAlmacenSolicitud s
      LEFT JOIN dbo.imSectores sec ON CAST(sec.Valor AS NVARCHAR(50)) = CAST(s.IdSector AS NVARCHAR(50))
      WHERE s.IdSector IS NOT NULL AND LTRIM(RTRIM(CAST(s.IdSector AS NVARCHAR(50)))) <> ''
      ORDER BY Nombre
    `)) || []
	);
}

async function upsertConfigSector(data) {
	await ensure();
	const idSector = str(data.idSector ?? data.IdSector, 50);
	if (!idSector) throw httpError('IdSector es obligatorio');
	const idDeposito =
		data.idDeposito != null && data.idDeposito !== ''
			? Number(data.idDeposito)
			: data.IdDeposito != null && data.IdDeposito !== ''
				? Number(data.IdDeposito)
				: null;
	const puede = data.puedeSolicitar === false || data.puedeSolicitar === 0 ? 0 : 1;
	const activo = data.activo === false || data.activo === 0 ? 0 : 1;
	const orden = num(data.orden ?? data.Orden, 0);
	const obs = str(data.observaciones ?? data.Observaciones, 200) || null;

	const existing = await executeQuery(
		`SELECT IdConfig FROM dbo.imAlmacenConfigSector WHERE CAST(IdSector AS NVARCHAR(50)) = @p0`,
		[{ value: idSector }],
	);
	if (existing?.[0]) {
		await executeQuery(
			`
      UPDATE dbo.imAlmacenConfigSector SET
        IdDeposito = @p0, PuedeSolicitar = @p1, Activo = @p2, Orden = @p3, Observaciones = @p4
      WHERE IdConfig = @p5
      `,
			[
				{ value: idDeposito },
				{ value: puede },
				{ value: activo },
				{ value: orden },
				{ value: obs },
				{ value: existing[0].IdConfig },
			],
		);
		return (await listarConfigSectores()).find((c) => c.IdConfig === existing[0].IdConfig);
	}

	const ins = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenConfigSector
      (IdSector, IdDeposito, PuedeSolicitar, Activo, Orden, Observaciones)
    OUTPUT INSERTED.IdConfig
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5)
    `,
		[
			{ value: idSector },
			{ value: idDeposito },
			{ value: puede },
			{ value: activo },
			{ value: orden },
			{ value: obs },
		],
	);
	const id = ins[0].IdConfig;
	return (await listarConfigSectores()).find((c) => c.IdConfig === id);
}

async function eliminarConfigSector(idConfig) {
	await ensure();
	await executeQuery(`DELETE FROM dbo.imAlmacenConfigSector WHERE IdConfig = @p0`, [
		{ value: Number(idConfig) },
	]);
	return true;
}

async function idDepositoPorIdSector(idSector) {
	if (!idSector) return null;
	const rows = await executeQuery(
		`
    SELECT TOP 1 IdDeposito
    FROM dbo.imAlmacenConfigSector
    WHERE CAST(IdSector AS NVARCHAR(50)) = @p0 AND Activo = 1
    `,
		[{ value: str(idSector, 50) }],
	);
	return rows?.[0]?.IdDeposito || null;
}

async function nombreSector(idSector) {
	if (!idSector) return null;
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 Descripcion FROM dbo.imSectores WHERE CAST(Valor AS NVARCHAR(50)) = @p0`,
			[{ value: str(idSector, 50) }],
		);
		if (rows?.[0]?.Descripcion) return rows[0].Descripcion;
	} catch (_) {
		/* ignore */
	}
	return str(idSector, 100);
}

// ─── Rubros ──────────────────────────────────────────────────────────────────

async function listarRubros({ soloActivos = true } = {}) {
	await ensure();
	const where = soloActivos ? 'WHERE Activo = 1' : '';
	return (
		(await executeQuery(`
      SELECT IdRubro, Codigo, Nombre, Activo, Orden
      FROM dbo.imAlmacenRubro
      ${where}
      ORDER BY Orden, Nombre
    `)) || []
	);
}

async function upsertRubro(data) {
	await ensure();
	const codigo = str(data.codigo ?? data.Codigo, 50).toUpperCase();
	const nombre = str(data.nombre ?? data.Nombre, 100);
	if (!codigo || !nombre) throw httpError('Código y nombre del rubro son obligatorios');
	const activo = data.activo === false || data.activo === 0 ? 0 : 1;
	const orden = num(data.orden ?? data.Orden, 0);
	const id = data.idRubro ?? data.IdRubro;

	if (id) {
		await executeQuery(
			`
      UPDATE dbo.imAlmacenRubro SET Codigo=@p0, Nombre=@p1, Activo=@p2, Orden=@p3
      WHERE IdRubro=@p4
      `,
			[
				{ value: codigo },
				{ value: nombre },
				{ value: activo },
				{ value: orden },
				{ value: Number(id) },
			],
		);
		return (await listarRubros({ soloActivos: false })).find((r) => r.IdRubro === Number(id));
	}

	const exists = await executeQuery(
		`SELECT IdRubro FROM dbo.imAlmacenRubro WHERE Codigo = @p0`,
		[{ value: codigo }],
	);
	if (exists?.[0]) {
		await executeQuery(
			`UPDATE dbo.imAlmacenRubro SET Nombre=@p0, Activo=@p1, Orden=@p2 WHERE IdRubro=@p3`,
			[
				{ value: nombre },
				{ value: activo },
				{ value: orden },
				{ value: exists[0].IdRubro },
			],
		);
		return (await listarRubros({ soloActivos: false })).find(
			(r) => r.IdRubro === exists[0].IdRubro,
		);
	}

	const ins = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenRubro (Codigo, Nombre, Activo, Orden)
    OUTPUT INSERTED.IdRubro VALUES (@p0,@p1,@p2,@p3)
    `,
		[{ value: codigo }, { value: nombre }, { value: activo }, { value: orden }],
	);
	return (await listarRubros({ soloActivos: false })).find((r) => r.IdRubro === ins[0].IdRubro);
}

async function eliminarRubro(id) {
	await ensure();
	await executeQuery(`DELETE FROM dbo.imAlmacenRubro WHERE IdRubro = @p0`, [
		{ value: Number(id) },
	]);
	return true;
}

// ─── Depósitos (alta/edición simple en config) ────────────────────────────────

async function listarDepositosConfig() {
	await ensure();
	return (
		(await executeQuery(`
      SELECT IdDeposito, Codigo, Nombre, EsPrincipal, Activo
      FROM dbo.imAlmacenDeposito
      ORDER BY EsPrincipal DESC, Nombre
    `)) || []
	);
}

async function upsertDeposito(data) {
	await ensure();
	const codigo = str(data.codigo ?? data.Codigo, 20).toUpperCase();
	const nombre = str(data.nombre ?? data.Nombre, 100);
	if (!codigo || !nombre) throw httpError('Código y nombre del depósito son obligatorios');
	const activo = data.activo === false || data.activo === 0 ? 0 : 1;
	const principal = data.esPrincipal === true || data.esPrincipal === 1 ? 1 : 0;
	const id = data.idDeposito ?? data.IdDeposito;

	if (id) {
		await executeQuery(
			`
      UPDATE dbo.imAlmacenDeposito SET Codigo=@p0, Nombre=@p1, EsPrincipal=@p2, Activo=@p3
      WHERE IdDeposito=@p4
      `,
			[
				{ value: codigo },
				{ value: nombre },
				{ value: principal },
				{ value: activo },
				{ value: Number(id) },
			],
		);
	} else {
		const exists = await executeQuery(
			`SELECT IdDeposito FROM dbo.imAlmacenDeposito WHERE Codigo = @p0`,
			[{ value: codigo }],
		);
		if (exists?.[0]) {
			await executeQuery(
				`UPDATE dbo.imAlmacenDeposito SET Nombre=@p0, EsPrincipal=@p1, Activo=@p2 WHERE IdDeposito=@p3`,
				[
					{ value: nombre },
					{ value: principal },
					{ value: activo },
					{ value: exists[0].IdDeposito },
				],
			);
		} else {
			await executeQuery(
				`
        INSERT INTO dbo.imAlmacenDeposito (Codigo, Nombre, EsPrincipal, Activo)
        VALUES (@p0,@p1,@p2,@p3)
        `,
				[
					{ value: codigo },
					{ value: nombre },
					{ value: principal },
					{ value: activo },
				],
			);
		}
	}

	if (principal) {
		await executeQuery(
			`UPDATE dbo.imAlmacenDeposito SET EsPrincipal = 0 WHERE Codigo <> @p0`,
			[{ value: codigo }],
		);
		await executeQuery(
			`UPDATE dbo.imAlmacenDeposito SET EsPrincipal = 1 WHERE Codigo = @p0`,
			[{ value: codigo }],
		);
	}

	return listarDepositosConfig();
}

async function eliminarDeposito(id) {
	await ensure();
	const idDep = Number(id);
	const stock = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imAlmacenStock WHERE IdDeposito = @p0 AND Cantidad <> 0`,
		[{ value: idDep }],
	);
	if ((stock?.[0]?.n || 0) > 0) {
		// Soft-delete si tiene stock
		await executeQuery(`UPDATE dbo.imAlmacenDeposito SET Activo = 0 WHERE IdDeposito = @p0`, [
			{ value: idDep },
		]);
		return listarDepositosConfig();
	}
	const links = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imAlmacenConfigSector WHERE IdDeposito = @p0`,
		[{ value: idDep }],
	);
	if ((links?.[0]?.n || 0) > 0) {
		await executeQuery(`UPDATE dbo.imAlmacenConfigSector SET IdDeposito = NULL WHERE IdDeposito = @p0`, [
			{ value: idDep },
		]);
	}
	try {
		await executeQuery(`DELETE FROM dbo.imAlmacenDeposito WHERE IdDeposito = @p0`, [
			{ value: idDep },
		]);
	} catch (e) {
		// fallback soft if FK
		await executeQuery(`UPDATE dbo.imAlmacenDeposito SET Activo = 0 WHERE IdDeposito = @p0`, [
			{ value: idDep },
		]);
	}
	return listarDepositosConfig();
}

/** Paquete completo para la pantalla de configuración. */
async function getConfigCompleta() {
	await ensure();
	const [sectoresConfig, sectoresHospital, rubros, depositos] = await Promise.all([
		listarConfigSectores({ soloActivos: false }),
		listarSectoresHospital(),
		listarRubros({ soloActivos: false }),
		listarDepositosConfig(),
	]);
	return { sectoresConfig, sectoresHospital, rubros, depositos };
}

module.exports = {
	listarSectoresHospital,
	listarSectoresDelUsuario,
	listarConfigSectores,
	listarOrigenesParaUsuario,
	upsertConfigSector,
	eliminarConfigSector,
	idDepositoPorIdSector,
	nombreSector,
	listarRubros,
	upsertRubro,
	eliminarRubro,
	listarDepositosConfig,
	upsertDeposito,
	eliminarDeposito,
	getConfigCompleta,
};
