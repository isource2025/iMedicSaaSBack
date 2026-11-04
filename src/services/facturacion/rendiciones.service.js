/**
 * Facturación > Rendiciones.
 *
 * Cabecera en dbo.imRendiciones; el detalle valorizado son las líneas de
 * dbo.imFacDetalle con IDFACTURA = IdRendicion (H honorarios, G gastos,
 * M medicamentos, Y otros). Los totales de la cabecera son la suma de esas
 * líneas por tipo y Visitas es la cantidad de visitas distintas.
 *
 * La web no valoriza: las líneas las escribe el sistema de escritorio. Acá se
 * consulta, se da de alta la cabecera vacía, se editan sus datos y se borran
 * solo las vacías. Ver docs/FACTURACION_RENDICIONES.md.
 */
const { executeQuery } = require('../../models/db');
const { getTenantId } = require('../../context/tenantContext');
const { sanitizarTextoParaBd } = require('../../utils/clarionText');
const {
	convertirFechaAClarion,
	clarionAIsoCalendario,
	convertirHoraClarionAString,
} = require('../../utils/dateUtils');
const auditoria = require('../auditoria.service');

const TAM_PAGINA = 50;
const MAX_TAM_PAGINA = 500;
const MAX_FILAS_EXPORTAR = 20000;
const MAX_OBSERVACIONES = 500;

const TIPOS_PRESTACION = {
	H: 'Honorarios',
	G: 'Gastos',
	M: 'Medicamentos',
	Y: 'Otros servicios',
};

const MODULOS = { NO: 'Nomenclador', MO: 'Moduladas', VA: 'Vademécum' };

const TIPOS_CLIENTE = {
	OS: 'Obra social',
	ART: 'ART',
	EMP: 'Empresa',
	PAR: 'Particular',
	OTR: 'Otro',
	ADM: 'Administrativo',
};

const ESTADOS = ['abierta', 'cerrada'];

// ─── Utilidades ────────────────────────────────────────────────────────────

function errorHttp(mensaje, statusCode = 400) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	return err;
}

function entero(v, nombre) {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 0) throw errorHttp(`${nombre} inválido`);
	return n;
}

function parametros() {
	const lista = [];
	return {
		lista,
		p(value, type, length) {
			lista.push({ value, type, length });
			return `@p${lista.length - 1}`;
		},
	};
}

function paginaDe(query, porDefecto = TAM_PAGINA) {
	const pagina = Math.max(1, parseInt(query?.pagina, 10) || 1);
	const tamPagina = Math.min(MAX_TAM_PAGINA, Math.max(1, parseInt(query?.tamPagina, 10) || porDefecto));
	return { pagina, tamPagina, offset: (pagina - 1) * tamPagina };
}

const escaparLike = (q) => `%${q.replace(/[[\]%_]/g, (m) => `[${m}]`)}%`;
const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** "YYYY-MM" → Clarion del día 1 (inicio) o del último día del mes (fin). */
function mesAClarion(mes, fin = false) {
	const m = /^(\d{4})-(\d{2})$/.exec(String(mes || '').trim());
	if (!m) return null;
	const anio = Number(m[1]);
	const nroMes = Number(m[2]);
	if (nroMes < 1 || nroMes > 12 || anio < 1990 || anio > 2100) return null;
	const dia = fin ? new Date(Date.UTC(anio, nroMes, 0)).getUTCDate() : 1;
	return convertirFechaAClarion(`${m[1]}-${m[2]}-${String(dia).padStart(2, '0')}`);
}

function registrar(ctx, accion, idEntidad, detalle) {
	return auditoria.registrarSeguro({
		idEmpresa: Number(getTenantId()) || 0,
		modulo: 'FACTURACION',
		entidad: 'RENDICION',
		idEntidad,
		accion,
		actor: ctx?.actor,
		ip: ctx?.ip,
		detalle,
	});
}

// ─── Catálogos ─────────────────────────────────────────────────────────────

async function catalogos() {
	const [clientes, convenios] = await Promise.all([
		executeQuery(
			`SELECT Valor, RTRIM(RazonSocial) AS RazonSocial, RTRIM(ValorCliente) AS Tipo FROM dbo.imClientes ORDER BY RazonSocial`,
		),
		executeQuery(
			`SELECT Codigo, Valor, RTRIM(Descripcion) AS Descripcion, VigenciaDesde, VigenciaHasta
			 FROM dbo.imClientesConvenios ORDER BY Codigo DESC`,
		),
	]);
	return {
		clientes: clientes.map((c) => ({ valor: Number(c.Valor), razonSocial: c.RazonSocial, tipo: texto(c.Tipo) })),
		convenios: convenios.map((c) => ({
			codigo: Number(c.Codigo),
			obraSocial: Number(c.Valor),
			descripcion: c.Descripcion,
			vigenciaDesde: clarionAIsoCalendario(c.VigenciaDesde),
			vigenciaHasta: clarionAIsoCalendario(c.VigenciaHasta),
		})),
		tiposCliente: Object.entries(TIPOS_CLIENTE).map(([valor, descripcion]) => ({ valor, descripcion })),
		tiposPrestacion: Object.entries(TIPOS_PRESTACION).map(([valor, descripcion]) => ({ valor, descripcion })),
	};
}

// ─── Listado ───────────────────────────────────────────────────────────────

const SQL_ESTADO = `CASE WHEN ISNULL(r.FechaCierre, 0) > 0 THEN 'cerrada' ELSE 'abierta' END`;
const SQL_TOTAL = `(ISNULL(r.Honorarios, 0) + ISNULL(r.Gastos, 0) + ISNULL(r.Medicamentos, 0) + ISNULL(r.OtrosServicios, 0))`;

const SELECT_CABECERA = `
	r.IdRendicion, r.FechaGraba, r.OperGraba, RTRIM(r.IdTipoCliente) AS IdTipoCliente, r.idCliente,
	RTRIM(cli.RazonSocial) AS RazonSocial, r.idConvenio, RTRIM(cc.Descripcion) AS ConvenioDescripcion,
	cc.Valor AS ConvenioObraSocial, r.Periodo, r.Honorarios, r.Gastos, r.Medicamentos, r.OtrosServicios,
	r.Visitas, r.FechaCierre, r.HoraCierre, r.OperCierre, r.Observaciones, r.IdEmpresa, r.IdSucursal,
	RTRIM(op.ApellidoNombre) AS OperadorNombre, ${SQL_ESTADO} AS Estado, ${SQL_TOTAL} AS Total`;

const FROM_CABECERA = `
	FROM dbo.imRendiciones r
	LEFT JOIN dbo.imClientes cli ON cli.Valor = r.idCliente
	LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = r.idConvenio
	OUTER APPLY (SELECT TOP 1 p.ApellidoNombre FROM dbo.imPersonal p WHERE p.Valor = r.OperGraba) op`;

function cabecera(f) {
	const tipo = texto(f.IdTipoCliente);
	const cerrada = num(f.FechaCierre) > 0;
	return {
		id: Number(f.IdRendicion),
		fechaGraba: f.FechaGraba ? new Date(f.FechaGraba).toISOString() : null,
		operador: { valor: num(f.OperGraba), nombre: texto(f.OperadorNombre) || null },
		tipoCliente: { valor: tipo, descripcion: TIPOS_CLIENTE[tipo] || tipo || 'Sin tipo' },
		cliente: { valor: num(f.idCliente), razonSocial: texto(f.RazonSocial) || null },
		convenio: {
			codigo: num(f.idConvenio),
			descripcion: texto(f.ConvenioDescripcion) || null,
			obraSocial: f.ConvenioObraSocial === null || f.ConvenioObraSocial === undefined ? null : Number(f.ConvenioObraSocial),
		},
		periodo: clarionAIsoCalendario(f.Periodo),
		importes: {
			honorarios: num(f.Honorarios),
			gastos: num(f.Gastos),
			medicamentos: num(f.Medicamentos),
			otros: num(f.OtrosServicios),
			total: num(f.Total),
		},
		visitas: num(f.Visitas),
		observaciones: texto(f.Observaciones),
		estado: f.Estado,
		cierre: cerrada
			? {
					fecha: clarionAIsoCalendario(f.FechaCierre),
					hora: num(f.HoraCierre) > 0 ? convertirHoraClarionAString(f.HoraCierre) : null,
					operador: num(f.OperCierre),
			  }
			: null,
	};
}

function filtrosListado(query, prm) {
	const filtros = [];
	const q = texto(query.q);
	if (q) {
		const like = prm.p(escaparLike(q), 'VarChar', 300);
		const porNumero = /^\d+$/.test(q) ? `r.IdRendicion = ${prm.p(Number(q), 'Int')} OR r.idConvenio = @p${prm.lista.length - 1} OR ` : '';
		filtros.push(`(${porNumero}cli.RazonSocial LIKE ${like} OR cc.Descripcion LIKE ${like} OR r.Observaciones LIKE ${like})`);
	}
	if (texto(query.cliente) !== '') filtros.push(`r.idCliente = ${prm.p(entero(query.cliente, 'Cliente'), 'Int')}`);
	if (texto(query.convenio) !== '') filtros.push(`r.idConvenio = ${prm.p(entero(query.convenio, 'Convenio'), 'Int')}`);
	if (texto(query.tipo) !== '') filtros.push(`RTRIM(r.IdTipoCliente) = ${prm.p(texto(query.tipo).slice(0, 3), 'VarChar', 3)}`);
	const desde = mesAClarion(query.desde);
	const hasta = mesAClarion(query.hasta, true);
	if (texto(query.desde) && desde === null) throw errorHttp('Período "desde" inválido (usá AAAA-MM)');
	if (texto(query.hasta) && hasta === null) throw errorHttp('Período "hasta" inválido (usá AAAA-MM)');
	if (desde !== null) filtros.push(`r.Periodo >= ${prm.p(desde, 'Int')}`);
	if (hasta !== null) filtros.push(`r.Periodo <= ${prm.p(hasta, 'Int')}`);
	return filtros;
}

