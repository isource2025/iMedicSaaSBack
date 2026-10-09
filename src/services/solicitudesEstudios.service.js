/**
 * Solicitudes de estudios MULTI-PRÁCTICA (función nueva, convive con estudios.service).
 *
 * Modelo:
 *   imSolicitudesEstudios (cabecera)  1 ──< N  imPedidosEstudios (una fila por práctica)
 *   imPedidosEstudios.IdSolicitud NULL  => pedido "legacy": se trata como una solicitud de 1 ítem
 *                                          con clave virtual  -IdPedido.
 *
 * Cada práctica sigue siendo una fila de imPedidosEstudios con los campos de la cabecera
 * copiados (fecha, solicitante, sectores, urgencia, notas): así el escritorio (Clarion), la
 * facturación y todas las consultas existentes siguen funcionando sin cambios.
 *
 * Resultado: UN informe (imProtocolosResultados) compartido por las prácticas que se cumplen
 * juntas + UNA fila de facturación (imFacPracticas/imFacProfesionales) por práctica.
 *
 * DDL: aditivo e idempotente (SQL Server 2008+). NO usa índices filtrados: exigen
 * QUOTED_IDENTIFIER ON en cada INSERT/UPDATE y el escritorio por ODBC puede no enviarlo.
 */
const crypto = require('crypto');
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');
const prefijosPractica = require('./prefijosPractica.service');
const est = require('./estudios.service');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('../utils/dateUtils');

const MAX_ITEMS = 100;
const URGENCIAS = ['Normal', 'Urgente', 'Medio'];

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

function _s(v, max) {
	if (v == null) return '';
	const s = String(v);
	return max != null ? s.slice(0, max) : s;
}

function _urgencia(v, porDefecto = 'Normal') {
	const raw = String(v || porDefecto).trim();
	return URGENCIAS.includes(raw) ? raw : 'Normal';
}

function _rankUrgencia(v) {
	const x = String(v || '').trim().toLowerCase();
	if (x.includes('urgent')) return 2;
	if (x.includes('medio')) return 1;
	return 0;
}

function _idsAutorSesion({ matricula, valorPersonal, codOperador }) {
	const ids = [];
	for (const v of [matricula, valorPersonal, codOperador]) {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
	}
	return ids;
}

/* ------------------------------------------------------------------------------------------
 * Esquema
 * ---------------------------------------------------------------------------------------- */

const DDL = [
	{
		nombre: 'tabla imSolicitudesEstudios',
		sql: `IF OBJECT_ID(N'dbo.imSolicitudesEstudios', N'U') IS NULL
CREATE TABLE dbo.imSolicitudesEstudios (
  IdSolicitud         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_imSolicitudesEstudios PRIMARY KEY,
  IdVisita            INT NOT NULL,
  FechaSolicitud      DATETIME NOT NULL CONSTRAINT DF_imSolicitudesEstudios_Fecha DEFAULT (GETDATE()),
  ValorProfesional    INT NULL,
  IdSectorSolicitante VARCHAR(4) NULL,
  IdSectorReceptor    VARCHAR(4) NULL,
  EstadoUrgencia      VARCHAR(12) NULL,
  NotasObservacion    VARCHAR(5000) NOT NULL CONSTRAINT DF_imSolicitudesEstudios_Notas DEFAULT ('')
)`,
	},
	{
		nombre: 'columna imPedidosEstudios.IdSolicitud',
		sql: `IF COL_LENGTH(N'dbo.imPedidosEstudios', N'IdSolicitud') IS NULL
ALTER TABLE dbo.imPedidosEstudios ADD IdSolicitud INT NULL`,
	},
	{
		nombre: 'índice imPedidosEstudios(IdSolicitud)',
		sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdSolicitud' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_IdSolicitud ON dbo.imPedidosEstudios (IdSolicitud)`,
	},
	{
		nombre: 'índice imPedidosEstudios(IdSectorReceptor, IdProtocolo, FechaPedido)',
		sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_Receptor_Protocolo' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_Receptor_Protocolo
ON dbo.imPedidosEstudios (IdSectorReceptor, IdProtocolo, FechaPedido DESC, IdPedido DESC)
INCLUDE (IdTipoPedido, IdSolicitud)`,
	},
	{
		nombre: 'índice imPedidosEstudios(IdVisita)',
		sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_IdVisita ON dbo.imPedidosEstudios (IdVisita)`,
	},
	{
		nombre: 'índice imSolicitudesEstudios(IdVisita)',
		sql: `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imSolicitudesEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imSolicitudesEstudios'))
CREATE NONCLUSTERED INDEX IX_imSolicitudesEstudios_IdVisita ON dbo.imSolicitudesEstudios (IdVisita)`,
	},
];

/** Diagnóstico de solo lectura del esquema del tenant actual. */
async function estadoEsquema() {
	const rows = await executeQuery(`
		SELECT
		  CASE WHEN OBJECT_ID(N'dbo.imSolicitudesEstudios', N'U') IS NULL THEN 0 ELSE 1 END AS tablaCabecera,
		  CASE WHEN OBJECT_ID(N'dbo.imPedidosEstudios', N'U') IS NULL THEN 0 ELSE 1 END AS tablaPedidos,
		  CASE WHEN COL_LENGTH(N'dbo.imPedidosEstudios', N'IdSolicitud') IS NULL THEN 0 ELSE 1 END AS columnaIdSolicitud,
		  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdSolicitud' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios')) THEN 1 ELSE 0 END AS ixIdSolicitud,
		  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_Receptor_Protocolo' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios')) THEN 1 ELSE 0 END AS ixReceptorProtocolo,
		  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios')) THEN 1 ELSE 0 END AS ixIdVisita,
		  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imSolicitudesEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imSolicitudesEstudios')) THEN 1 ELSE 0 END AS ixCabeceraVisita,
		  DB_NAME() AS baseDatos
	`);
	const r = rows?.[0] || {};
	const practicas = await est.estadoPracticasEstudios().catch(() => ({ practicasConIdResultado: null }));
	const out = {
		baseDatos: String(r.baseDatos || '').trim(),
		tablaPedidos: !!r.tablaPedidos,
		tablaCabecera: !!r.tablaCabecera,
		columnaIdSolicitud: !!r.columnaIdSolicitud,
		ixIdSolicitud: !!r.ixIdSolicitud,
		ixReceptorProtocolo: !!r.ixReceptorProtocolo,
		ixIdVisita: !!r.ixIdVisita,
		ixCabeceraVisita: !!r.ixCabeceraVisita,
		// Diagnóstico: prácticas de estudios que la versión anterior grabó con el id del
		// resultado en IdProtocolo en vez de NroInforme (las corrige aplicarEsquema / ensure).
		practicasConIdResultado: practicas.practicasConIdResultado,
	};
	out.completo =
		out.tablaPedidos &&
		out.tablaCabecera &&
		out.columnaIdSolicitud &&
		out.ixIdSolicitud &&
		out.ixReceptorProtocolo &&
		out.ixIdVisita &&
		out.ixCabeceraVisita;
	return out;
}

