/**
 * Producción hospitalaria — versión institucional de "Mi Producción".
 *
 * Fuente de datos
 * ---------------
 * NO se consulta dbo.VProduccionProfesionales. La vista filtra por una fecha
 * calculada (no usa el índice de imFacPracticas.FechaPractica) y un mes le cuesta
 * ~9 s contra ~0,2 s sobre las tablas base. Además une imFacDetalle sin filtrar
 * TIPOPRESTACION, así que a los honorarios se les cuelan gastos (G) e Y.
 * Acá se arma el mismo cruce sobre las tablas base:
 *
 *   imFacPracticas → imFacProfesionales → imFacDetalle (TIPOPRESTACION = 'H')
 *
 * Grano
 * -----
 * Una fila = práctica × profesional (× línea de honorarios). Una práctica con
 * ayudante y anestesista aparece varias veces, así que:
 *   • "prácticas"     = COUNT(DISTINCT imFacPracticas.Valor)
 *   • "prestaciones"  = filas (práctica × profesional)
 *   • los importes se suman por fila (cada línea de honorarios es plata distinta).
 *
 * Estado de valorización (misma regla que Mi Producción)
 * ------------------------------------------------------
 *   NO_FACTURABLE → la cobertura está marcada NoFacturable (tiene prioridad)
 *   VALORIZADA    → tiene línea de honorarios con importe > 0
 *   SIN_VALORIZAR → el resto
 * El importe facturado y el liquidado suman SOLO las valorizadas.
 *
 * Cobertura
 * ---------
 * La de la rendición donde se facturó la práctica (imFacDetalle.IDFACTURA →
 * imRendiciones.idCliente); si todavía no se facturó, la de la visita
 * (imVisita.CLIENTE). Es la obra social a la que se le liquidó o se le va a
 * liquidar, que no siempre coincide con la cuenta actual del paciente.
 *
 * Lugar de la práctica
 * --------------------
 * Sector = imFacPracticas.ValorSector (con el sector de la visita como respaldo
 * cuando la práctica no lo trae). Servicio = el del sector (imSectores). La clase
 * de paciente sale de la visita (ambulatorio, internado, hospital de día...).
 *
 * Fechas
 * ------
 * FechaPractica es un entero Clarion (días desde 1800-12-28). El rango se
 * convierte a entero para usar el índice. Hay pocas filas con fechas basura
 * (1950, 2027-2048), por eso el rango se acota a [2000-01-01, hoy].
 *
 * No requiere objetos SQL desplegados en el tenant. Sólo verifica al primer uso
 * que existan las tablas y columnas que necesita.
 */
const { executeQuery } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');
const { convertirFechaAClarion, fechaCalendarioArgentina } = require('../utils/dateUtils');

// ── Constantes ──────────────────────────────────────────────────────────────

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_MINIMA = '2000-01-01';
const RANGO_MAX_DIAS = 1100;
const MAX_ITEMS_LISTA = 200;
const MAX_FILAS_DIMENSION = 1000;
const MAX_FILAS_PRACTICAS = 40;

/** Hasta cuántos días se agrupa por día / por semana; más que eso, por mes. */
const GRANULARIDAD_DIA_MAX = 45;
const GRANULARIDAD_SEMANA_MAX = 180;

const LIQUIDACIONES = Object.freeze(['todas', 'liquidadas', 'pendientes']);

/** Dimensiones del gráfico: columna del CTE `b` que agrupa, su etiqueta y el texto si falta. */
const DIMENSIONES = Object.freeze({
	cobertura: { id: 'coberturaId', label: 'coberturaLabel', vacio: '(Sin cobertura)' },
	profesional: { id: 'matricula', label: 'profesionalLabel', vacio: '(Sin profesional asignado)' },
	especialidad: { id: 'especialidadId', label: 'especialidadLabel', vacio: '(Sin especialidad)' },
	servicio: { id: 'servicioId', label: 'servicioLabel', vacio: '(Sin servicio)' },
	sector: { id: 'sectorId', label: 'sectorLabel', vacio: '(Sin sector)' },
	clase: { id: 'claseId', label: 'claseLabel', vacio: '(Sin clase)' },
	funcion: { id: 'funcionId', label: 'funcionLabel', vacio: '(Sin función)' },
});