/**
 * Listado paginado. `resumen` suma importes y cuenta por estado con los mismos
 * filtros salvo el de estado (para los indicadores de arriba).
 */
async function listar(query = {}) {
	const { pagina, tamPagina, offset } = paginaDe(query);
	const prm = parametros();
	const filtros = filtrosListado(query, prm);
	const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
	const estado = ESTADOS.includes(query.estado) ? query.estado : null;
	const whereEstado = estado ? `${where ? `${where} AND` : 'WHERE'} ${SQL_ESTADO} = '${estado}'` : where;

	const [filas, resumen] = await Promise.all([
		executeQuery(
			`SELECT ${SELECT_CABECERA}, COUNT(*) OVER () AS TotalFilas
			 ${FROM_CABECERA}
			 ${whereEstado}
			 ORDER BY r.IdRendicion DESC
			 OFFSET ${offset} ROWS FETCH NEXT ${tamPagina} ROWS ONLY`,
			prm.lista,
		),
		executeQuery(
			`SELECT ${SQL_ESTADO} AS Estado, COUNT(*) AS n, SUM(ISNULL(r.Honorarios, 0)) AS Honorarios,
			        SUM(ISNULL(r.Gastos, 0)) AS Gastos, SUM(ISNULL(r.Medicamentos, 0)) AS Medicamentos,
			        SUM(ISNULL(r.OtrosServicios, 0)) AS Otros, SUM(ISNULL(r.Visitas, 0)) AS Visitas
			 FROM dbo.imRendiciones r
			 LEFT JOIN dbo.imClientes cli ON cli.Valor = r.idCliente
			 LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = r.idConvenio
			 ${where}
			 GROUP BY ${SQL_ESTADO}`,
			prm.lista,
		),
	]);

	const porEstado = { abierta: 0, cerrada: 0 };
	const sumas = { honorarios: 0, gastos: 0, medicamentos: 0, otros: 0, visitas: 0 };
	for (const r of resumen) {
		porEstado[r.Estado] = num(r.n);
		if (!estado || r.Estado === estado) {
			sumas.honorarios += num(r.Honorarios);
			sumas.gastos += num(r.Gastos);
			sumas.medicamentos += num(r.Medicamentos);
			sumas.otros += num(r.Otros);
			sumas.visitas += num(r.Visitas);
		}
	}

	return {
		filas: filas.map(cabecera),
		total: filas.length ? Number(filas[0].TotalFilas) : 0,
		pagina,
		tamPagina,
		resumen: {
			total: porEstado.abierta + porEstado.cerrada,
			...porEstado,
			importes: { ...sumas, total: sumas.honorarios + sumas.gastos + sumas.medicamentos + sumas.otros },
		},
	};
}

async function exportar(query = {}) {
	const prm = parametros();
	const filtros = filtrosListado(query, prm);
	const estado = ESTADOS.includes(query.estado) ? query.estado : null;
	if (estado) filtros.push(`${SQL_ESTADO} = '${estado}'`);
	const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
	const filas = await executeQuery(
		`SELECT TOP ${MAX_FILAS_EXPORTAR + 1} ${SELECT_CABECERA} ${FROM_CABECERA} ${where} ORDER BY r.IdRendicion DESC`,
		prm.lista,
	);
	if (filas.length > MAX_FILAS_EXPORTAR) {
		throw errorHttp(`Hay más de ${MAX_FILAS_EXPORTAR.toLocaleString('es-AR')} rendiciones con estos filtros: acotá el período.`);
	}
	return filas.map(cabecera);
}

// ─── Detalle ───────────────────────────────────────────────────────────────

async function filaCabecera(id) {
	const filas = await executeQuery(`SELECT ${SELECT_CABECERA} ${FROM_CABECERA} WHERE r.IdRendicion = @p0`, [
		{ value: id, type: 'Int' },
	]);
	if (!filas.length) throw errorHttp('La rendición no existe', 404);
	return filas[0];
}

/** Totales recalculados desde imFacDetalle y vínculos que impiden borrar. */
async function resumenDetalle(id) {
	const [porTipo, vinculos] = await Promise.all([
		executeQuery(
			`SELECT d.TIPOPRESTACION AS Tipo, COUNT(*) AS Lineas, SUM(ISNULL(d.IMPORTE_FINAL, 0)) AS Importe,
			        SUM(CASE WHEN ISNULL(d.IMPORTE_FINAL, 0) = 0 THEN 1 ELSE 0 END) AS SinValor
			 FROM dbo.imFacDetalle d WHERE d.IDFACTURA = @p0 GROUP BY d.TIPOPRESTACION`,
			[{ value: id, type: 'Int' }],
		),
		executeQuery(
			`SELECT (SELECT COUNT(DISTINCT NUMEROVISITA) FROM dbo.imFacDetalle WHERE IDFACTURA = @p0) AS Visitas,
			        (SELECT COUNT(*) FROM dbo.imFacturas WHERE IdRendicion = @p0) AS Facturas,
			        (SELECT COUNT(*) FROM dbo.FacturacionProfDetalle WHERE IdRendicion = @p0) AS Liquidacion`,
			[{ value: id, type: 'Int' }],
		),
	]);
	const importes = { honorarios: 0, gastos: 0, medicamentos: 0, otros: 0 };
	const clave = { H: 'honorarios', G: 'gastos', M: 'medicamentos', Y: 'otros' };
	let lineas = 0;
	let sinValor = 0;
	for (const t of porTipo) {
		const k = clave[texto(t.Tipo)] || 'otros';
		importes[k] += num(t.Importe);
		lineas += num(t.Lineas);
		sinValor += num(t.SinValor);
	}
	const v = vinculos[0] || {};
	return {
		importes: { ...importes, total: importes.honorarios + importes.gastos + importes.medicamentos + importes.otros },
		lineas,
		lineasSinValor: sinValor,
		visitas: num(v.Visitas),
		facturas: num(v.Facturas),
		lineasLiquidacion: num(v.Liquidacion),
	};
}

const difiere = (a, b) => Math.abs(num(a) - num(b)) >= 0.01;

async function obtener(idCrudo) {
	const id = entero(idCrudo, 'Rendición');
	const [f, det] = await Promise.all([filaCabecera(id), resumenDetalle(id)]);
	const cab = cabecera(f);
	const diferencias = ['honorarios', 'gastos', 'medicamentos', 'otros'].filter((k) => difiere(cab.importes[k], det.importes[k]));
	if (cab.visitas !== det.visitas) diferencias.push('visitas');
	return {
		...cab,
		detalle: det,
		diferencias,
		vacia: det.lineas === 0 && det.facturas === 0 && det.lineasLiquidacion === 0,
	};
}

/** Visitas de la rendición con sus importes por tipo. */
async function visitas(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	await filaCabecera(id);
	const { pagina, tamPagina, offset } = paginaDe(query, 50);
	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [];
	const q = texto(query.q);
	if (q) {
		const like = prm.p(escaparLike(q), 'VarChar', 300);
		const porNumero = /^\d+$/.test(q) ? `x.NumeroVisita = ${prm.p(Number(q), 'Int')} OR ` : '';
		filtros.push(`(${porNumero}pac.ApellidoyNombre LIKE ${like})`);
	}
	if (query.sinValor === '1' || query.sinValor === 'true') filtros.push('x.SinValor > 0');
	const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

	const filas = await executeQuery(
		`WITH x AS (
			SELECT d.NUMEROVISITA AS NumeroVisita, COUNT(*) AS Lineas, MIN(d.FECHA) AS Desde, MAX(d.FECHA) AS Hasta,
			       SUM(CASE WHEN d.TIPOPRESTACION = 'H' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Honorarios,
			       SUM(CASE WHEN d.TIPOPRESTACION = 'G' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Gastos,
			       SUM(CASE WHEN d.TIPOPRESTACION = 'M' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Medicamentos,
			       SUM(CASE WHEN d.TIPOPRESTACION NOT IN ('H', 'G', 'M') THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Otros,
			       SUM(CASE WHEN ISNULL(d.IMPORTE_FINAL, 0) = 0 THEN 1 ELSE 0 END) AS SinValor
			FROM dbo.imFacDetalle d WHERE d.IDFACTURA = ${pId}
			GROUP BY d.NUMEROVISITA
		)
		SELECT x.*, v.IDPACIENTE, RTRIM(pac.ApellidoyNombre) AS Paciente, RTRIM(v.CLASEPACIENTE) AS Clase,
		       RTRIM(cp.Descripcion) AS ClaseDescripcion, RTRIM(ISNULL(v.TIPOADMISION, '')) AS TipoAdmision,
		       RTRIM(ISNULL(ta.Descripcion, '')) AS TipoAdmisionDescripcion,
		       CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS Ingreso,
		       v.FechaEgreso,
		       pac.NumeroDocumento, RTRIM(ISNULL(pac.TipoDocumento, '')) AS TipoDocumento,
		       COUNT(*) OVER () AS TotalFilas
		FROM x
		LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = x.NumeroVisita
		LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		LEFT JOIN dbo.imClasePaciente cp ON cp.Valor = v.CLASEPACIENTE
		LEFT JOIN dbo.imTipoAdmision ta ON RTRIM(ISNULL(ta.Valor, '')) = RTRIM(ISNULL(v.TIPOADMISION, ''))
		${where}
		ORDER BY x.NumeroVisita
		OFFSET ${offset} ROWS FETCH NEXT ${tamPagina} ROWS ONLY`,
		prm.lista,
	);
	return {
		filas: filas.map((f) => ({
			numeroVisita: num(f.NumeroVisita),
			paciente: {
				id: num(f.IDPACIENTE),
				nombre: texto(f.Paciente) || null,
				documento:
					f.NumeroDocumento != null && String(f.NumeroDocumento).trim() !== ''
						? { tipo: texto(f.TipoDocumento) || null, numero: num(f.NumeroDocumento) || Number(f.NumeroDocumento) || 0 }
						: null,
			},
			clase: f.Clase ? { valor: texto(f.Clase), descripcion: texto(f.ClaseDescripcion) || texto(f.Clase) } : null,
			tipoAdmision: texto(f.TipoAdmision)
				? { valor: texto(f.TipoAdmision), descripcion: texto(f.TipoAdmisionDescripcion) || texto(f.TipoAdmision) }
				: null,
			ingreso: texto(f.Ingreso) || null,
			egreso: clarionAIsoCalendario(f.FechaEgreso),
			desde: clarionAIsoCalendario(f.Desde),
			hasta: clarionAIsoCalendario(f.Hasta),
			lineas: num(f.Lineas),
			sinValor: num(f.SinValor),
			importes: {
				honorarios: num(f.Honorarios),
				gastos: num(f.Gastos),
				medicamentos: num(f.Medicamentos),
				otros: num(f.Otros),
				total: num(f.Honorarios) + num(f.Gastos) + num(f.Medicamentos) + num(f.Otros),
			},
		})),
		total: filas.length ? Number(filas[0].TotalFilas) : 0,
		pagina,
		tamPagina,
	};
}