/** Aplica el DDL pendiente (idempotente). Devuelve qué hizo. */
async function aplicarEsquema() {
	const antes = await estadoEsquema();
	if (!antes.tablaPedidos) throw _httpError('La base no tiene imPedidosEstudios', 409);
	const pasos = [];
	for (const paso of DDL) {
		await executeQuery(paso.sql);
		pasos.push(paso.nombre);
	}
	const mig = await est.migrarPracticasEstudios();
	pasos.push(`prácticas de estudios: ${mig.migradas} pasadas de IdProtocolo a NroInforme`);
	const despues = await estadoEsquema();
	return { antes, despues, pasos };
}

const ensureSchema = createTenantOnce(async () => {
	const st = await estadoEsquema();
	if (!st.tablaPedidos) throw _httpError('La base no tiene imPedidosEstudios', 409);
	if (!st.completo) {
		for (const paso of DDL) await executeQuery(paso.sql);
		console.log('[solicitudes-estudios] esquema aplicado en', st.baseDatos);
	}
	await est.ensureTomaTable();
});

/**
 * Si algún IdSectorReceptor tuviera espacios a la IZQUIERDA no se puede comparar sin LTRIM
 * (que impide usar el índice). Se detecta una vez por tenant y se elige el predicado.
 */
const _modoReceptor = createTenantOnce(async () => {
	const r = await executeQuery(
		`SELECT TOP 1 1 AS x FROM dbo.imPedidosEstudios WHERE IdSectorReceptor LIKE ' %'`,
	);
	return { sargable: !(r && r.length) };
});

async function _predReceptor(codes, paramOffset = 0) {
	const modo = await _modoReceptor();
	const list = codes.map((_, i) => `@p${paramOffset + i}`);
	return modo.sargable
		? `pe.IdSectorReceptor IN (${list.join(', ')})`
		: `LTRIM(RTRIM(pe.IdSectorReceptor)) IN (${list.map((p) => `LTRIM(RTRIM(${p}))`).join(', ')})`;
}

const SQL_PENDIENTE = `(pe.IdProtocolo IS NULL OR pe.IdProtocolo = 0)`;
const SQL_SOLO_ESTUDIOS = `(pe.IdTipoPedido IS NULL OR pe.IdTipoPedido <> 33)`;

/* ------------------------------------------------------------------------------------------
 * Lectura / armado
 * ---------------------------------------------------------------------------------------- */

function _clave(row) {
	return row.IdSolicitud ? Number(row.IdSolicitud) : -Number(row.IdPedido);
}

async function _cargarItems(whereSql, params = []) {
	const rows = await executeQuery(
		`SELECT ${est.SELECT_PEDIDO}, pe.IdSolicitud AS IdSolicitud
		 ${est.FROM_PEDIDO_SOLICITUD}
		 WHERE ${whereSql}
		 ORDER BY pe.FechaPedido DESC, pe.IdPedido ASC`,
		params,
	);
	const vistos = new Set();
	const items = [];
	for (const row of rows || []) {
		const id = Number(row.IdPedido) || 0;
		if (id > 0 && vistos.has(id)) continue;
		vistos.add(id);
		const p = est.mapPedidoRow(row);
		p.IdSolicitud = row.IdSolicitud != null ? Number(row.IdSolicitud) : null;
		items.push(p);
	}
	return est.completarLocalidades(items);
}

const _CAMPOS_COMUNES = [
	'IdVisita',
	'FechaPedido',
	'FechaPedidoISO',
	'HoraPedido',
	'NotasObservacion',
	'MatriculaSolicitante',
	'MedicoSolicitanteNombre',
	'SectorSolicitante',
	'SectorSolicitanteNombre',
	'SectorReceptor',
	'SectorReceptorNombre',
	'ServicioCodigo',
	'ServicioDescripcion',
	'IdPaciente',
	'PacienteNombre',
	'PacienteDocumento',
	'PacienteTipoDocumento',
	'PacienteSexo',
	'PacienteSexoDescripcion',
	'PacienteFechaNacimiento',
	'PacienteEdad',
	'PacienteNumeroHC',
	'ObraSocial',
	'PacienteAfiliado',
	'PacienteDomicilio',
	'PacienteLocalidad',
	'PacienteTelefono',
	'PacienteTelefonoAlternativo',
	'PacienteEmail',
	'TipoAtencion',
	'Ubicacion',
];

function _armarSolicitud(items) {
	const first = items[0];
	const out = {};
	for (const k of _CAMPOS_COMUNES) out[k] = first[k] ?? null;
	const cumplidos = items.filter((i) => i.Cumplido).length;
	const tomados = items.filter((i) => !i.Cumplido && i.Tomado);
	const mejorUrgencia = items.reduce(
		(acc, i) => (_rankUrgencia(i.EstadoUrgencia) > _rankUrgencia(acc) ? i.EstadoUrgencia : acc),
		first.EstadoUrgencia || 'Normal',
	);
	let estado = 'PENDIENTE';
	if (cumplidos === items.length) estado = 'CUMPLIDA';
	else if (cumplidos > 0) estado = 'PARCIAL';
	else if (tomados.length > 0) estado = 'TOMADA';
	const toma = tomados[0] || null;
	return {
		...out,
		Clave: _clave(first),
		IdSolicitud: first.IdSolicitud ?? null,
		Legacy: !first.IdSolicitud,
		EstadoUrgencia: mejorUrgencia,
		Estado: estado,
		TotalItems: items.length,
		ItemsCumplidos: cumplidos,
		ItemsTomados: items.filter((i) => i.Tomado).length,
		TomadoPor: toma ? toma.NombreToma || null : null,
		MatriculaToma: toma ? toma.MatriculaToma ?? null : null,
		FechaToma: toma ? toma.FechaToma || null : null,
		Items: items,
	};
}