/** Tablas y columnas que el cruce necesita; `opcionales` degradan la métrica en vez de fallar. */
const ESQUEMA_REQUERIDO = Object.freeze({
	imFacPracticas: ['Valor', 'NumeroVisita', 'TipoPractica', 'Practica', 'FechaPractica', 'ValorSector'],
	imFacProfesionales: ['IDFacProfesional', 'Valor', 'Matricula', 'Funcion'],
	imVisita: ['NUMEROVISITA', 'IDPACIENTE', 'VALORSECTOR', 'CLASEPACIENTE', 'CLIENTE'],
	imFacDetalle: ['IDPRESTACION', 'NUMEROVISITA', 'TIPOPRESTACION', 'IDFACTURA', 'IMPORTE_FINAL'],
	imRendiciones: ['IdRendicion', 'idCliente'],
	imClientes: ['Valor', 'RazonSocial'],
	imSectores: ['Valor', 'ValorServicio', 'Descripcion', 'AmbInt'],
	imServicios: ['Valor', 'Descripcion'],
	imClasePaciente: ['Valor', 'Descripcion'],
	imFunciones: ['Valor', 'Descripcion'],
	imPersonal: ['Valor', 'Matricula', 'ApellidoNombre', 'ValorEspecialidad'],
	imEspecialidad: ['Valor', 'Descripcion'],
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function _error(statusCode, message) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

function _num(v, defecto = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : defecto;
}

/** Importes a 2 decimales; null si no hay dato. */
function _importe(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Texto limpio para mostrar: sin espacios sobrantes ni saltos de línea (hay descripciones con \r\n). */
function _txt(v) {
	const s = String(v ?? '').replace(/\s+/g, ' ').trim();
	return s || null;
}

function _bool(v, defecto) {
	if (v == null || v === '') return defecto;
	if (typeof v === 'boolean') return v;
	const s = String(v).trim().toLowerCase();
	if (['1', 'true', 'si', 'sí', 'yes', 'on'].includes(s)) return true;
	if (['0', 'false', 'no', 'off'].includes(s)) return false;
	return defecto;
}

function _partesIso(iso) {
	const [y, m, d] = iso.split('-').map(Number);
	return { y, m, d };
}

function _sumarDias(iso, dias) {
	const { y, m, d } = _partesIso(iso);
	return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Días entre dos fechas ISO, ambas inclusive. */
function _diasInclusive(desde, hasta) {
	const a = _partesIso(desde);
	const b = _partesIso(hasta);
	return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000) + 1;
}

function _fechaValida(iso) {
	if (!FECHA_ISO.test(String(iso))) return false;
	const { y, m, d } = _partesIso(iso);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Lista desde `a,b,c` (o array). Enteros o códigos cortos de catálogo. */
function _lista(valor, tipo, nombre) {
	if (valor == null || valor === '') return [];
	const partes = (Array.isArray(valor) ? valor : String(valor).split(','))
		.map((s) => String(s).trim())
		.filter(Boolean);
	if (partes.length > MAX_ITEMS_LISTA) {
		throw _error(400, `El filtro ${nombre} admite hasta ${MAX_ITEMS_LISTA} elementos`);
	}
	const unicos = [...new Set(partes)];
	if (tipo === 'int') {
		return unicos.map((p) => {
			if (!/^\d{1,10}$/.test(p)) throw _error(400, `El filtro ${nombre} tiene un valor inválido: ${p}`);
			return Number(p);
		});
	}
	return unicos.map((p) => {
		if (!/^[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ._\- ]{1,8}$/.test(p)) {
			throw _error(400, `El filtro ${nombre} tiene un valor inválido: ${p}`);
		}
		return p;
	});
}

// ── Filtros ─────────────────────────────────────────────────────────────────

/**
 * Valida y normaliza lo que llega por query string.
 * El período se acota a [FECHA_MINIMA, hoy]: las fechas futuras son carga errónea.
 */
function normalizarFiltros(query = {}) {
	const { fechaInicio, fechaFin } = query;

	if (!fechaInicio || !fechaFin) {
		throw _error(400, 'Los parámetros fechaInicio y fechaFin son requeridos');
	}
	if (!_fechaValida(fechaInicio) || !_fechaValida(fechaFin)) {
		throw _error(400, 'Formato de fecha inválido. Use YYYY-MM-DD');
	}

	const hoy = fechaCalendarioArgentina();
	const inicio = String(fechaInicio);
	const finPedido = String(fechaFin);
	const fin = finPedido > hoy ? hoy : finPedido;

	if (inicio > fin) {
		throw _error(400, 'La fecha de inicio no puede ser mayor que la fecha de fin');
	}
	if (inicio < FECHA_MINIMA) {
		throw _error(400, `La fecha de inicio no puede ser anterior a ${FECHA_MINIMA}`);
	}
	const dias = _diasInclusive(inicio, fin);
	if (dias > RANGO_MAX_DIAS) {
		throw _error(400, `El rango no puede superar los ${RANGO_MAX_DIAS} días (pedido: ${dias})`);
	}

	const liquidacion = String(query.liquidacion || 'todas').trim().toLowerCase();
	if (!LIQUIDACIONES.includes(liquidacion)) {
		throw _error(400, `El filtro liquidacion admite: ${LIQUIDACIONES.join(', ')}`);
	}

	return {
		periodo: {
			inicio,
			fin,
			dias,
			finAjustado: fin !== finPedido,
		},
		coberturas: _lista(query.coberturas, 'int', 'coberturas'),
		profesionales: _lista(query.profesionales, 'int', 'profesionales'),
		especialidades: _lista(query.especialidades, 'int', 'especialidades'),
		servicios: _lista(query.servicios, 'texto', 'servicios'),
		sectores: _lista(query.sectores, 'texto', 'sectores'),
		clases: _lista(query.clases, 'texto', 'clases'),
		funciones: _lista(query.funciones, 'int', 'funciones'),
		rendiciones: _lista(query.rendiciones, 'int', 'rendiciones'),
		// Por defecto sólo lo valorizado; ver todo es una decisión explícita del usuario.
		soloValorizadas: _bool(query.soloValorizadas, true),
		liquidacion,
	};
}

/** Período inmediatamente anterior, de la misma duración. */
function periodoAnterior(periodo) {
	const fin = _sumarDias(periodo.inicio, -1);
	const inicio = _sumarDias(fin, -(periodo.dias - 1));
	return { inicio, fin, dias: periodo.dias };
}

function granularidadPara(dias) {
	if (dias <= GRANULARIDAD_DIA_MAX) return 'dia';
	if (dias <= GRANULARIDAD_SEMANA_MAX) return 'semana';
	return 'mes';
}

// ── Esquema del tenant ──────────────────────────────────────────────────────

/**
 * Verifica una vez por tenant que existan las tablas/columnas del cruce y
 * detecta las opcionales (ImporteLiquidado la crea un script de migración; la
 * marca NoFacturable de imClientes no está en bases viejas).
 */
const esquemaTenant = createTenantOnce(async () => {
	const tablas = [...Object.keys(ESQUEMA_REQUERIDO), 'imClientes', 'imFacDetalle'];
	const filas = await executeQuery(
		`SELECT TABLE_NAME, COLUMN_NAME
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo'
		   AND TABLE_NAME IN (${[...new Set(tablas)].map((t) => `'${t}'`).join(', ')})`,
	);

	const porTabla = new Map();
	for (const f of filas || []) {
		const t = String(f.TABLE_NAME || '').toLowerCase();
		if (!porTabla.has(t)) porTabla.set(t, new Set());
		porTabla.get(t).add(String(f.COLUMN_NAME || '').toLowerCase());
	}

	const faltantes = [];
	for (const [tabla, columnas] of Object.entries(ESQUEMA_REQUERIDO)) {
		const tiene = porTabla.get(tabla.toLowerCase());
		if (!tiene) {
			faltantes.push(tabla);
			continue;
		}
		for (const c of columnas) {
			if (!tiene.has(c.toLowerCase())) faltantes.push(`${tabla}.${c}`);
		}
	}
	if (faltantes.length) {
		throw _error(
			409,
			`La base de esta empresa no tiene las tablas necesarias para la producción hospitalaria: ${faltantes.join(', ')}`,
		);
	}

	return {
		liquidado: porTabla.get('imfacdetalle').has('importeliquidado'),
		noFacturable: porTabla.get('imclientes').has('nofacturable'),
	};
});

// ── Construcción de la consulta ─────────────────────────────────────────────

/**
 * Devuelve `{ con, donde, params }`:
 *  • `con`   → "WITH b AS (...)" con una fila por práctica × profesional del período
 *  • `donde` → filtros del usuario sobre las columnas de `b` (cadena vacía si no hay)
 *  • `params`→ parámetros posicionales (@p0, @p1...) para executeQuery
 *
 * El rango de fechas va dentro del CTE, sobre el entero Clarion crudo, para usar
 * el índice Por_FechaPractica. El resto de los filtros va afuera porque
 * dependen de columnas derivadas (estado, cobertura resuelta, sector resuelto).
 */
function construirConsulta(periodo, filtros, esquema) {
	const params = [];
	const p = (value) => {
		params.push({ value });
		return `@p${params.length - 1}`;
	};

	const pDesde = p(convertirFechaAClarion(periodo.inicio));
	const pHasta = p(convertirFechaAClarion(periodo.fin));

	const liquidado = esquema.liquidado ? 'd.ImporteLiquidado' : 'CAST(NULL AS DECIMAL(19, 4))';
	const noFacturable = esquema.noFacturable ? 'ISNULL(cli.NoFacturable, 0)' : '0';

	const con = `
WITH b AS (
  SELECT
    p.Valor AS practicaId,
    p.NumeroVisita AS visitaId,
    v.IDPACIENTE AS pacienteId,
    p.Practica AS practica,
    p.TipoPractica AS tipoPractica,
    DATEADD(day, p.FechaPractica, '18001228') AS fecha,
    pr.Matricula AS matricula,
    COALESCE(NULLIF(LTRIM(RTRIM(pe.ApellidoNombre)), ''), 'Matrícula ' + CAST(pr.Matricula AS VARCHAR(12))) AS profesionalLabel,
    pr.Funcion AS funcionId,
    f.Descripcion AS funcionLabel,
    CASE WHEN e.Valor IS NULL THEN NULL ELSE pe.ValorEspecialidad END AS especialidadId,
    e.Descripcion AS especialidadLabel,
    RTRIM(sv.Valor) AS servicioId,
    sv.Descripcion AS servicioLabel,
    NULLIF(RTRIM(COALESCE(s.Valor, sx.sectorId)), '') AS sectorId,
    COALESCE(s.Descripcion, sx.sectorId) AS sectorLabel,
    NULLIF(LTRIM(RTRIM(v.CLASEPACIENTE)), '') AS claseId,
    COALESCE(cp.Descripcion, NULLIF(LTRIM(RTRIM(v.CLASEPACIENTE)), '')) AS claseLabel,
    COALESCE(r.idCliente, v.CLIENTE) AS coberturaId,
    cli.RazonSocial AS coberturaLabel,
    d.IDFACTURA AS rendicion,
    d.IMPORTE_FINAL AS importe,
    ${liquidado} AS liquidado,
    CASE
      WHEN ${noFacturable} = 1 THEN 'N'
      WHEN ISNULL(d.IMPORTE_FINAL, 0) > 0 THEN 'V'
      ELSE 'S'
    END AS estado
  FROM dbo.imFacPracticas p
  JOIN dbo.imVisita v ON v.NUMEROVISITA = p.NumeroVisita
  LEFT JOIN dbo.imFacProfesionales pr ON pr.Valor = p.Valor
  LEFT JOIN dbo.imFacDetalle d
    ON d.IDPRESTACION = pr.IDFacProfesional
   AND d.NUMEROVISITA = p.NumeroVisita
   AND d.TIPOPRESTACION = 'H'
  LEFT JOIN dbo.imRendiciones r ON r.IdRendicion = d.IDFACTURA
  LEFT JOIN dbo.imClientes cli ON cli.Valor = COALESCE(r.idCliente, v.CLIENTE)
  CROSS APPLY (
    SELECT NULLIF(LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(p.ValorSector)), ''), v.VALORSECTOR))), '') AS sectorId
  ) sx
  LEFT JOIN dbo.imSectores s ON s.Valor = sx.sectorId
  LEFT JOIN dbo.imServicios sv ON sv.Valor = s.ValorServicio
  LEFT JOIN dbo.imClasePaciente cp ON cp.Valor = v.CLASEPACIENTE
  LEFT JOIN dbo.imFunciones f ON f.Valor = pr.Funcion
  OUTER APPLY (
    SELECT TOP 1 x.ApellidoNombre, x.ValorEspecialidad
    FROM dbo.imPersonal x
    WHERE x.Matricula = pr.Matricula
    ORDER BY x.Valor
  ) pe
  LEFT JOIN dbo.imEspecialidad e ON e.Valor = pe.ValorEspecialidad
  WHERE p.FechaPractica BETWEEN ${pDesde} AND ${pHasta}
)`;

	const cond = [];
	const enLista = (columna, valores) => {
		if (valores.length) cond.push(`${columna} IN (${valores.map(p).join(', ')})`);
	};

	// Las condiciones de estado van aparte: la serie necesita ver todos los estados para mostrar
	// qué parte de cada período ya está valorizada, y recién después aplica este predicado.
	const estado = [];
	if (filtros.soloValorizadas) estado.push(`estado = 'V'`);
	if (filtros.liquidacion === 'liquidadas') estado.push(`estado = 'V' AND liquidado IS NOT NULL`);
	if (filtros.liquidacion === 'pendientes') estado.push(`estado = 'V' AND liquidado IS NULL`);
	const predicadoEstado = estado.length ? estado.map((c) => `(${c})`).join(' AND ') : '1 = 1';
	if (estado.length) cond.push(predicadoEstado);

	enLista('coberturaId', filtros.coberturas);
	enLista('matricula', filtros.profesionales);
	enLista('especialidadId', filtros.especialidades);
	enLista('servicioId', filtros.servicios);
	enLista('sectorId', filtros.sectores);
	enLista('claseId', filtros.clases);
	enLista('funcionId', filtros.funciones);
	enLista('rendicion', filtros.rendiciones);

	const sinEstado = cond.filter((c) => c !== predicadoEstado);
	return {
		con,
		donde: cond.length ? `WHERE ${cond.join(' AND ')}` : '',
		dondeSinEstado: sinEstado.length ? `WHERE ${sinEstado.join(' AND ')}` : '',
		predicadoEstado,
		params,
	};
}

/** Agregados comunes a resumen, serie y dimensiones. */
const METRICAS_SQL = `
    COUNT(DISTINCT practicaId) AS practicas,
    COUNT(*) AS prestaciones,
    COUNT(DISTINCT pacienteId) AS pacientes,
    SUM(CASE WHEN estado = 'V' THEN importe END) AS facturado,
    SUM(CASE WHEN estado = 'V' THEN liquidado END) AS liquidado`;

function _metricas(r) {
	return {
		practicas: _num(r.practicas),
		prestaciones: _num(r.prestaciones),
		pacientes: _num(r.pacientes),
		facturado: _importe(r.facturado) ?? 0,
		liquidado: _importe(r.liquidado) ?? 0,
	};
}

// ── Consultas ───────────────────────────────────────────────────────────────

async function _resumen(periodo, filtros, esquema) {
	const { con, donde, params } = construirConsulta(periodo, filtros, esquema);
	const filas = await executeQuery(
		`${con}
SELECT
    ${METRICAS_SQL},
    COUNT(DISTINCT visitaId) AS visitas,
    COUNT(DISTINCT matricula) AS profesionales,
    SUM(CASE WHEN estado = 'V' THEN 1 ELSE 0 END) AS prestValorizadas,
    SUM(CASE WHEN estado = 'V' AND liquidado IS NOT NULL THEN 1 ELSE 0 END) AS prestLiquidadas,
    COUNT(DISTINCT CASE WHEN estado = 'V' THEN practicaId END) AS practicasV,
    COUNT(DISTINCT CASE WHEN estado = 'S' THEN practicaId END) AS practicasS,
    COUNT(DISTINCT CASE WHEN estado = 'N' THEN practicaId END) AS practicasN,
    SUM(CASE WHEN estado = 'V' THEN 1 ELSE 0 END) AS prestV,
    SUM(CASE WHEN estado = 'S' THEN 1 ELSE 0 END) AS prestS,
    SUM(CASE WHEN estado = 'N' THEN 1 ELSE 0 END) AS prestN,
    SUM(CASE WHEN estado = 'N' THEN importe END) AS importeN,
    SUM(CASE WHEN sectorId IS NULL THEN 1 ELSE 0 END) AS sinSector,
    SUM(CASE WHEN especialidadId IS NULL THEN 1 ELSE 0 END) AS sinEspecialidad,
    SUM(CASE WHEN matricula IS NULL THEN 1 ELSE 0 END) AS sinProfesional
FROM b ${donde}`,
		params,
	);

	const r = filas?.[0] || {};
	const m = _metricas(r);
	const prestValorizadas = _num(r.prestValorizadas);
	const prestLiquidadas = _num(r.prestLiquidadas);

	return {
		...m,
		visitas: _num(r.visitas),
		profesionales: _num(r.profesionales),
		ticketPromedio: m.practicas > 0 && m.facturado > 0 ? _importe(m.facturado / m.practicas) : null,
		liquidadoPct: prestValorizadas > 0 ? Math.round((prestLiquidadas / prestValorizadas) * 1000) / 10 : null,
		porEstado: {
			valorizada: { practicas: _num(r.practicasV), prestaciones: _num(r.prestV), importe: m.facturado },
			sinValorizar: { practicas: _num(r.practicasS), prestaciones: _num(r.prestS), importe: 0 },
			noFacturable: {
				practicas: _num(r.practicasN),
				prestaciones: _num(r.prestN),
				importe: _importe(r.importeN) ?? 0,
			},
		},
		calidad: {
			sinSector: _num(r.sinSector),
			sinEspecialidad: _num(r.sinEspecialidad),
			sinProfesional: _num(r.sinProfesional),
			prestaciones: m.prestaciones,
		},
	};
}

async function _serie(periodo, filtros, esquema, granularidad) {
	const { con, dondeSinEstado, predicadoEstado: inc, params } = construirConsulta(periodo, filtros, esquema);
	const clave =
		granularidad === 'dia'
			? `CONVERT(VARCHAR(10), fecha, 23)`
			: granularidad === 'semana'
			  ? `CONVERT(VARCHAR(10), DATEADD(day, -(DATEDIFF(day, '19000101', fecha) % 7), fecha), 23)`
			  : `CONVERT(VARCHAR(7), fecha, 23)`;

	// Se trae cada período con todos sus estados: las medidas respetan el filtro de estado (`inc`),
	// y el desglose valorizada / sin valorizar / no facturable queda siempre disponible para
	// mostrar qué parte del período ya se valorizó.
	const filas = await executeQuery(
		`${con}, bs AS (SELECT *, ${clave} AS clave FROM b ${dondeSinEstado})
SELECT clave,
    COUNT(DISTINCT CASE WHEN ${inc} THEN practicaId END) AS practicas,
    SUM(CASE WHEN ${inc} THEN 1 ELSE 0 END) AS prestaciones,
    COUNT(DISTINCT CASE WHEN ${inc} THEN pacienteId END) AS pacientes,
    SUM(CASE WHEN (${inc}) AND estado = 'V' THEN importe END) AS facturado,
    SUM(CASE WHEN (${inc}) AND estado = 'V' THEN liquidado END) AS liquidado,
    COUNT(DISTINCT CASE WHEN estado = 'V' THEN practicaId END) AS practicasV,
    COUNT(DISTINCT CASE WHEN estado = 'S' THEN practicaId END) AS practicasS,
    COUNT(DISTINCT CASE WHEN estado = 'N' THEN practicaId END) AS practicasN
FROM bs
GROUP BY clave
ORDER BY clave`,
		params,
	);

	return (filas || []).map((r) => ({
		clave: String(r.clave),
		..._metricas(r),
		valorizacion: {
			valorizadas: _num(r.practicasV),
			sinValorizar: _num(r.practicasS),
			noFacturable: _num(r.practicasN),
		},
	}));
}

async function _dimension(nombre, periodo, filtros, esquema) {
	const dim = DIMENSIONES[nombre];
	const { con, donde, params } = construirConsulta(periodo, filtros, esquema);
	const filas = await executeQuery(
		`${con}
SELECT TOP ${MAX_FILAS_DIMENSION}
    ${dim.id} AS id,
    MAX(${dim.label}) AS label,
    ${METRICAS_SQL}
FROM b ${donde}
GROUP BY ${dim.id}
ORDER BY SUM(CASE WHEN estado = 'V' THEN importe END) DESC, COUNT(DISTINCT practicaId) DESC`,
		params,
	);

	return (filas || []).map((r) => ({
		id: r.id == null ? null : String(r.id).trim(),
		label: _txt(r.label) || dim.vacio,
		..._metricas(r),
	}));
}

/**
 * Top de prácticas. Agrupa por (práctica, tipo) y trae las más pedidas y las que
 * más facturan; las descripciones se buscan recién para ese puñado de códigos,
 * porque VUnionModuladasNomenclador es una vista y no conviene unirla al grueso.
 */
async function _topPracticas(periodo, filtros, esquema) {
	const { con, donde, params } = construirConsulta(periodo, filtros, esquema);
	const consulta = (orden) => `${con}
SELECT TOP ${MAX_FILAS_PRACTICAS}
    practica, tipoPractica, ${METRICAS_SQL}
FROM b ${donde}
GROUP BY practica, tipoPractica
ORDER BY ${orden}`;

	const [porCantidad, porImporte] = await Promise.all([
		executeQuery(consulta('COUNT(DISTINCT practicaId) DESC'), params),
		executeQuery(consulta('SUM(CASE WHEN estado = \'V\' THEN importe END) DESC'), params),
	]);

	const unicas = new Map();
	for (const r of [...(porCantidad || []), ...(porImporte || [])]) {
		const id = `${String(r.tipoPractica || '').trim()}:${r.practica}`;
		if (!unicas.has(id)) {
			unicas.set(id, {
				id,
				practica: r.practica,
				tipo: String(r.tipoPractica || '').trim(),
				..._metricas(r),
			});
		}
	}
	const lista = [...unicas.values()];
	if (!lista.length) return [];

	const pp = [];
	const cond = lista
		.map((it) => {
			pp.push({ value: it.practica }, { value: it.tipo });
			return `(IDPractica = @p${pp.length - 2} AND RTRIM(MOduladaONOmenclada) = @p${pp.length - 1})`;
		})
		.join(' OR ');

	let descripciones = new Map();
	try {
		const filasDesc = await executeQuery(
			`SELECT IDPractica, RTRIM(MOduladaONOmenclada) AS tipo, MAX(Descripcion) AS descripcion
			 FROM dbo.VUnionModuladasNomenclador
			 WHERE ${cond}
			 GROUP BY IDPractica, RTRIM(MOduladaONOmenclada)`,
			pp,
		);
		descripciones = new Map(
			(filasDesc || []).map((r) => [`${String(r.tipo || '').trim()}:${r.IDPractica}`, _txt(r.descripcion)]),
		);
	} catch (e) {
		// Sin nomenclador el ranking igual sirve: se muestra el código.
		console.warn('[produccionHospital] no se pudieron leer descripciones de prácticas:', e.message);
	}

	return lista.map((it) => ({
		id: it.id,
		label: descripciones.get(it.id) || `Práctica ${it.practica}`,
		codigo: it.practica,
		tipo: it.tipo,
		practicas: it.practicas,
		prestaciones: it.prestaciones,
		pacientes: it.pacientes,
		facturado: it.facturado,
		liquidado: it.liquidado,
	}));
}

// ── Comparación ─────────────────────────────────────────────────────────────

/** Variación porcentual; null si el período anterior no tiene base de comparación. */
function _variacionPct(actual, anterior) {
	if (!anterior) return null;
	return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

function _comparacion(actual, anterior, periodoPrevio) {
	return {
		periodo: { inicio: periodoPrevio.inicio, fin: periodoPrevio.fin },
		practicas: anterior.practicas,
		facturado: anterior.facturado,
		liquidado: anterior.liquidado,
		pacientes: anterior.pacientes,
		variacion: {
			practicas: _variacionPct(actual.practicas, anterior.practicas),
			facturado: _variacionPct(actual.facturado, anterior.facturado),
			liquidado: _variacionPct(actual.liquidado, anterior.liquidado),
			pacientes: _variacionPct(actual.pacientes, anterior.pacientes),
		},
	};
}

// ── API pública ─────────────────────────────────────────────────────────────

/** Analítica completa. Un solo payload: KPIs, serie, comparación y rankings por dimensión. */
async function obtenerProduccion(query) {
	const t0 = Date.now();
	const filtros = normalizarFiltros(query);
	const esquema = await esquemaTenant();
	const { periodo } = filtros;
	const previo = periodoAnterior(periodo);
	const granularidad = granularidadPara(periodo.dias);

	const [resumen, anterior, serie, practicas, ...dimensiones] = await Promise.all([
		_resumen(periodo, filtros, esquema),
		_resumen(previo, filtros, esquema),
		_serie(periodo, filtros, esquema, granularidad),
		_topPracticas(periodo, filtros, esquema),
		...Object.keys(DIMENSIONES).map((n) => _dimension(n, periodo, filtros, esquema)),
	]);

	const porDimension = {};
	Object.keys(DIMENSIONES).forEach((n, i) => {
		porDimension[n] = dimensiones[i];
	});

	return {
		periodo,
		filtros: {
			coberturas: filtros.coberturas,
			profesionales: filtros.profesionales,
			especialidades: filtros.especialidades,
			servicios: filtros.servicios,
			sectores: filtros.sectores,
			clases: filtros.clases,
			funciones: filtros.funciones,
			rendiciones: filtros.rendiciones,
			soloValorizadas: filtros.soloValorizadas,
			liquidacion: filtros.liquidacion,
		},
		liquidadoDisponible: esquema.liquidado,
		resumen,
		comparacion: _comparacion(resumen, anterior, previo),
		granularidad,
		serie,
		porCobertura: porDimension.cobertura,
		porProfesional: porDimension.profesional,
		porEspecialidad: porDimension.especialidad,
		porServicio: porDimension.servicio,
		porSector: porDimension.sector,
		porClase: porDimension.clase,
		porFuncion: porDimension.funcion,
		topPracticas: practicas,
		meta: { generadoEnMs: Date.now() - t0 },
	};
}

/**
 * Opciones para los selectores de filtro. Coberturas y profesionales salen del
 * período pedido (con todos los estados, para poder elegir también lo que aún no
 * se valorizó); el resto son catálogos completos.
 */
async function obtenerOpciones(query) {
	const filtros = normalizarFiltros({ ...query, soloValorizadas: false });
	const esquema = await esquemaTenant();
	const { periodo } = filtros;

	const [coberturas, profesionales, especialidades, servicios, sectores, clases, funciones] =
		await Promise.all([
			_dimension('cobertura', periodo, filtros, esquema),
			_dimension('profesional', periodo, filtros, esquema),
			executeQuery(`SELECT Valor AS id, RTRIM(Descripcion) AS label FROM dbo.imEspecialidad ORDER BY Descripcion`),
			executeQuery(`SELECT RTRIM(Valor) AS id, RTRIM(Descripcion) AS label FROM dbo.imServicios ORDER BY Descripcion`),
			executeQuery(
				`SELECT RTRIM(Valor) AS id, RTRIM(Descripcion) AS label, RTRIM(ValorServicio) AS servicioId, RTRIM(AmbInt) AS ambInt
				 FROM dbo.imSectores ORDER BY Descripcion`,
			),
			executeQuery(`SELECT RTRIM(Valor) AS id, RTRIM(Descripcion) AS label FROM dbo.imClasePaciente ORDER BY Descripcion`),
			executeQuery(`SELECT Valor AS id, RTRIM(Descripcion) AS label FROM dbo.imFunciones ORDER BY Valor`),
		]);

	const catalogo = (filas) =>
		(filas || []).map((r) => ({ id: String(r.id ?? '').trim(), label: _txt(r.label) || String(r.id ?? '') }));
	const conVolumen = (filas) =>
		filas
			.filter((r) => r.id != null)
			.sort((a, b) => b.practicas - a.practicas)
			.map((r) => ({ id: r.id, label: r.label, practicas: r.practicas }));

	return {
		periodo,
		coberturas: conVolumen(coberturas),
		profesionales: conVolumen(profesionales),
		especialidades: catalogo(especialidades),
		servicios: catalogo(servicios),
		sectores: (sectores || []).map((r) => ({
			id: String(r.id ?? '').trim(),
			label: _txt(r.label) || String(r.id ?? ''),
			servicioId: _txt(r.servicioId),
			ambInt: _txt(r.ambInt),
		})),
		clases: catalogo(clases),
		funciones: catalogo(funciones),
	};
}

/**
 * Mes en curso contra el mismo tramo del mes anterior (los mismos días
 * transcurridos): comparar un mes parcial con uno completo siempre daría
 * una caída falsa. Alimenta la card del panel de control.
 *
 * La comparación es sobre PRÁCTICAS de todos los estados, no sobre lo facturado:
 * la valorización se carga con demora (en el hospital de referencia agosto tenía
 * la mitad de lo valorizado que un mes normal), así que el importe del mes en curso
 * siempre parecería una caída. Se informa aparte qué porción ya está valorizada.
 */
async function obtenerResumenMes() {
	const esquema = await esquemaTenant();
	const hoy = fechaCalendarioArgentina();
	const { y, m, d } = _partesIso(hoy);
	const pad = (n) => String(n).padStart(2, '0');

	const actual = { inicio: `${y}-${pad(m)}-01`, fin: hoy };
	actual.dias = _diasInclusive(actual.inicio, actual.fin);

	const py = m === 1 ? y - 1 : y;
	const pm = m === 1 ? 12 : m - 1;
	const diasMesPrevio = new Date(Date.UTC(py, pm, 0)).getUTCDate();
	const previo = { inicio: `${py}-${pad(pm)}-01`, fin: `${py}-${pad(pm)}-${pad(Math.min(d, diasMesPrevio))}` };
	previo.dias = _diasInclusive(previo.inicio, previo.fin);

	const filtros = {
		coberturas: [],
		profesionales: [],
		especialidades: [],
		servicios: [],
		sectores: [],
		clases: [],
		funciones: [],
		rendiciones: [],
		soloValorizadas: false,
		liquidacion: 'todas',
	};

	// Mes de referencia: tres meses atrás, completo. Ya está asentado, así que muestra cuánto
	// se valoriza "normalmente" y permite leer el porcentaje del mes en curso sin adivinar.
	const refInicio = new Date(Date.UTC(y, m - 1 - 3, 1));
	const refFin = new Date(Date.UTC(y, m - 1 - 2, 0));
	const refIso = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
	const referencia = { inicio: refIso(refInicio), fin: refIso(refFin) };
	referencia.dias = _diasInclusive(referencia.inicio, referencia.fin);

	const [resumen, anterior, ref] = await Promise.all([
		_resumen(actual, filtros, esquema),
		_resumen(previo, filtros, esquema),
		_resumen(referencia, filtros, esquema),
	]);

	// Base: lo facturable (valorizado + pendiente de valorizar). Las coberturas no facturables
	// nunca se valorizan, y contarlas haría ver como "atrasado" un mes que no lo está.
	const pctValorizado = (r) => {
		const v = r.porEstado.valorizada.practicas;
		const base = v + r.porEstado.sinValorizar.practicas;
		return base > 0 ? Math.round((v / base) * 1000) / 10 : null;
	};

	return {
		mes: `${y}-${pad(m)}`,
		periodo: { inicio: actual.inicio, fin: actual.fin },
		practicas: resumen.practicas,
		practicasValorizadas: resumen.porEstado.valorizada.practicas,
		valorizadoPct: pctValorizado(resumen),
		referencia: { mes: refIso(refInicio).slice(0, 7), valorizadoPct: pctValorizado(ref) },
		facturado: resumen.facturado,
		liquidado: resumen.liquidado,
		liquidadoDisponible: esquema.liquidado,
		variacionPracticas: _variacionPct(resumen.practicas, anterior.practicas),
	};
}

module.exports = {
	obtenerProduccion,
	obtenerOpciones,
	obtenerResumenMes,
	// Expuestos para tests
	normalizarFiltros,
	periodoAnterior,
	granularidadPara,
	construirConsulta,
	DIMENSIONES,
};