/**
 * Regla del convenio que corresponde a la línea (misma búsqueda que hace el
 * motor): práctica dentro de Desde–Hasta y función (0 para gastos). Si hay
 * varias, la del rango más chico y la que cubre el tipo de visita.
 */
const APPLY_REGLA = (tabla, alias) => `
	OUTER APPLY (
		SELECT TOP 1 n.Desde, n.Hasta, n.Funcion, n.TipoValor, n.Valor, n.NoCubre
		FROM dbo.${tabla} n
		WHERE n.ValorConvenio = d.IDCONVENIO
		  AND d.IDPRACTICA BETWEEN n.Desde AND n.Hasta
		  AND n.Funcion = CASE WHEN d.TIPOPRESTACION = 'H' THEN ISNULL(d.FUNCION, 0) ELSE 0 END
		ORDER BY CASE WHEN (CASE WHEN v.CLASEPACIENTE = 'I' THEN n.Internacion ELSE n.Ambulatorio END) = 1 THEN 0 ELSE 1 END,
		         n.Hasta - n.Desde
	) ${alias}`;

async function lineas(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	await filaCabecera(id);
	const { pagina, tamPagina, offset } = paginaDe(query, 100);
	const prm = parametros();
	const filtros = [`d.IDFACTURA = ${prm.p(id, 'Int')}`];
	if (texto(query.visita) !== '') filtros.push(`d.NUMEROVISITA = ${prm.p(entero(query.visita, 'Visita'), 'Int')}`);
	const tipo = texto(query.tipo).toUpperCase();
	if (tipo) {
		if (!TIPOS_PRESTACION[tipo]) throw errorHttp('Tipo de prestación inválido');
		filtros.push(`d.TIPOPRESTACION = ${prm.p(tipo, 'Char', 1)}`);
	}
	if (query.sinValor === '1' || query.sinValor === 'true') filtros.push('ISNULL(d.IMPORTE_FINAL, 0) = 0');

	const where = filtros.join(' AND ');
	const [conteo, filas] = await Promise.all([
		executeQuery(`SELECT COUNT(*) AS n FROM dbo.imFacDetalle d WHERE ${where}`, prm.lista),
		executeQuery(
		`WITH pag AS (
			SELECT d.* FROM dbo.imFacDetalle d WHERE ${where}
			ORDER BY d.NUMEROVISITA, d.FECHA, d.TIPOPRESTACION, d.IDDETALLE
			OFFSET ${offset} ROWS FETCH NEXT ${tamPagina} ROWS ONLY
		)
		SELECT d.IDDETALLE, d.NUMEROVISITA, d.TIPOPRESTACION, RTRIM(d.IDMODULO) AS Modulo, d.IDPRACTICA, d.MATRICULA,
		        d.FUNCION, d.PORCENTAJE, d.CANTIDAD, d.FECHA, d.IMPORTE_UNITARIO, d.IMPORTE_FINAL,
		        RTRIM(d.FORMACALCULO) AS FormaCalculo, RTRIM(d.DESCRIPCION) AS Descripcion, d.IDCONVENIO,
		        d.IMPORTEBONIFICACION, d.PORCENTAJEBONIFICACION,
		        COALESCE(NULLIF(RTRIM(d.DESCRIPCION), ''), RTRIM(nom.Descripcion), RTRIM(mo.Descripcion),
		                 RTRIM(CASE WHEN va.Alias = '' THEN va.Nombre ELSE va.Alias END)) AS Practica,
		        RTRIM(prof.ApellidoNombre) AS Profesional, RTRIM(fn.Descripcion) AS FuncionDescripcion,
		        RTRIM(pac.ApellidoyNombre) AS Paciente,
		        CASE RTRIM(d.IDMODULO) WHEN 'NO' THEN rn.TipoValor WHEN 'MO' THEN rm.TipoValor END AS ReglaTipo,
		        CASE RTRIM(d.IDMODULO) WHEN 'NO' THEN rn.Valor WHEN 'MO' THEN rm.Valor END AS ReglaValor,
		        CASE RTRIM(d.IDMODULO) WHEN 'NO' THEN rn.Desde WHEN 'MO' THEN rm.Desde END AS ReglaDesde,
		        CASE RTRIM(d.IDMODULO) WHEN 'NO' THEN rn.Hasta WHEN 'MO' THEN rm.Hasta END AS ReglaHasta,
		        CASE RTRIM(d.IDMODULO) WHEN 'NO' THEN rn.NoCubre WHEN 'MO' THEN rm.NoCubre END AS ReglaNoCubre
		 FROM pag d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imVademecum va ON RTRIM(d.IDMODULO) = 'VA' AND va.Troquel = d.IDPRACTICA
		 LEFT JOIN dbo.imFunciones fn ON fn.Valor = d.FUNCION AND d.TIPOPRESTACION = 'H'
		 OUTER APPLY (SELECT TOP 1 p.ApellidoNombre FROM dbo.imPersonal p WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0) prof
		 ${APPLY_REGLA('imClientesConvNomenc', 'rn')}
		 ${APPLY_REGLA('imClientesConvModuladas', 'rm')}
		 ORDER BY d.NUMEROVISITA, d.FECHA, d.TIPOPRESTACION, d.IDDETALLE`,
			prm.lista,
		),
	]);

	return {
		filas: filas.map((f) => {
			const tipoP = texto(f.TIPOPRESTACION);
			const modulo = texto(f.Modulo);
			const unitario = num(f.IMPORTE_UNITARIO);
			const tieneRegla = f.ReglaDesde !== null && f.ReglaDesde !== undefined;
			const reglaTipo = texto(f.ReglaTipo);
			let valorizacion;
			if (modulo === 'VA') valorizacion = { estado: 'vademecum' };
			else if (!tieneRegla) valorizacion = { estado: 'sin_regla' };
			else if (num(f.ReglaNoCubre) === 1) valorizacion = { estado: 'no_cubre' };
			else if (reglaTipo === '$') valorizacion = { estado: difiere(f.ReglaValor, unitario) ? 'difiere' : 'coincide' };
			else valorizacion = { estado: 'calculada' };
			if (texto(f.FormaCalculo).toUpperCase() === 'MANUAL') valorizacion.manual = true;
			return {
				id: num(f.IDDETALLE),
				numeroVisita: num(f.NUMEROVISITA),
				paciente: texto(f.Paciente) || null,
				tipo: { valor: tipoP, descripcion: TIPOS_PRESTACION[tipoP] || tipoP || 'Sin tipo' },
				modulo: { valor: modulo, descripcion: MODULOS[modulo] || modulo || '—' },
				practica: { codigo: num(f.IDPRACTICA), descripcion: texto(f.Practica) || null },
				profesional: num(f.MATRICULA) > 0 ? { matricula: num(f.MATRICULA), nombre: texto(f.Profesional) || null } : null,
				funcion: tipoP === 'H' ? { valor: num(f.FUNCION), descripcion: texto(f.FuncionDescripcion) || null } : null,
				fecha: clarionAIsoCalendario(f.FECHA),
				cantidad: num(f.CANTIDAD),
				porcentaje: num(f.PORCENTAJE),
				importeUnitario: unitario,
				importeFinal: num(f.IMPORTE_FINAL),
				sinValor: num(f.IMPORTE_FINAL) === 0,
				bonificacion: { importe: num(f.IMPORTEBONIFICACION), porcentaje: num(f.PORCENTAJEBONIFICACION) },
				convenio: num(f.IDCONVENIO),
				regla: tieneRegla
					? { desde: num(f.ReglaDesde), hasta: num(f.ReglaHasta), tipoValor: reglaTipo, valor: num(f.ReglaValor) }
					: null,
				valorizacion,
			};
		}),
		total: num(conteo[0]?.n),
		pagina,
		tamPagina,
	};
}