function _agrupar(items) {
	const grupos = new Map();
	for (const it of items) {
		const k = _clave(it);
		if (!grupos.has(k)) grupos.set(k, []);
		grupos.get(k).push(it);
	}
	return [...grupos.values()].map(_armarSolicitud);
}

function _parseClave(clave) {
	const n = Number(clave);
	if (!Number.isFinite(n) || n === 0 || !Number.isInteger(n)) throw _httpError('Solicitud inválida');
	return n;
}

function _whereClave(n, alias = 'pe') {
	return n > 0 ? `${alias}.IdSolicitud = ${n}` : `${alias}.IdPedido = ${-n}`;
}

async function obtenerSolicitud(clave) {
	await ensureSchema();
	const n = _parseClave(clave);
	const items = await _cargarItems(_whereClave(n));
	if (!items.length) return null;
	return _armarSolicitud(items);
}

async function listarPorVisita(idVisita) {
	await ensureSchema();
	const v = Number(idVisita);
	if (!Number.isFinite(v) || v <= 0) throw _httpError('idVisita inválido');
	const items = await _cargarItems(`pe.IdVisita = @p0 AND ${SQL_SOLO_ESTUDIOS}`, [
		{ value: v, type: 'Int' },
	]);
	return _agrupar(items).sort(
		(a, b) =>
			String(b.FechaPedidoISO || '').localeCompare(String(a.FechaPedidoISO || '')) ||
			String(b.HoraPedido || '').localeCompare(String(a.HoraPedido || '')) ||
			b.Clave - a.Clave,
	);
}

/**
 * Bandeja agrupada: una fila por solicitud con al menos una práctica sin cumplir
 * (las prácticas ya cumplidas de esa solicitud viajan igual dentro de Items).
 */
async function listarPendientes(sectorReceptor, opts = {}) {
	await ensureSchema();
	let codes = Array.isArray(opts.codigos)
		? [...new Set(opts.codigos.map((c) => String(c || '').trim()).filter(Boolean))]
		: [];
	if (!codes.length) codes = await est.expandCodigosReceptor(sectorReceptor);
	if (!codes.length) {
		if (opts.permitirVacio) return [];
		throw _httpError('sector receptor requerido');
	}
	const lim = Math.min(Math.max(Number(opts.limit) || 100, 1), 300);
	const paciente = String(opts.paciente || opts.q || '').trim();
	const fechaDesde = String(opts.fechaDesde || '').trim().slice(0, 10);
	const fechaHasta = String(opts.fechaHasta || '').trim().slice(0, 10);

	const params = codes.map((c) => ({ value: c, type: 'VarChar' }));
	let where = `${await _predReceptor(codes)} AND ${SQL_PENDIENTE} AND ${SQL_SOLO_ESTUDIOS}`;
	if (/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
		params.push({ value: fechaDesde, type: 'VarChar' });
		where += ` AND CONVERT(date, pe.FechaPedido) >= CONVERT(date, @p${params.length - 1})`;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
		params.push({ value: fechaHasta, type: 'VarChar' });
		where += ` AND CONVERT(date, pe.FechaPedido) <= CONVERT(date, @p${params.length - 1})`;
	}
	if (paciente) {
		params.push({ value: `%${paciente}%`, type: 'VarChar' });
		const pi = params.length - 1;
		where += ` AND EXISTS (
		  SELECT 1 FROM dbo.imVisita v
		  INNER JOIN dbo.imPacientes pac ON pac.IDPaciente = v.IDPACIENTE
		  WHERE v.NUMEROVISITA = pe.IdVisita
		    AND (LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) LIKE @p${pi}
		      OR CAST(ISNULL(pac.NumeroDocumento, 0) AS VARCHAR(30)) LIKE @p${pi}))`;
	}

	const claves = await executeQuery(
		`SELECT TOP ${lim}
		   COALESCE(pe.IdSolicitud, -pe.IdPedido) AS clave,
		   MAX(pe.FechaPedido) AS f
		 FROM dbo.imPedidosEstudios pe
		 WHERE ${where}
		 GROUP BY COALESCE(pe.IdSolicitud, -pe.IdPedido)
		 ORDER BY MAX(pe.FechaPedido) DESC, COALESCE(pe.IdSolicitud, -pe.IdPedido) DESC`,
		params,
	);
	if (!claves?.length) return [];

	const sols = claves.map((r) => Number(r.clave)).filter((n) => n > 0);
	const legacy = claves.map((r) => -Number(r.clave)).filter((n) => n > 0);
	const ors = [];
	if (sols.length) ors.push(`pe.IdSolicitud IN (${sols.join(',')})`);
	if (legacy.length) ors.push(`(pe.IdSolicitud IS NULL AND pe.IdPedido IN (${legacy.join(',')}))`);
	const items = await _cargarItems(`(${ors.join(' OR ')})`);

	const orden = new Map(claves.map((r, i) => [Number(r.clave), i]));
	return _agrupar(items).sort((a, b) => (orden.get(a.Clave) ?? 0) - (orden.get(b.Clave) ?? 0));
}

function _codigosPedidoDeSector(item) {
	const seen = new Set();
	const out = [];
	for (const c of [item?.valor, item?.valorServicio]) {
		const v = String(c || '').trim();
		if (!v || seen.has(v.toUpperCase())) continue;
		seen.add(v.toUpperCase());
		out.push(v);
	}
	return out;
}