async function facturas(idCrudo) {
	const id = entero(idCrudo, 'Rendición');
	await filaCabecera(id);
	const filas = await executeQuery(
		`SELECT f.idFactura, RTRIM(f.TipoComprobante) AS TipoComprobante, RTRIM(f.Letra) AS Letra, f.Sucursal, f.Numero,
		        f.FechaGraba, f.FechaEmision, f.Periodo, f.Neto, f.Iva, f.PorcentajeIva, f.Total, f.Saldo,
		        RTRIM(f.RazonSocial) AS RazonSocial
		 FROM dbo.imFacturas f WHERE f.IdRendicion = @p0 ORDER BY f.idFactura`,
		[{ value: id, type: 'Int' }],
	);
	return filas.map((f) => ({
		id: num(f.idFactura),
		comprobante: texto(f.TipoComprobante),
		letra: texto(f.Letra),
		sucursal: num(f.Sucursal),
		numero: num(f.Numero),
		fechaGraba: clarionAIsoCalendario(f.FechaGraba),
		fechaEmision: clarionAIsoCalendario(f.FechaEmision),
		periodo: clarionAIsoCalendario(f.Periodo),
		razonSocial: texto(f.RazonSocial) || null,
		neto: num(f.Neto),
		iva: num(f.Iva),
		porcentajeIva: num(f.PorcentajeIva),
		total: num(f.Total),
		saldo: num(f.Saldo),
	}));
}

// ─── Alta, edición y baja ──────────────────────────────────────────────────

function observacionesDe(v) {
	const o = texto(v);
	if (o.length > MAX_OBSERVACIONES) throw errorHttp(`Las observaciones admiten hasta ${MAX_OBSERVACIONES} caracteres`);
	return sanitizarTextoParaBd(o);
}

/** Valida cliente, convenio y período; devuelve lo que se graba. */
async function datosCabecera(body) {
	const errores = [];
	const idCliente = Number(body?.idCliente);
	const idConvenio = Number(body?.idConvenio);
	const periodo = mesAClarion(body?.periodo);
	if (!Number.isInteger(idCliente) || idCliente <= 0) errores.push('Elegí el cliente');
	if (!Number.isInteger(idConvenio) || idConvenio <= 0) errores.push('Elegí el convenio');
	if (periodo === null) errores.push('Elegí el período (mes y año)');
	if (errores.length) throw Object.assign(errorHttp(errores.join('. ')), { detalles: errores });

	const [cli, conv] = await Promise.all([
		executeQuery(`SELECT RTRIM(ValorCliente) AS Tipo FROM dbo.imClientes WHERE Valor = @p0`, [{ value: idCliente, type: 'Int' }]),
		executeQuery(`SELECT Valor FROM dbo.imClientesConvenios WHERE Codigo = @p0`, [{ value: idConvenio, type: 'Int' }]),
	]);
	if (!cli.length) throw errorHttp('El cliente no existe');
	if (!conv.length) throw errorHttp('El convenio no existe');
	const obraSocialConvenio = Number(conv[0].Valor);
	if (obraSocialConvenio !== 0 && obraSocialConvenio !== idCliente) {
		throw errorHttp('El convenio elegido pertenece a otro cliente');
	}
	return { idCliente, idConvenio, periodo, tipoCliente: texto(cli[0].Tipo).slice(0, 3) };
}

async function crear(body, ctx) {
	const d = await datosCabecera(body);
	const observaciones = observacionesDe(body?.observaciones);
	const r = await executeQuery(
		`DECLARE @emp smallint, @suc smallint;
		 SELECT TOP 1 @emp = IdEmpresa, @suc = IdSucursal FROM dbo.imRendiciones WHERE IdEmpresa > 0 ORDER BY IdRendicion DESC;
		 INSERT INTO dbo.imRendiciones (FechaGraba, OperGraba, IdTipoCliente, idCliente, idPaciente, idConvenio, Periodo,
		        Honorarios, Gastos, Medicamentos, OtrosServicios, Visitas, FechaCierre, HoraCierre, OperCierre,
		        Observaciones, IdEmpresa, IdSucursal)
		 VALUES (GETDATE(), @p0, @p1, @p2, 0, @p3, @p4, 0, 0, 0, 0, 0, 0, 0, 0, @p5, ISNULL(@emp, 1), ISNULL(@suc, 1));
		 SELECT CONVERT(int, SCOPE_IDENTITY()) AS IdRendicion;`,
		[
			{ value: Number(ctx?.actor) || 0, type: 'SmallInt' },
			{ value: d.tipoCliente, type: 'VarChar', length: 3 },
			{ value: d.idCliente, type: 'Int' },
			{ value: d.idConvenio, type: 'Int' },
			{ value: d.periodo, type: 'Int' },
			{ value: observaciones, type: 'VarChar', length: MAX_OBSERVACIONES },
		],
	);
	const id = Number(r[0]?.IdRendicion);
	if (!id) throw new Error('No se pudo crear la rendición');
	await registrar(ctx, 'CREAR', id, { despues: { ...d, observaciones } });
	return obtener(id);
}

/**
 * Observaciones siempre (si está abierta). Cliente, convenio y período solo
 * mientras no tenga líneas: las líneas ya se valorizaron con ese convenio.
 */
async function actualizar(idCrudo, body, ctx) {
	const id = entero(idCrudo, 'Rendición');
	const antes = await obtener(id);
	if (antes.estado === 'cerrada') throw errorHttp('La rendición está cerrada: no se puede modificar', 409);
	const observaciones = observacionesDe(body?.observaciones);
	const cambiaCabecera =
		body?.idCliente !== undefined || body?.idConvenio !== undefined || body?.periodo !== undefined;

	if (cambiaCabecera) {
		const d = await datosCabecera({
			idCliente: body.idCliente ?? antes.cliente.valor,
			idConvenio: body.idConvenio ?? antes.convenio.codigo,
			periodo: body.periodo ?? (antes.periodo ? antes.periodo.slice(0, 7) : ''),
		});
		const mismoContenido =
			d.idCliente === antes.cliente.valor &&
			d.idConvenio === antes.convenio.codigo &&
			clarionAIsoCalendario(d.periodo) === antes.periodo;
		if (!mismoContenido && antes.detalle.lineas > 0) {
			throw errorHttp('La rendición ya tiene prestaciones valorizadas: solo se pueden editar las observaciones', 409);
		}
		await executeQuery(
			`UPDATE dbo.imRendiciones SET idCliente = @p0, IdTipoCliente = @p1, idConvenio = @p2, Periodo = @p3, Observaciones = @p4
			 WHERE IdRendicion = @p5 AND ISNULL(FechaCierre, 0) = 0`,
			[
				{ value: d.idCliente, type: 'Int' },
				{ value: d.tipoCliente, type: 'VarChar', length: 3 },
				{ value: d.idConvenio, type: 'Int' },
				{ value: d.periodo, type: 'Int' },
				{ value: observaciones, type: 'VarChar', length: MAX_OBSERVACIONES },
				{ value: id, type: 'Int' },
			],
		);
	} else {
		await executeQuery(
			`UPDATE dbo.imRendiciones SET Observaciones = @p0 WHERE IdRendicion = @p1 AND ISNULL(FechaCierre, 0) = 0`,
			[
				{ value: observaciones, type: 'VarChar', length: MAX_OBSERVACIONES },
				{ value: id, type: 'Int' },
			],
		);
	}
	const despues = await obtener(id);
	await registrar(ctx, 'EDITAR', id, {
		antes: { cliente: antes.cliente.valor, convenio: antes.convenio.codigo, periodo: antes.periodo, observaciones: antes.observaciones },
		despues: { cliente: despues.cliente.valor, convenio: despues.convenio.codigo, periodo: despues.periodo, observaciones: despues.observaciones },
	});
	return despues;
}

/**
 * Reporte "Resumen" (RENDICION RESUMIDA): una fila por admisión con totales
 * GAS / HON / MED según filtros de tipo de admisión, visitas, rubros y letras.
 */
async function reporteResumen(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const tiposRaw = texto(query.tipos || query.tiposPrestacion || 'H,G,M')
		.toUpperCase()
		.split(/[,\s]+/)
		.filter(Boolean);
	const tipos = [...new Set(tiposRaw.filter((t) => t === 'H' || t === 'G' || t === 'M'))];
	if (!tipos.length) throw errorHttp('Seleccioná al menos un rubro: gastos, honorarios o medicamentos');

	const letrasRaw = texto(query.letras)
		.toUpperCase()
		.split(/[,\s]+/)
		.map((l) => l.slice(0, 1))
		.filter((l) => l && l !== '*');
	const letras = [...new Set(letrasRaw)];
	const filtrarLetras = letras.length > 0;

	const visitasRaw = texto(query.visitas || query.admisiones)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const visitasSel = [...new Set(visitasRaw.filter((n) => Number.isInteger(n) && n > 0))];
	const tipoAdmision = texto(query.tipoAdmision).slice(0, 1);

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`];

	const tiposPh = tipos.map((t) => prm.p(t, 'Char', 1));
	filtros.push(`d.TIPOPRESTACION IN (${tiposPh.join(', ')})`);

	if (visitasSel.length) {
		const ph = visitasSel.map((v) => prm.p(v, 'Int'));
		filtros.push(`d.NUMEROVISITA IN (${ph.join(', ')})`);
	}
	if (tipoAdmision) {
		filtros.push(`RTRIM(ISNULL(v.TIPOADMISION, '')) = ${prm.p(tipoAdmision, 'VarChar', 1)}`);
	}

	let letraExpr = `CASE RTRIM(ISNULL(d.IDMODULO, ''))
		WHEN 'NO' THEN RTRIM(ISNULL(nom.Tipo, ''))
		WHEN 'MO' THEN RTRIM(ISNULL(mo.Tipo, ''))
		ELSE '' END`;
	if (filtrarLetras) {
		const ph = letras.map((l) => prm.p(l, 'VarChar', 1));
		// Medicamentos (VA) no tienen letra de práctica: entran si el rubro M está pedido.
		filtros.push(
			`(RTRIM(ISNULL(d.IDMODULO, '')) = 'VA' OR (${letraExpr}) IN (${ph.join(', ')}))`,
		);
	}

	const where = filtros.join(' AND ');
	const filas = await executeQuery(
		`SELECT d.NUMEROVISITA AS NumeroVisita,
		        RTRIM(pac.ApellidoyNombre) AS Paciente,
		        NULLIF(RTRIM(ISNULL(pac.NumeroSSN, '')), '') AS NroAfiliado,
		        pac.NumeroDocumento AS Documento,
		        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS Ingreso,
		        RTRIM(ISNULL(v.TIPOADMISION, '')) AS TipoAdmision,
		        SUM(CASE WHEN d.TIPOPRESTACION = 'G' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Gastos,
		        SUM(CASE WHEN d.TIPOPRESTACION = 'H' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Honorarios,
		        SUM(CASE WHEN d.TIPOPRESTACION = 'M' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Medicamentos,
		        (
		          SELECT TOP 1 NULLIF(RTRIM(ISNULL(fp.NroAutorizacion, '')), '')
		          FROM dbo.imFacPracticas fp
		          WHERE fp.NumeroVisita = d.NUMEROVISITA
		            AND NULLIF(RTRIM(ISNULL(fp.NroAutorizacion, '')), '') IS NOT NULL
		          ORDER BY fp.Valor DESC
		        ) AS NroAutorizacion
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 WHERE ${where}
		 GROUP BY d.NUMEROVISITA, pac.ApellidoyNombre, pac.NumeroSSN, pac.NumeroDocumento,
		          v.FECHAADMISIONS, v.TIPOADMISION
		 ORDER BY d.NUMEROVISITA`,
		prm.lista,
	);

	const filasOut = filas.map((f) => {
		const gastos = num(f.Gastos);
		const honorarios = num(f.Honorarios);
		const medicamentos = num(f.Medicamentos);
		const afiliado = texto(f.NroAfiliado) || (f.Documento != null && f.Documento !== '' ? String(f.Documento).trim() : '');
		return {
			numeroVisita: num(f.NumeroVisita),
			paciente: texto(f.Paciente) || null,
			nroAfiliado: afiliado || null,
			nroAutorizacion: texto(f.NroAutorizacion) || null,
			ingreso: texto(f.Ingreso) || null,
			tipoAdmision: texto(f.TipoAdmision) || null,
			gastos,
			honorarios,
			medicamentos,
			total: gastos + honorarios + medicamentos,
		};
	});

	const totales = filasOut.reduce(
		(a, f) => ({
			gastos: a.gastos + f.gastos,
			honorarios: a.honorarios + f.honorarios,
			medicamentos: a.medicamentos + f.medicamentos,
			total: a.total + f.total,
		}),
		{ gastos: 0, honorarios: 0, medicamentos: 0, total: 0 },
	);

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			tipoAdmision: tipoAdmision || null,
			todasLasAdmisiones: visitasSel.length === 0,
			visitas: visitasSel,
			tipos,
			letras: filtrarLetras ? letras : ['*'],
		},
		filas: filasOut,
		totales,
		totalPacientes: filasOut.length,
	};
}

/**
 * Reporte "Detalle" (RENDICION INDIVIDUAL): por admisión, ficha del paciente
 * y líneas G/H/M. Sin «agrupar por rubro» (las secciones G/H/M ya vienen separadas).
 */
async function reporteDetalle(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const tiposRaw = texto(query.tipos || query.tiposPrestacion || 'H,G,M')
		.toUpperCase()
		.split(/[,\s]+/)
		.filter(Boolean);
	const tipos = [...new Set(tiposRaw.filter((t) => t === 'H' || t === 'G' || t === 'M'))];
	if (!tipos.length) throw errorHttp('Seleccioná al menos un rubro: gastos, honorarios o medicamentos');

	const letrasRaw = texto(query.letras)
		.toUpperCase()
		.split(/[,\s]+/)
		.map((l) => l.slice(0, 1))
		.filter((l) => l && l !== '*');
	const letras = [...new Set(letrasRaw)];
	const filtrarLetras = letras.length > 0;

	const visitasRaw = texto(query.visitas || query.admisiones)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const visitasSel = [...new Set(visitasRaw.filter((n) => Number.isInteger(n) && n > 0))];
	const tipoAdmision = texto(query.tipoAdmision).slice(0, 1);

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`];

	const tiposPh = tipos.map((t) => prm.p(t, 'Char', 1));
	filtros.push(`d.TIPOPRESTACION IN (${tiposPh.join(', ')})`);

	if (visitasSel.length) {
		const ph = visitasSel.map((v) => prm.p(v, 'Int'));
		filtros.push(`d.NUMEROVISITA IN (${ph.join(', ')})`);
	}
	if (tipoAdmision) {
		filtros.push(`RTRIM(ISNULL(v.TIPOADMISION, '')) = ${prm.p(tipoAdmision, 'VarChar', 1)}`);
	}

	const letraExpr = `CASE RTRIM(ISNULL(d.IDMODULO, ''))
		WHEN 'NO' THEN RTRIM(ISNULL(nom.Tipo, ''))
		WHEN 'MO' THEN RTRIM(ISNULL(mo.Tipo, ''))
		ELSE '' END`;
	if (filtrarLetras) {
		const ph = letras.map((l) => prm.p(l, 'VarChar', 1));
		filtros.push(
			`(RTRIM(ISNULL(d.IDMODULO, '')) = 'VA' OR (${letraExpr}) IN (${ph.join(', ')}))`,
		);
	}

	const where = filtros.join(' AND ');

	const admisionesRows = await executeQuery(
		`SELECT DISTINCT
		        d.NUMEROVISITA AS NumeroVisita,
		        v.IDPACIENTE AS IdPaciente,
		        RTRIM(pac.ApellidoyNombre) AS Paciente,
		        pac.NumeroDocumento AS Documento,
		        RTRIM(ISNULL(pac.TipoDocumento, '')) AS TipoDocumento,
		        NULLIF(RTRIM(ISNULL(pac.NumeroSSN, '')), '') AS NroAfiliado,
		        RTRIM(ISNULL(pac.Domicilio, '')) AS Domicilio,
		        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS IngresoFecha,
		        CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS IngresoHora,
		        v.FechaEgreso,
		        v.HoraEgreso,
		        RTRIM(ISNULL(v.CLASEPACIENTE, '')) AS Clase,
		        RTRIM(ISNULL(cp.Descripcion, '')) AS ClaseDescripcion,
		        RTRIM(ISNULL(v.Diagnostico, '')) AS Diagnostico,
		        RTRIM(ISNULL(diag.Descripcion, '')) AS DiagnosticoDescripcion,
		        RTRIM(ISNULL(v.TIPOADMISION, '')) AS TipoAdmision
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		 LEFT JOIN dbo.imClasePaciente cp ON cp.Valor = v.CLASEPACIENTE
		 LEFT JOIN dbo.imDiagnosticos diag
		   ON LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) = LTRIM(RTRIM(ISNULL(diag.CodigoOMS, '')))
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 WHERE ${where}
		 ORDER BY d.NUMEROVISITA`,
		prm.lista,
	);

	const lineasRows = await executeQuery(
		`SELECT d.NUMEROVISITA AS NumeroVisita,
		        RTRIM(d.TIPOPRESTACION) AS Tipo,
		        d.IDPRACTICA AS Codigo,
		        d.MATRICULA AS Matricula,
		        d.CANTIDAD AS Cantidad,
		        d.PORCENTAJE AS Porcentaje,
		        d.FECHA AS Fecha,
		        d.IMPORTE_UNITARIO AS ImporteUnitario,
		        d.IMPORTE_FINAL AS ImporteFinal,
		        COALESCE(
		          NULLIF(RTRIM(d.DESCRIPCION), ''),
		          RTRIM(nom.Descripcion),
		          RTRIM(mo.Descripcion),
		          RTRIM(CASE WHEN va.Alias = '' THEN va.Nombre ELSE va.Alias END),
		          ''
		        ) AS Practica,
		        RTRIM(prof.ApellidoNombre) AS Profesional
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imVademecum va ON RTRIM(d.IDMODULO) = 'VA' AND va.Troquel = d.IDPRACTICA
		 OUTER APPLY (
		   SELECT TOP 1 p.ApellidoNombre
		   FROM dbo.imPersonal p
		   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
		 ) prof
		 WHERE ${where}
		 ORDER BY d.NUMEROVISITA, d.TIPOPRESTACION, d.FECHA, d.IDDETALLE`,
		prm.lista,
	);

	const lineasPorVisita = new Map();
	for (const f of lineasRows) {
		const nv = num(f.NumeroVisita);
		if (!lineasPorVisita.has(nv)) lineasPorVisita.set(nv, []);
		const tipo = texto(f.Tipo);
		const codigo = num(f.Codigo);
		const practica = texto(f.Practica);
		const matricula = num(f.Matricula);
		const profesional = texto(f.Profesional);
		const partes = [
			codigo > 0 ? String(codigo) : '',
			practica,
			tipo === 'H' && matricula > 0 ? String(matricula) : '',
			tipo === 'H' && profesional ? profesional : '',
		].filter(Boolean);
		lineasPorVisita.get(nv).push({
			tipo,
			descripcion: partes.join(' ') || '—',
			fecha: clarionAIsoCalendario(f.Fecha),
			cantidad: num(f.Cantidad),
			porcentaje: num(f.Porcentaje),
			importeUnitario: num(f.ImporteUnitario),
			importeFinal: num(f.ImporteFinal),
		});
	}

	const coberturaNombre = texto(cab.cliente.razonSocial) || String(cab.cliente.valor || '');
	const admisiones = admisionesRows.map((f) => {
		const numeroVisita = num(f.NumeroVisita);
		const lineas = lineasPorVisita.get(numeroVisita) || [];
		const gastos = lineas.filter((l) => l.tipo === 'G');
		const honorarios = lineas.filter((l) => l.tipo === 'H');
		const medicamentos = lineas.filter((l) => l.tipo === 'M');
		const total = lineas.reduce((s, l) => s + l.importeFinal, 0);
		const egresoFecha = clarionAIsoCalendario(f.FechaEgreso);
		const egresoHora = convertirHoraClarionAString(f.HoraEgreso);
		const diagDesc = texto(f.DiagnosticoDescripcion);
		const diagCod = texto(f.Diagnostico);
		return {
			numeroVisita,
			paciente: {
				id: num(f.IdPaciente) || null,
				nombre: texto(f.Paciente) || null,
				documento:
					f.Documento != null && String(f.Documento).trim() !== ''
						? {
								tipo: texto(f.TipoDocumento) || null,
								numero: num(f.Documento) || Number(f.Documento) || 0,
							}
						: null,
				nroAfiliado: texto(f.NroAfiliado) || null,
				domicilio: texto(f.Domicilio) || null,
				nroLegajo: null,
				cuit: null,
				nroSiniestro: null,
				nroPoliza: null,
				cuitOsArt: null,
				dominioTransporte: null,
			},
			ingreso: {
				fecha: texto(f.IngresoFecha) || null,
				hora: texto(f.IngresoHora) || null,
			},
			egreso: {
				fecha: egresoFecha,
				hora: egresoHora ? egresoHora.slice(0, 5) : null,
			},
			cobertura: coberturaNombre || null,
			diagnostico: diagDesc || diagCod || null,
			clase: texto(f.Clase)
				? { valor: texto(f.Clase), descripcion: texto(f.ClaseDescripcion) || texto(f.Clase) }
				: null,
			tipoAdmision: texto(f.TipoAdmision) || null,
			gastos,
			honorarios,
			medicamentos,
			total,
		};
	});

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			tipoAdmision: tipoAdmision || null,
			todasLasAdmisiones: visitasSel.length === 0,
			visitas: visitasSel,
			tipos,
			letras: filtrarLetras ? letras : ['*'],
		},
		admisiones,
		totalAdmisiones: admisiones.length,
	};
}