/** Conteo de solicitudes libres (sin tomar ni cumplir) por servicio. */
async function contarLibres({ valorPersonal } = {}) {
	await ensureSchema();
	const sectores = await est.listarSectoresReceptor({ valorPersonal });
	const expansion = await est.expandCodigosReceptorMuchos(
		sectores.flatMap((s) => _codigosPedidoDeSector(s)),
	);
	const keysByServicio = new Map();
	const todos = new Set();
	for (const s of sectores) {
		const keys = new Set();
		for (const c of _codigosPedidoDeSector(s)) {
			for (const x of expansion.get(c.toUpperCase()) || []) {
				const k = String(x || '').trim().toUpperCase();
				if (k) keys.add(k);
			}
		}
		keysByServicio.set(s.valor, keys);
		keys.forEach((k) => todos.add(k));
	}
	const vacio = { solicitudes: 0, items: 0, urgentes: 0, porServicio: [] };
	if (!todos.size) return vacio;

	const codes = [...todos];
	const params = codes.map((c) => ({ value: c, type: 'VarChar' }));
	const rows = await executeQuery(
		`SELECT
		   UPPER(LTRIM(RTRIM(pe.IdSectorReceptor))) AS valor,
		   COUNT(DISTINCT COALESCE(pe.IdSolicitud, -pe.IdPedido)) AS solicitudes,
		   COUNT(*) AS items,
		   COUNT(DISTINCT CASE WHEN UPPER(ISNULL(pe.EstadoUrgencia, '')) LIKE '%URGENT%'
		                       THEN COALESCE(pe.IdSolicitud, -pe.IdPedido) END) AS urgentes
		 FROM dbo.imPedidosEstudios pe
		 LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
		 WHERE ${await _predReceptor(codes)}
		   AND ${SQL_PENDIENTE} AND ${SQL_SOLO_ESTUDIOS}
		   AND toma.IdPedido IS NULL
		 GROUP BY UPPER(LTRIM(RTRIM(pe.IdSectorReceptor)))`,
		params,
	);
	const porCodigo = new Map(
		(rows || []).map((r) => [
			String(r.valor || '').trim().toUpperCase(),
			{
				solicitudes: Number(r.solicitudes) || 0,
				items: Number(r.items) || 0,
				urgentes: Number(r.urgentes) || 0,
			},
		]),
	);
	const porServicio = sectores
		.map((s) => {
			const keys = keysByServicio.get(s.valor) || new Set();
			let solicitudes = 0;
			let items = 0;
			let urgentes = 0;
			for (const [k, hit] of porCodigo) {
				if (!keys.has(k)) continue;
				solicitudes += hit.solicitudes;
				items += hit.items;
				urgentes += hit.urgentes;
			}
			return {
				valor: s.valor,
				descripcion: s.descripcion || s.valor,
				valorServicio: s.valorServicio || '',
				descripcionServicio: s.descripcionServicio || '',
				solicitudes,
				items,
				urgentes,
			};
		})
		.sort(
			(a, b) =>
				b.solicitudes - a.solicitudes ||
				b.urgentes - a.urgentes ||
				String(a.descripcion).localeCompare(String(b.descripcion), 'es'),
		);
	return {
		solicitudes: porServicio.reduce((n, s) => n + s.solicitudes, 0),
		items: porServicio.reduce((n, s) => n + s.items, 0),
		urgentes: porServicio.reduce((n, s) => n + s.urgentes, 0),
		porServicio,
	};
}

/* ------------------------------------------------------------------------------------------
 * Transacciones
 * ---------------------------------------------------------------------------------------- */

async function _tx(fn) {
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const out = await fn(tx);
		await tx.commit();
		return out;
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		throw err;
	}
}

function _req(tx, inputs = []) {
	const r = new sql.Request(tx);
	for (const [name, type, value] of inputs) r.input(name, type, value);
	return r;
}

/* ---- Catálogo por servicio: un servicio solo puede recibir las prácticas que le corresponden ---- */

const prefijosDeServicio = prefijosPractica.prefijosDeServicio;

/**
 * Catálogo (imTiposPedidosEstudios) restringido a lo que realiza el servicio elegido.
 * Un servicio sin prefijos (ni configurados ni usados) no restringe, igual que la validación al guardar.
 */
async function buscarTiposDeServicio({ q, limit, servicio }) {
	const prefijos = await prefijosDeServicio(servicio);
	return est.buscarTiposPedidosEstudios({ q, limit, prefijos: prefijos.length ? prefijos : null });
}

/** Rechaza prácticas que no corresponden al servicio destino (si se puede determinar). */
async function _validarPracticasDelServicio(servicio, practicas) {
	const prefijos = await prefijosDeServicio(servicio);
	if (!prefijos.length) return;
	const fuera = (practicas || []).filter(
		(p) => !prefijos.includes(prefijosPractica.capituloDe(p.idPractica)),
	);
	if (fuera.length) {
		const nombres = fuera
			.slice(0, 3)
			.map((p) => p.descripcion || p.idPractica)
			.join(', ');
		throw _httpError(
			`Los estudios deben corresponder al servicio destino (${String(servicio).trim()}). No corresponden: ${nombres}${fuera.length > 3 ? '…' : ''}`,
		);
	}
}

async function _resolverItemsAlta(items) {
	const lista = Array.isArray(items) ? items : [];
	if (!lista.length) throw _httpError('Seleccione al menos un estudio');
	if (lista.length > MAX_ITEMS) throw _httpError(`Máximo ${MAX_ITEMS} estudios por solicitud`);
	const resueltos = [];
	const vistos = new Set();
	for (const it of lista) {
		const tipo = await est.resolverTipoPedidoEstudio(it?.idTipoPedido, it?.idPractica);
		const codPractica = Number(tipo.IdPractica) || 0;
		if (codPractica <= 0) throw _httpError(`Práctica inválida para pedido ${tipo.IdTipoPedido}`);
		if (Number(tipo.IdTipoPedido) === 33) {
			throw _httpError('Las interconsultas no se piden como estudios');
		}
		if (vistos.has(codPractica)) {
			const nombre = String(tipo.DescPractica || '').trim() || codPractica;
			throw _httpError(
				`${nombre} (${codPractica}) está repetida: no se puede pedir la misma práctica dos veces en un mismo pedido.`,
			);
		}
		vistos.add(codPractica);
		resueltos.push({
			idTipoPedido: Number(tipo.IdTipoPedido),
			idPractica: codPractica,
			descripcion: String(tipo.DescPractica || '').trim(),
		});
	}
	return resueltos;
}