/**
 * Reporte "Por profesional": honorarios (H) agrupados por matrícula,
 * con una fila por prestación (visita, paciente, afiliado, fecha, código, función, cant, %, importe).
 */
async function reporteProfesional(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const letrasRaw = texto(query.letras)
		.toUpperCase()
		.split(/[,\s]+/)
		.map((l) => l.slice(0, 1))
		.filter((l) => l && l !== '*');
	const letras = [...new Set(letrasRaw)];
	const filtrarLetras = letras.length > 0;

	const visitasRaw = texto(query.visitas || query.admisiones)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const visitasSel = [...new Set(visitasRaw.filter((n) => Number.isInteger(n) && n > 0))];
	const tipoAdmision = texto(query.tipoAdmision).slice(0, 1);

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`, `d.TIPOPRESTACION = ${prm.p('H', 'Char', 1)}`];

	if (visitasSel.length) {
		const ph = visitasSel.map((v) => prm.p(v, 'Int'));
		filtros.push(`d.NUMEROVISITA IN (${ph.join(', ')})`);
	}
	if (tipoAdmision) {
		filtros.push(`RTRIM(ISNULL(v.TIPOADMISION, '')) = ${prm.p(tipoAdmision, 'VarChar', 1)}`);
	}

	const letraExpr = `CASE RTRIM(ISNULL(d.IDMODULO, ''))
		WHEN 'NO' THEN RTRIM(ISNULL(nom.Tipo, ''))
		WHEN 'MO' THEN RTRIM(ISNULL(mo.Tipo, ''))
		ELSE '' END`;
	if (filtrarLetras) {
		const ph = letras.map((l) => prm.p(l, 'VarChar', 1));
		filtros.push(`(${letraExpr}) IN (${ph.join(', ')})`);
	}

	const where = filtros.join(' AND ');
	const filas = await executeQuery(
		`SELECT d.NUMEROVISITA AS NumeroVisita,
		        ISNULL(d.MATRICULA, 0) AS Matricula,
		        RTRIM(ISNULL(prof.ApellidoNombre, '')) AS Profesional,
		        RTRIM(pac.ApellidoyNombre) AS Paciente,
		        NULLIF(RTRIM(ISNULL(pac.NumeroSSN, '')), '') AS NroAfiliado,
		        pac.NumeroDocumento AS Documento,
		        d.FECHA AS Fecha,
		        d.IDPRACTICA AS Codigo,
		        ISNULL(d.FUNCION, 0) AS Funcion,
		        RTRIM(ISNULL(fn.Descripcion, '')) AS FuncionDescripcion,
		        ISNULL(d.CANTIDAD, 0) AS Cantidad,
		        ISNULL(d.PORCENTAJE, 0) AS Porcentaje,
		        ISNULL(d.IMPORTE_FINAL, 0) AS Importe
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imFunciones fn ON fn.Valor = d.FUNCION
		 OUTER APPLY (
		   SELECT TOP 1 p.ApellidoNombre
		   FROM dbo.imPersonal p
		   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
		 ) prof
		 WHERE ${where}
		 ORDER BY ISNULL(d.MATRICULA, 0), RTRIM(ISNULL(prof.ApellidoNombre, '')),
		          d.NUMEROVISITA, d.FECHA, d.IDDETALLE`,
		prm.lista,
	);

	const gruposMap = new Map();
	for (const f of filas) {
		const matricula = num(f.Matricula);
		const key = String(matricula);
		if (!gruposMap.has(key)) {
			gruposMap.set(key, {
				matricula,
				nombre: texto(f.Profesional) || (matricula > 0 ? null : 'Sin profesional'),
				lineas: [],
				total: 0,
			});
		}
		const afiliado =
			texto(f.NroAfiliado) ||
			(f.Documento != null && String(f.Documento).trim() !== '' ? String(f.Documento).trim() : '');
		const importe = num(f.Importe);
		const g = gruposMap.get(key);
		if (!g.nombre && texto(f.Profesional)) g.nombre = texto(f.Profesional);
		g.lineas.push({
			numeroVisita: num(f.NumeroVisita),
			paciente: texto(f.Paciente) || null,
			nroAfiliado: afiliado || null,
			fecha: clarionAIsoCalendario(f.Fecha),
			codigo: num(f.Codigo),
			funcion: num(f.Funcion),
			funcionDescripcion: texto(f.FuncionDescripcion) || null,
			cantidad: num(f.Cantidad),
			porcentaje: num(f.Porcentaje),
			importe,
		});
		g.total += importe;
	}

	const grupos = [...gruposMap.values()];
	const totalGeneral = grupos.reduce((s, g) => s + g.total, 0);

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			tipoAdmision: tipoAdmision || null,
			todasLasAdmisiones: visitasSel.length === 0,
			visitas: visitasSel,
			letras: filtrarLetras ? letras : ['*'],
		},
		grupos,
		totalGeneral,
		totalLineas: filas.length,
		totalProfesionales: grupos.length,
	};
}

/** Médicos/profesionales con honorarios en la rendición (para el filtro del sumario). */
async function profesionales(idCrudo) {
	const id = entero(idCrudo, 'Rendición');
	await filaCabecera(id);
	const filas = await executeQuery(
		`SELECT ISNULL(d.MATRICULA, 0) AS Matricula,
		        MAX(RTRIM(ISNULL(prof.ApellidoNombre, ''))) AS Nombre,
		        COUNT(*) AS Lineas
		 FROM dbo.imFacDetalle d
		 OUTER APPLY (
		   SELECT TOP 1 p.ApellidoNombre
		   FROM dbo.imPersonal p
		   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
		 ) prof
		 WHERE d.IDFACTURA = @p0 AND d.TIPOPRESTACION = 'H'
		 GROUP BY ISNULL(d.MATRICULA, 0)
		 ORDER BY MAX(RTRIM(ISNULL(prof.ApellidoNombre, ''))), ISNULL(d.MATRICULA, 0)`,
		[{ value: id, type: 'Int' }],
	);
	return filas.map((f) => {
		const matricula = num(f.Matricula);
		return {
			matricula,
			nombre: texto(f.Nombre) || (matricula > 0 ? null : 'Sin profesional'),
			lineas: num(f.Lineas),
		};
	});
}

/**
 * Reporte "Sumarizado por profesional": honorarios agregados por matrícula + código de práctica
 * (cantidad e importe sumados). Filtro opcional por matrícula.
 */
async function reporteProfesionalSumario(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const matriculasRaw = texto(query.matriculas || query.matricula)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const matriculasSel = [...new Set(matriculasRaw.filter((n) => Number.isInteger(n) && n >= 0))];
	const todosLosMedicos = !matriculasSel.length;

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`, `d.TIPOPRESTACION = ${prm.p('H', 'Char', 1)}`];
	if (!todosLosMedicos) {
		const ph = matriculasSel.map((m) => prm.p(m, 'Int'));
		filtros.push(`ISNULL(d.MATRICULA, 0) IN (${ph.join(', ')})`);
	}

	const where = filtros.join(' AND ');
	const filas = await executeQuery(
		`SELECT ISNULL(d.MATRICULA, 0) AS Matricula,
		        MAX(RTRIM(ISNULL(prof.ApellidoNombre, ''))) AS Profesional,
		        d.IDPRACTICA AS Codigo,
		        MAX(COALESCE(
		          NULLIF(RTRIM(d.DESCRIPCION), ''),
		          RTRIM(nom.Descripcion),
		          RTRIM(mo.Descripcion),
		          ''
		        )) AS Practica,
		        SUM(ISNULL(d.CANTIDAD, 0)) AS Cantidad,
		        SUM(ISNULL(d.IMPORTE_FINAL, 0)) AS Importe
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 OUTER APPLY (
		   SELECT TOP 1 p.ApellidoNombre
		   FROM dbo.imPersonal p
		   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
		 ) prof
		 WHERE ${where}
		 GROUP BY ISNULL(d.MATRICULA, 0), d.IDPRACTICA
		 ORDER BY ISNULL(d.MATRICULA, 0), d.IDPRACTICA`,
		prm.lista,
	);

	const gruposMap = new Map();
	for (const f of filas) {
		const matricula = num(f.Matricula);
		const key = String(matricula);
		if (!gruposMap.has(key)) {
			gruposMap.set(key, {
				matricula,
				nombre: texto(f.Profesional) || (matricula > 0 ? null : 'Sin profesional'),
				practicas: [],
				total: 0,
			});
		}
		const g = gruposMap.get(key);
		if (!g.nombre && texto(f.Profesional)) g.nombre = texto(f.Profesional);
		const importe = num(f.Importe);
		const codigo = num(f.Codigo);
		const practica = texto(f.Practica);
		g.practicas.push({
			codigo,
			descripcion: [codigo > 0 ? String(codigo) : '', practica].filter(Boolean).join(' ') || '—',
			cantidad: num(f.Cantidad),
			importe,
		});
		g.total += importe;
	}

	const grupos = [...gruposMap.values()];
	const totalPracticas = grupos.reduce((s, g) => s + g.practicas.length, 0);
	const totalGeneral = grupos.reduce((s, g) => s + g.total, 0);

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			todosLosMedicos,
			matriculas: matriculasSel,
		},
		grupos,
		totalPracticas,
		totalGeneral,
		totalProfesionales: grupos.length,
	};
}

/**
 * Opciones de filtro para «Por práctica detallado»: prácticas, funciones y profesionales
 * presentes en la rendición (reemplaza los rangos numéricos del escritorio).
 */
async function opcionesPracticaDetalle(idCrudo) {
	const id = entero(idCrudo, 'Rendición');
	await filaCabecera(id);
	const [practicas, funciones, medicos] = await Promise.all([
		executeQuery(
			`SELECT d.IDPRACTICA AS Codigo,
			        MAX(COALESCE(
			          NULLIF(RTRIM(d.DESCRIPCION), ''),
			          RTRIM(nom.Descripcion),
			          RTRIM(mo.Descripcion),
			          RTRIM(CASE WHEN va.Alias = '' THEN va.Nombre ELSE va.Alias END),
			          ''
			        )) AS Descripcion,
			        COUNT(*) AS Lineas
			 FROM dbo.imFacDetalle d
			 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
			 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
			 LEFT JOIN dbo.imVademecum va ON RTRIM(d.IDMODULO) = 'VA' AND va.Troquel = d.IDPRACTICA
			 WHERE d.IDFACTURA = @p0
			 GROUP BY d.IDPRACTICA
			 ORDER BY d.IDPRACTICA`,
			[{ value: id, type: 'Int' }],
		),
		executeQuery(
			`SELECT ISNULL(d.FUNCION, 0) AS Funcion,
			        MAX(RTRIM(ISNULL(fn.Descripcion, ''))) AS Descripcion,
			        COUNT(*) AS Lineas
			 FROM dbo.imFacDetalle d
			 LEFT JOIN dbo.imFunciones fn ON fn.Valor = d.FUNCION
			 WHERE d.IDFACTURA = @p0
			 GROUP BY ISNULL(d.FUNCION, 0)
			 ORDER BY ISNULL(d.FUNCION, 0)`,
			[{ value: id, type: 'Int' }],
		),
		executeQuery(
			`SELECT ISNULL(d.MATRICULA, 0) AS Matricula,
			        MAX(RTRIM(ISNULL(prof.ApellidoNombre, ''))) AS Nombre,
			        COUNT(*) AS Lineas
			 FROM dbo.imFacDetalle d
			 OUTER APPLY (
			   SELECT TOP 1 p.ApellidoNombre
			   FROM dbo.imPersonal p
			   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
			 ) prof
			 WHERE d.IDFACTURA = @p0 AND ISNULL(d.MATRICULA, 0) > 0
			 GROUP BY ISNULL(d.MATRICULA, 0)
			 ORDER BY MAX(RTRIM(ISNULL(prof.ApellidoNombre, ''))), ISNULL(d.MATRICULA, 0)`,
			[{ value: id, type: 'Int' }],
		),
	]);
	return {
		practicas: practicas.map((f) => ({
			codigo: num(f.Codigo),
			descripcion: texto(f.Descripcion) || null,
			lineas: num(f.Lineas),
		})),
		funciones: funciones.map((f) => ({
			valor: num(f.Funcion),
			descripcion: texto(f.Descripcion) || (num(f.Funcion) ? String(num(f.Funcion)) : 'Sin función'),
			lineas: num(f.Lineas),
		})),
		profesionales: medicos.map((f) => ({
			matricula: num(f.Matricula),
			nombre: texto(f.Nombre) || null,
			lineas: num(f.Lineas),
		})),
	};
}

/**
 * Reporte «Por práctica detallado» (DETALLE DE PRÁCTICAS): una fila por prestación
 * con datos de visita/paciente/profesional. Orden por admisión o por práctica.
 */