async function _insertarItems(tx, { idSolicitud, cab, items }) {
	const creados = [];
	for (const it of items) {
		const r = await _req(tx, [
			['fecha', sql.DateTime, cab.fecha],
			['notas', sql.VarChar(5000), cab.notas],
			['mat', sql.Int, cab.matricula],
			['visita', sql.Int, cab.idVisita],
			['practica', sql.Int, it.idPractica],
			['urg', sql.VarChar(12), cab.urgencia],
			['sSol', sql.VarChar(4), cab.sectorSolicitante],
			['sRec', sql.VarChar(4), cab.sectorReceptor],
			['tipo', sql.Int, it.idTipoPedido],
			['sol', sql.Int, idSolicitud],
		]).query(`
			INSERT INTO dbo.imPedidosEstudios (
				FechaPedido, NotasObservacion, ValorProfesional, IdVisita, IdPractica,
				IdProtocolo, EstadoUrgencia, IdSectorSolicitante, IdSectorReceptor, IdTipoPedido, IdSolicitud
			) VALUES (
				@fecha, @notas, @mat, @visita, @practica,
				0, @urg, @sSol, @sRec, @tipo, @sol
			);
			SELECT SCOPE_IDENTITY() AS IdPedido`);
		const idPedido = Number(r.recordset?.[0]?.IdPedido) || 0;
		if (idPedido <= 0) throw _httpError('No se pudo registrar un estudio de la solicitud', 500);
		creados.push({ idPedido, ...it });
	}
	return creados;
}

async function _limpiarNotificaciones(idsPedido) {
	try {
		const notif = require('./notificaciones.service');
		for (const id of idsPedido) await notif.eliminarPorEntidadPedido(id);
	} catch (err) {
		console.warn('[solicitudes-estudios] cleanup notif:', err.message || err);
	}
}

/**
 * Crea una solicitud con N prácticas (cabecera + N pedidos) en una transacción.
 */
async function crearSolicitud({
	idVisita,
	matriculaSolicitante,
	sectorSolicitante,
	idSectorReceptor,
	items,
	notas,
	estadoUrgencia,
	fechaSolicitud,
}) {
	await ensureSchema();
	const visita = Number(idVisita);
	if (!Number.isFinite(visita) || visita <= 0) throw _httpError('idVisita inválido');
	const matricula = Number(matriculaSolicitante);
	if (!Number.isFinite(matricula) || matricula <= 0) {
		throw _httpError('matriculaSolicitante inválida');
	}
	if (!String(idSectorReceptor || '').trim()) throw _httpError('El servicio destino es obligatorio');

	const resueltos = await _resolverItemsAlta(items);
	await _validarPracticasDelServicio(idSectorReceptor, resueltos);
	const cab = {
		idVisita: visita,
		matricula,
		fecha:
			fechaSolicitud instanceof Date && !Number.isNaN(fechaSolicitud.getTime())
				? fechaSolicitud
				: est.ahoraWallArgentina(),
		notas: _s(notas, 5000),
		urgencia: _urgencia(estadoUrgencia),
		sectorSolicitante: est._padSector(sectorSolicitante),
		sectorReceptor: est._padSector(idSectorReceptor),
	};

	const { idSolicitud, creados } = await _tx(async (tx) => {
		const h = await _req(tx, [
			['visita', sql.Int, cab.idVisita],
			['fecha', sql.DateTime, cab.fecha],
			['mat', sql.Int, cab.matricula],
			['sSol', sql.VarChar(4), cab.sectorSolicitante],
			['sRec', sql.VarChar(4), cab.sectorReceptor],
			['urg', sql.VarChar(12), cab.urgencia],
			['notas', sql.VarChar(5000), cab.notas],
		]).query(`
			INSERT INTO dbo.imSolicitudesEstudios (
				IdVisita, FechaSolicitud, ValorProfesional, IdSectorSolicitante, IdSectorReceptor, EstadoUrgencia, NotasObservacion
			) VALUES (@visita, @fecha, @mat, @sSol, @sRec, @urg, @notas);
			SELECT SCOPE_IDENTITY() AS IdSolicitud`);
		const id = Number(h.recordset?.[0]?.IdSolicitud) || 0;
		if (id <= 0) throw _httpError('No se pudo registrar la solicitud', 500);
		return { idSolicitud: id, creados: await _insertarItems(tx, { idSolicitud: id, cab, items: resueltos }) };
	});

	// Una sola campanita para todo el servicio destino (no una por práctica).
	try {
		const notif = require('./notificacionesPedidos.service');
		const nombres = creados.map((c) => c.descripcion).filter(Boolean);
		const resumen =
			creados.length === 1
				? nombres[0]
				: `${creados.length} estudios (${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''})`;
		void notif.notificarPedidoSectorReceptor({
			idPedido: creados[0].idPedido,
			idVisita: visita,
			idTipoPedido: creados[0].idTipoPedido,
			idSectorReceptor,
			descripcionPractica: resumen,
			estadoUrgencia: cab.urgencia,
			matriculaSolicitante: matricula,
		});
	} catch (err) {
		console.warn('[solicitudes-estudios] notif omitida:', err.message || err);
	}

	return { idSolicitud, clave: idSolicitud, items: creados };
}

async function _itemsLivianos(n) {
	return executeQuery(
		`SELECT pe.IdPedido, pe.IdVisita, pe.IdPractica, pe.IdProtocolo, pe.IdSolicitud, pe.IdSectorReceptor,
		        pe.ValorProfesional, pe.NotasObservacion, pe.EstadoUrgencia,
		        toma.Matricula AS TomaMatricula, per.ApellidoNombre AS TomaNombre, per.Valor AS TomaValorPersonal
		 FROM dbo.imPedidosEstudios pe
		 LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
		 LEFT JOIN dbo.imPersonal per ON per.Matricula = toma.Matricula
		 WHERE ${_whereClave(n)}
		 ORDER BY pe.IdPedido`,
	);
}

const _sinProtocolo = (it) => !(Number(it.IdProtocolo) > 0);

async function _assertSolicitudDelCreador(n, sesion) {
	const items = await _itemsLivianos(n);
	if (!items?.length) throw _httpError('Solicitud no encontrada', 404);
	const autor = Number(items[0].ValorProfesional);
	const ids = _idsAutorSesion(sesion || {});
	if (!Number.isFinite(autor) || autor <= 0 || !ids.includes(autor)) {
		throw _httpError('Solo quien solicitó el estudio puede modificarlo.', 403);
	}
	return items;
}

/**
 * Toma la solicitud completa: una fila de toma por práctica pendiente, atómico.
 * Un solo operador puede tener la solicitud (la PK de imPedidosEstudiosToma lo garantiza).
 */
async function tomarSolicitud({ clave, matricula, codOperador }) {
	await ensureSchema();
	const n = _parseClave(clave);
	const mat = Number(matricula);
	if (!Number.isFinite(mat) || mat <= 0) throw _httpError('matrícula inválida');

	const items = await _itemsLivianos(n);
	if (!items?.length) throw _httpError('Solicitud no encontrada', 404);
	const pendientes = items.filter(_sinProtocolo);
	if (!pendientes.length) throw _httpError('La solicitud ya está cumplida', 409);
	const deOtro = pendientes.find((i) => i.TomaMatricula != null && Number(i.TomaMatricula) !== mat);
	if (deOtro) {
		throw _httpError(
			`La solicitud ya fue tomada por ${String(deOtro.TomaNombre || deOtro.TomaMatricula).trim()}`,
			409,
		);
	}
	const libres = pendientes.filter((i) => i.TomaMatricula == null);

	if (libres.length) {
		try {
			await _tx(async (tx) => {
				for (const it of libres) {
					await _req(tx, [
						['id', sql.Int, Number(it.IdPedido)],
						['mat', sql.Int, mat],
						['cod', sql.Int, Number(codOperador) || null],
					]).query(
						`INSERT INTO dbo.imPedidosEstudiosToma (IdPedido, Matricula, CodOperador, FechaToma)
						 VALUES (@id, @mat, @cod, GETDATE())`,
					);
				}
			});
		} catch (err) {
			if (/PRIMARY KEY|duplicate|UNIQUE/i.test(String(err.message || ''))) {
				throw _httpError('La solicitud acaba de ser tomada por otro operador', 409);
			}
			throw err;
		}
	}
	await _limpiarNotificaciones(items.map((i) => Number(i.IdPedido)));
	return obtenerSolicitud(n);
}

/** Libera las prácticas pendientes que tomó este operador. */
async function liberarSolicitud({ clave, matricula }) {
	await ensureSchema();
	const n = _parseClave(clave);
	const mat = Number(matricula);
	if (!Number.isFinite(mat) || mat <= 0) throw _httpError('matrícula inválida');
	const items = await _itemsLivianos(n);
	if (!items?.length) throw _httpError('Solicitud no encontrada', 404);
	const tomadas = items.filter((i) => _sinProtocolo(i) && i.TomaMatricula != null);
	if (!tomadas.length) throw _httpError('La solicitud no está tomada', 409);
	if (tomadas.some((i) => Number(i.TomaMatricula) !== mat)) {
		throw _httpError('Solo quien tomó la solicitud puede liberarla', 403);
	}
	await _tx(async (tx) => {
		for (const it of tomadas) {
			await _req(tx, [
				['id', sql.Int, Number(it.IdPedido)],
				['mat', sql.Int, mat],
			]).query(`DELETE FROM dbo.imPedidosEstudiosToma WHERE IdPedido = @id AND Matricula = @mat`);
		}
	});
	return obtenerSolicitud(n);
}

/**
 * Cumple la solicitud. Dos modos (una práctica facturable por ítem en ambos):
 * - Informe único: `textoInforme` compartido por las prácticas (`idsPedidos` opcional → PARCIAL).
 * - Informe por práctica: `respuestas: [{ idPedido, texto }]`, un protocolo por práctica.
 * Todo en una transacción. Solo quien tomó la solicitud.
 */