async function reportePracticaDetalle(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const tiposRaw = texto(query.tipos || query.tiposPrestacion || 'H,G,M')
		.toUpperCase()
		.split(/[,\s]+/)
		.filter(Boolean);
	const tipos = [...new Set(tiposRaw.filter((t) => t === 'H' || t === 'G' || t === 'M'))];
	if (!tipos.length) throw errorHttp('Seleccioná al menos un rubro: gastos, honorarios o medicamentos');

	const practicasRaw = texto(query.practicas || query.codigos)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const practicasSel = [...new Set(practicasRaw.filter((n) => Number.isInteger(n) && n > 0))];

	const funcionesRaw = texto(query.funciones)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const funcionesSel = [...new Set(funcionesRaw.filter((n) => Number.isInteger(n) && n >= 0))];

	const matriculasRaw = texto(query.matriculas || query.matricula)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const matriculasSel = [...new Set(matriculasRaw.filter((n) => Number.isInteger(n) && n >= 0))];

	const orden = texto(query.orden || 'admision').toLowerCase() === 'practica' ? 'practica' : 'admision';
	const desglosarModulos =
		query.desglosarModulos === undefined ||
		query.desglosarModulos === '' ||
		query.desglosarModulos === '1' ||
		query.desglosarModulos === 'true';

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`];

	const tiposPh = tipos.map((t) => prm.p(t, 'Char', 1));
	filtros.push(`d.TIPOPRESTACION IN (${tiposPh.join(', ')})`);

	if (practicasSel.length) {
		const ph = practicasSel.map((c) => prm.p(c, 'Int'));
		filtros.push(`d.IDPRACTICA IN (${ph.join(', ')})`);
	}
	if (funcionesSel.length) {
		const ph = funcionesSel.map((f) => prm.p(f, 'Int'));
		filtros.push(`ISNULL(d.FUNCION, 0) IN (${ph.join(', ')})`);
	}
	if (matriculasSel.length) {
		const ph = matriculasSel.map((m) => prm.p(m, 'Int'));
		filtros.push(`ISNULL(d.MATRICULA, 0) IN (${ph.join(', ')})`);
	}
	// Sin desglose: solo nomenclador/vademécum (oculta cabeceras moduladas MO).
	if (!desglosarModulos) {
		filtros.push(`RTRIM(ISNULL(d.IDMODULO, '')) <> 'MO'`);
	}

	const where = filtros.join(' AND ');
	const orderSql =
		orden === 'practica'
			? `d.IDPRACTICA, d.NUMEROVISITA, d.FECHA, d.IDDETALLE`
			: `d.NUMEROVISITA, d.FECHA, d.IDPRACTICA, d.IDDETALLE`;

	const filas = await executeQuery(
		`SELECT d.NUMEROVISITA AS NumeroVisita,
		        RTRIM(pac.ApellidoyNombre) AS Paciente,
		        pac.NumeroDocumento AS Documento,
		        NULLIF(RTRIM(ISNULL(pac.NumeroSSN, '')), '') AS NroAfiliado,
		        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS IngresoFecha,
		        v.FechaEgreso,
		        RTRIM(ISNULL(v.Diagnostico, '')) AS Diagnostico,
		        RTRIM(ISNULL(diag.Descripcion, '')) AS DiagnosticoDescripcion,
		        RTRIM(d.TIPOPRESTACION) AS Tipo,
		        RTRIM(ISNULL(d.IDMODULO, '')) AS Modulo,
		        d.IDPRACTICA AS Codigo,
		        COALESCE(
		          NULLIF(RTRIM(d.DESCRIPCION), ''),
		          RTRIM(nom.Descripcion),
		          RTRIM(mo.Descripcion),
		          RTRIM(CASE WHEN va.Alias = '' THEN va.Nombre ELSE va.Alias END),
		          ''
		        ) AS Practica,
		        d.FECHA AS Fecha,
		        ISNULL(d.CANTIDAD, 0) AS Cantidad,
		        ISNULL(d.PORCENTAJE, 0) AS Porcentaje,
		        ISNULL(d.IMPORTE_FINAL, 0) AS Importe,
		        ISNULL(d.MATRICULA, 0) AS Matricula,
		        RTRIM(ISNULL(prof.ApellidoNombre, '')) AS Profesional,
		        ISNULL(d.FUNCION, 0) AS Funcion,
		        RTRIM(ISNULL(fn.Descripcion, '')) AS FuncionDescripcion
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = d.NUMEROVISITA
		 LEFT JOIN dbo.imPacientes pac ON pac.IdPaciente = v.IDPACIENTE
		 LEFT JOIN dbo.imDiagnosticos diag
		   ON LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) = LTRIM(RTRIM(ISNULL(diag.CodigoOMS, '')))
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imVademecum va ON RTRIM(d.IDMODULO) = 'VA' AND va.Troquel = d.IDPRACTICA
		 LEFT JOIN dbo.imFunciones fn ON fn.Valor = d.FUNCION
		 OUTER APPLY (
		   SELECT TOP 1 p.ApellidoNombre
		   FROM dbo.imPersonal p
		   WHERE p.Matricula = d.MATRICULA AND d.MATRICULA > 0
		 ) prof
		 WHERE ${where}
		 ORDER BY ${orderSql}`,
		prm.lista,
	);

	const lineas = filas.map((f) => {
		const afiliado =
			texto(f.NroAfiliado) ||
			(f.Documento != null && String(f.Documento).trim() !== '' ? String(f.Documento).trim() : '');
		return {
			numeroVisita: num(f.NumeroVisita),
			paciente: texto(f.Paciente) || null,
			nroAfiliado: afiliado || null,
			ingreso: texto(f.IngresoFecha) || null,
			egreso: clarionAIsoCalendario(f.FechaEgreso),
			diagnostico: texto(f.DiagnosticoDescripcion) || texto(f.Diagnostico) || null,
			codigoDiagnostico: texto(f.Diagnostico) || null,
			tipo: texto(f.Tipo),
			modulo: texto(f.Modulo),
			codigo: num(f.Codigo),
			descripcion: texto(f.Practica) || null,
			fecha: clarionAIsoCalendario(f.Fecha),
			cantidad: num(f.Cantidad),
			porcentaje: num(f.Porcentaje),
			importe: num(f.Importe),
			matricula: num(f.Matricula),
			profesional: texto(f.Profesional) || null,
			funcion: num(f.Funcion),
			funcionDescripcion: texto(f.FuncionDescripcion) || null,
		};
	});

	const visitas = new Set(lineas.map((l) => l.numeroVisita).filter(Boolean));
	const totalCantidad = lineas.reduce((s, l) => s + l.cantidad, 0);
	const totalImporte = lineas.reduce((s, l) => s + l.importe, 0);

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			tipos,
			practicas: practicasSel,
			funciones: funcionesSel,
			matriculas: matriculasSel,
			orden,
			desglosarModulos: Boolean(desglosarModulos),
		},
		lineas,
		totales: {
			visitas: visitas.size,
			practicas: lineas.length,
			cantidad: totalCantidad,
			importe: totalImporte,
		},
	};
}

/**
 * Reporte «Por práctica resumido» (RESUMEN POR PRÁCTICAS):
 * una fila por código de práctica con cantidad, visitas distintas,
 * honorarios (H), gastos (G+M) y total.
 */
async function reportePracticaResumen(idCrudo, query = {}) {
	const id = entero(idCrudo, 'Rendición');
	const cab = cabecera(await filaCabecera(id));

	const tiposRaw = texto(query.tipos || query.tiposPrestacion || 'H,G,M')
		.toUpperCase()
		.split(/[,\s]+/)
		.filter(Boolean);
	const tipos = [...new Set(tiposRaw.filter((t) => t === 'H' || t === 'G' || t === 'M'))];
	if (!tipos.length) throw errorHttp('Seleccioná al menos un rubro: gastos, honorarios o medicamentos');

	const practicasRaw = texto(query.practicas || query.codigos)
		.split(/[,\s]+/)
		.filter(Boolean)
		.map((v) => Number(v));
	const practicasSel = [...new Set(practicasRaw.filter((n) => Number.isInteger(n) && n > 0))];

	const desglosarModulos =
		query.desglosarModulos === undefined ||
		query.desglosarModulos === '' ||
		query.desglosarModulos === '1' ||
		query.desglosarModulos === 'true';

	const prm = parametros();
	const pId = prm.p(id, 'Int');
	const filtros = [`d.IDFACTURA = ${pId}`];

	const tiposPh = tipos.map((t) => prm.p(t, 'Char', 1));
	filtros.push(`d.TIPOPRESTACION IN (${tiposPh.join(', ')})`);

	if (practicasSel.length) {
		const ph = practicasSel.map((c) => prm.p(c, 'Int'));
		filtros.push(`d.IDPRACTICA IN (${ph.join(', ')})`);
	}
	if (!desglosarModulos) {
		filtros.push(`RTRIM(ISNULL(d.IDMODULO, '')) <> 'MO'`);
	}

	const where = filtros.join(' AND ');
	const filas = await executeQuery(
		`SELECT d.IDPRACTICA AS Codigo,
		        MAX(COALESCE(
		          NULLIF(RTRIM(d.DESCRIPCION), ''),
		          RTRIM(nom.Descripcion),
		          RTRIM(mo.Descripcion),
		          RTRIM(CASE WHEN va.Alias = '' THEN va.Nombre ELSE va.Alias END),
		          ''
		        )) AS Practica,
		        SUM(ISNULL(d.CANTIDAD, 0)) AS Cantidad,
		        COUNT(DISTINCT NULLIF(d.NUMEROVISITA, 0)) AS Visitas,
		        SUM(CASE WHEN RTRIM(d.TIPOPRESTACION) = 'H' THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Honorarios,
		        SUM(CASE WHEN RTRIM(d.TIPOPRESTACION) IN ('G', 'M') THEN ISNULL(d.IMPORTE_FINAL, 0) ELSE 0 END) AS Gastos,
		        SUM(ISNULL(d.IMPORTE_FINAL, 0)) AS Total
		 FROM dbo.imFacDetalle d
		 LEFT JOIN dbo.imNomenclador nom ON RTRIM(d.IDMODULO) = 'NO' AND nom.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imModuladas mo ON RTRIM(d.IDMODULO) = 'MO' AND mo.IDPractica = d.IDPRACTICA
		 LEFT JOIN dbo.imVademecum va ON RTRIM(d.IDMODULO) = 'VA' AND va.Troquel = d.IDPRACTICA
		 WHERE ${where}
		 GROUP BY d.IDPRACTICA
		 ORDER BY d.IDPRACTICA`,
		prm.lista,
	);

	const lineas = filas.map((f) => ({
		codigo: num(f.Codigo),
		descripcion: texto(f.Practica) || null,
		cantidad: num(f.Cantidad),
		visitas: num(f.Visitas),
		honorarios: num(f.Honorarios),
		gastos: num(f.Gastos),
		total: num(f.Total),
	}));

	const totales = lineas.reduce(
		(acc, l) => {
			acc.cantidad += l.cantidad;
			acc.visitas += l.visitas;
			acc.honorarios += l.honorarios;
			acc.gastos += l.gastos;
			acc.total += l.total;
			return acc;
		},
		{ cantidad: 0, visitas: 0, honorarios: 0, gastos: 0, total: 0 },
	);

	return {
		rendicion: {
			id: cab.id,
			cliente: cab.cliente,
			convenio: cab.convenio,
			periodo: cab.periodo,
			fechaGraba: cab.fechaGraba,
			observaciones: cab.observaciones || null,
		},
		filtros: {
			tipos,
			practicas: practicasSel,
			desglosarModulos: Boolean(desglosarModulos),
		},
		lineas,
		totales: {
			practicas: lineas.length,
			...totales,
		},
	};
}

/** Solo rendiciones vacías: sin líneas, sin facturas y sin liquidación que las referencie. */
async function eliminar(idCrudo, ctx) {
	const id = entero(idCrudo, 'Rendición');
	const antes = await obtener(id);
	if (!antes.vacia) {
		throw errorHttp('Solo se pueden borrar rendiciones vacías (sin prestaciones, facturas ni liquidaciones)', 409);
	}
	const r = await executeQuery(
		`DELETE FROM dbo.imRendiciones
		 WHERE IdRendicion = @p0 AND ISNULL(FechaCierre, 0) = 0
		   AND NOT EXISTS (SELECT 1 FROM dbo.imFacDetalle WHERE IDFACTURA = @p0)
		   AND NOT EXISTS (SELECT 1 FROM dbo.imFacturas WHERE IdRendicion = @p0)
		   AND NOT EXISTS (SELECT 1 FROM dbo.FacturacionProfDetalle WHERE IdRendicion = @p0);
		 SELECT @@ROWCOUNT AS n;`,
		[{ value: id, type: 'Int' }],
	);
	if (!num(r[0]?.n)) throw errorHttp('La rendición cambió mientras tanto y ya no está vacía', 409);
	await registrar(ctx, 'ELIMINAR', id, { antes: { cliente: antes.cliente.valor, convenio: antes.convenio.codigo, periodo: antes.periodo } });
	return { id };
}

module.exports = {
	catalogos,
	listar,
	exportar,
	obtener,
	visitas,
	lineas,
	facturas,
	reporteResumen,
	reporteDetalle,
	reporteProfesional,
	profesionales,
	reporteProfesionalSumario,
	opcionesPracticaDetalle,
	reportePracticaDetalle,
	reportePracticaResumen,
	crear,
	actualizar,
	eliminar,
};