async function cumplirSolicitud({
	clave,
	textoInforme,
	matriculaRealizador,
	codOperador,
	sectorServicio,
	idsPedidos,
	respuestas,
}) {
	await ensureSchema();
	const n = _parseClave(clave);
	const porPractica = Array.isArray(respuestas) && respuestas.length > 0;
	const texto = String(textoInforme || '').trim();
	if (!porPractica && !texto) throw _httpError('El informe / resultado es obligatorio');
	const textoPorPedido = new Map();
	if (porPractica) {
		for (const r of respuestas) {
			const id = Number(r?.idPedido);
			const t = String(r?.texto || '').trim();
			if (!Number.isFinite(id) || id <= 0) throw _httpError('Estudio inválido en las respuestas');
			if (!t) throw _httpError('Cada estudio marcado necesita su informe / resultado');
			if (textoPorPedido.has(id)) throw _httpError('Hay un estudio repetido en las respuestas');
			textoPorPedido.set(id, t);
		}
	}
	const matriculaSesion = Number(matriculaRealizador);
	if (!Number.isFinite(matriculaSesion) || matriculaSesion <= 0) {
		throw _httpError('matrícula del realizador inválida');
	}

	const items = await _itemsLivianos(n);
	if (!items?.length) throw _httpError('Solicitud no encontrada', 404);
	let objetivo = items.filter(_sinProtocolo);
	if (!objetivo.length) throw _httpError('La solicitud ya está cumplida', 409);

	const idsObjetivo = porPractica
		? [...textoPorPedido.keys()]
		: Array.isArray(idsPedidos) && idsPedidos.length
			? idsPedidos.map(Number)
			: null;
	if (idsObjetivo) {
		const pedidos = new Set(idsObjetivo);
		const filtrados = objetivo.filter((i) => pedidos.has(Number(i.IdPedido)));
		if (filtrados.length !== pedidos.size) {
			throw _httpError('Hay estudios indicados que no pertenecen a la solicitud o ya están cumplidos', 409);
		}
		objetivo = filtrados;
	}
	const grupos = porPractica
		? objetivo.map((it) => ({ texto: textoPorPedido.get(Number(it.IdPedido)), items: [it] }))
		: [{ texto, items: objetivo }];

	for (const it of objetivo) {
		if (it.TomaMatricula == null) throw _httpError('Debe tomar la solicitud antes de cumplirla', 409);
		if (Number(it.TomaMatricula) !== matriculaSesion) {
			throw _httpError(
				`Solo puede cumplir quien tomó la solicitud (${String(it.TomaNombre || it.TomaMatricula).trim()})`,
				403,
			);
		}
		if (!(Number(it.IdPractica) > 0)) throw _httpError('Código de práctica inválido para facturar');
	}

	const numeroVisita = Number(objetivo[0].IdVisita) || 0;
	if (numeroVisita <= 0) throw _httpError('Solicitud sin visita asociada', 400);
	const visitaRows = await executeQuery(
		`SELECT TOP 1 IDPACIENTE AS IdPaciente FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: numeroVisita, type: 'Int' }],
	);
	const idPaciente = Number(visitaRows?.[0]?.IdPaciente) || 0;

	// Facturación: quien cobra = quien tomó (imFacProfesionales.Matricula guarda el Valor de imPersonal).
	const matriculaFac = Number(objetivo[0].TomaValorPersonal) || Number(objetivo[0].TomaMatricula);
	const sectorFac = est._padSector(sectorServicio || objetivo[0].IdSectorReceptor || '');
	const codOp = Number(codOperador) || 0;
	const now = new Date();
	const fechaClarion = convertirFechaAClarion(fechaCalendarioArgentina(now));
	const horaClarion = convertirHoraAClarion(horaWallArgentina(true, now));
	const fechaWall = est.ahoraWallArgentina();

	try {
		await _tx(async (tx) => {
			for (const grupo of grupos) {
				const resIns = await _req(tx, [
					['visita', sql.Int, numeroVisita],
					['fecha', sql.DateTime, fechaWall],
					['texto', sql.VarChar(sql.MAX), est.plainToRtf(grupo.texto)],
					['codOp', sql.Int, codOp],
					['servicio', sql.Char(4), sectorFac],
					['sqlId', sql.Char(36), crypto.randomUUID().toUpperCase()],
				]).query(`
					INSERT INTO dbo.imProtocolosResultados (
						NumeroVisita, FechaResultado, FechaCarga, NroProtocolo,
						TextoProtocolo, Estado, CodOperador, ValorServicio, SqlId
					) VALUES (@visita, @fecha, @fecha, '', @texto, 'N', @codOp, @servicio, @sqlId);
					SELECT SCOPE_IDENTITY() AS IdProtocolo`);
				const idProtocolo = Number(resIns.recordset?.[0]?.IdProtocolo) || 0;
				if (idProtocolo <= 0) throw _httpError('No se pudo crear el resultado', 500);

				for (const it of grupo.items) {
					// Igual que iMedic escritorio: el id del resultado va en NroInforme;
					// IdProtocolo queda en 0 (es la cabecera quirúrgica HCProtocolosPtes).
					const facIns = await _req(tx, [
						['visita', sql.Int, numeroVisita],
						['practica', sql.Int, Number(it.IdPractica)],
						['fechaC', sql.Int, fechaClarion],
						['horaC', sql.Int, horaClarion],
						['sector', sql.VarChar(4), sectorFac],
						['codOp', sql.Int, codOp],
						['idPac', sql.Int, idPaciente > 0 ? idPaciente : null],
						['nroInforme', sql.Int, idProtocolo],
					]).query(`
						INSERT INTO dbo.imFacPracticas (
							Numero, NumeroVisita, TipoPractica, Practica,
							CantidadPractica, FechaPractica, HoraPracticaInicio, HoraPracticaFin,
							ValorSector, FechaPrograma, HoraPrograma, CodOperador,
							FechaGraba, HoraGraba, Factura, Estado, Autorizada, Status,
							NroInforme, NroAutorizacion, IdPaciente, IdProtocolo
						) VALUES (
							0, @visita, 'NO', @practica,
							1, @fechaC, @horaC, 0,
							@sector, @fechaC, @horaC, @codOp,
							@fechaC, @horaC, 0, 2, 2, 0,
							@nroInforme, '', @idPac, 0
						);
						SELECT SCOPE_IDENTITY() AS Valor`);
					const valorFac = Number(facIns.recordset?.[0]?.Valor) || 0;
					if (valorFac <= 0) throw _httpError('No se pudo registrar la práctica', 500);

					await _req(tx, [
						['valor', sql.Int, valorFac],
						['mat', sql.Int, matriculaFac],
						['codOp', sql.Int, codOp],
						['fechaC', sql.Int, fechaClarion],
						['horaC', sql.Int, horaClarion],
					]).query(`
						INSERT INTO dbo.imFacProfesionales (
							Valor, Matricula, Funcion, CodOperador, FachaGraba, HoraGraba, Factura, Status
						) VALUES (@valor, @mat, 1, @codOp, @fechaC, @horaC, 0, 0)`);

					const upd = await _req(tx, [
						['idProt', sql.Int, idProtocolo],
						['idPed', sql.Int, Number(it.IdPedido)],
					]).query(`
						UPDATE dbo.imPedidosEstudios SET IdProtocolo = @idProt
						WHERE IdPedido = @idPed AND (IdProtocolo IS NULL OR IdProtocolo = 0);
						SELECT @@ROWCOUNT AS n`);
					if (Number(upd.recordset?.[0]?.n) !== 1) {
						throw _httpError('No se pudo vincular el resultado a un estudio (¿ya cumplido?)', 409);
					}
				}
			}
		});
	} catch (err) {
		if (err.statusCode) throw err;
		throw _httpError(err.message || 'Error al cumplir la solicitud', 500);
	}

	await _limpiarNotificaciones(items.map((i) => Number(i.IdPedido)));
	return obtenerSolicitud(n);
}

/**
 * Edita una solicitud. Siempre se pueden cambiar notas/urgencia (se propagan a todas las
 * prácticas). Servicio destino y lista de prácticas solo si NADA fue tomado ni cumplido.
 * Solicitudes anteriores (sin cabecera) no admiten cambiar la lista de prácticas.
 */
async function actualizarSolicitud({
	clave,
	matricula,
	valorPersonal,
	codOperador,
	notas,
	estadoUrgencia,
	idSectorReceptor,
	items,
}) {
	await ensureSchema();
	const n = _parseClave(clave);
	const actuales = await _assertSolicitudDelCreador(n, { matricula, valorPersonal, codOperador });
	const bloqueado = actuales.some((i) => !_sinProtocolo(i) || i.TomaMatricula != null);
	const legacy = n < 0;

	const urg = _urgencia(estadoUrgencia, actuales[0].EstadoUrgencia);
	const notasFinal = notas != null ? _s(notas, 5000) : _s(actuales[0].NotasObservacion, 5000);
	const cambiaReceptor =
		idSectorReceptor != null &&
		String(idSectorReceptor).trim() !== '' &&
		est._padSector(idSectorReceptor).trim() !== String(actuales[0].IdSectorReceptor || '').trim();
	const cambiaItems = Array.isArray(items);

	if ((cambiaReceptor || cambiaItems) && bloqueado) {
		throw _httpError('Ya fue tomada o respondida: solo podés editar las notas y la urgencia.', 409);
	}
	if (cambiaItems && legacy) {
		throw _httpError('Es un pedido anterior: no admite agregar o quitar estudios.', 409);
	}
	const nuevos = cambiaItems ? await _resolverItemsAlta(items) : null;
	const sectorRec = cambiaReceptor ? est._padSector(idSectorReceptor) : null;
	// Pedidos anteriores (sin cabecera) se toleran como estaban; lo demás debe respetar el servicio.
	if (!legacy && (nuevos || cambiaReceptor)) {
		const servicioFinal = sectorRec || actuales[0].IdSectorReceptor;
		const practicas = nuevos || actuales.map((i) => ({ idPractica: i.IdPractica }));
		await _validarPracticasDelServicio(servicioFinal, practicas);
	}

	await _tx(async (tx) => {
		await _req(tx, [
			['notas', sql.VarChar(5000), notasFinal],
			['urg', sql.VarChar(12), urg],
		]).query(
			`UPDATE dbo.imPedidosEstudios SET NotasObservacion = @notas, EstadoUrgencia = @urg WHERE ${_whereClave(n, 'imPedidosEstudios')}`,
		);
		if (!legacy) {
			await _req(tx, [
				['notas', sql.VarChar(5000), notasFinal],
				['urg', sql.VarChar(12), urg],
				['id', sql.Int, n],
			]).query(
				`UPDATE dbo.imSolicitudesEstudios SET NotasObservacion = @notas, EstadoUrgencia = @urg WHERE IdSolicitud = @id`,
			);
		}
		if (sectorRec) {
			await _req(tx, [['rec', sql.VarChar(4), sectorRec]]).query(
				`UPDATE dbo.imPedidosEstudios SET IdSectorReceptor = @rec WHERE ${_whereClave(n, 'imPedidosEstudios')}`,
			);
			if (!legacy) {
				await _req(tx, [
					['rec', sql.VarChar(4), sectorRec],
					['id', sql.Int, n],
				]).query(`UPDATE dbo.imSolicitudesEstudios SET IdSectorReceptor = @rec WHERE IdSolicitud = @id`);
			}
		}
		if (nuevos) {
			const quedan = new Set(nuevos.map((x) => x.idPractica));
			const existentes = new Map(actuales.map((i) => [Number(i.IdPractica), Number(i.IdPedido)]));
			for (const [prac, idPed] of existentes) {
				if (!quedan.has(prac)) {
					await _req(tx, [['id', sql.Int, idPed]]).query(
						`DELETE FROM dbo.imPedidosEstudios WHERE IdPedido = @id AND (IdProtocolo IS NULL OR IdProtocolo = 0)`,
					);
				}
			}
			const agregar = nuevos.filter((x) => !existentes.has(x.idPractica));
			if (agregar.length) {
				const h = (
					await _req(tx, [['id', sql.Int, n]]).query(
						`SELECT IdVisita, FechaSolicitud, ValorProfesional, IdSectorSolicitante, IdSectorReceptor FROM dbo.imSolicitudesEstudios WHERE IdSolicitud = @id`,
					)
				).recordset?.[0];
				if (!h) throw _httpError('Solicitud no encontrada', 404);
				await _insertarItems(tx, {
					idSolicitud: n,
					cab: {
						fecha: h.FechaSolicitud,
						notas: notasFinal,
						matricula: Number(h.ValorProfesional),
						idVisita: Number(h.IdVisita),
						urgencia: urg,
						sectorSolicitante: h.IdSectorSolicitante,
						sectorReceptor: sectorRec || h.IdSectorReceptor,
					},
					items: agregar,
				});
			}
		}
	});
	return obtenerSolicitud(n);
}

/** Elimina una solicitud mientras nada fue tomado ni cumplido. Solo el creador. */
async function eliminarSolicitud({ clave, matricula, valorPersonal, codOperador }) {
	await ensureSchema();
	const n = _parseClave(clave);
	const items = await _assertSolicitudDelCreador(n, { matricula, valorPersonal, codOperador });
	if (items.some((i) => !_sinProtocolo(i))) {
		throw _httpError('La solicitud ya fue respondida. Solo se puede visualizar.', 409);
	}
	if (items.some((i) => i.TomaMatricula != null)) {
		throw _httpError('La solicitud ya fue tomada. Solo se puede visualizar.', 409);
	}
	await _tx(async (tx) => {
		await _req(tx).query(
			`DELETE FROM dbo.imPedidosEstudios WHERE ${_whereClave(n, 'imPedidosEstudios')} AND (IdProtocolo IS NULL OR IdProtocolo = 0)`,
		);
		if (n > 0) {
			await _req(tx, [['id', sql.Int, n]]).query(
				`DELETE FROM dbo.imSolicitudesEstudios WHERE IdSolicitud = @id`,
			);
		}
	});
	await _limpiarNotificaciones(items.map((i) => Number(i.IdPedido)));
	return { clave: n };
}

module.exports = {
	estadoEsquema,
	aplicarEsquema,
	ensureSchema,
	crearSolicitud,
	prefijosDeServicio,
	buscarTiposDeServicio,
	obtenerSolicitud,
	listarPorVisita,
	listarPendientes,
	contarLibres,
	tomarSolicitud,
	liberarSolicitud,
	cumplirSolicitud,
	actualizarSolicitud,
	eliminarSolicitud,
};
