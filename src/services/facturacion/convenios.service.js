/**
 * Convenios con obras sociales: cabecera (imClientesConvenios) y sus tablas de
 * detalle. Ver docs/FACTURACION_CONVENIOS.md.
 *
 * Los triggers de imClientesConvNomenc / imClientesConvModuladas reconstruyen
 * ~12.500 filas de imPracticasXConvenios por cada convenio tocado, y se disparan
 * una vez por SENTENCIA. Por eso toda escritura del detalle es set-based: se
 * cargan los cambios en una tabla temporal y se aplica un DELETE, un UPDATE y un
 * INSERT por pestaña, nunca fila por fila.
 */
const { executeQuery, getRequestPool, sql } = require('../../models/db');
const { getTenantId } = require('../../context/tenantContext');
const { sanitizarTextoParaBd } = require('../../utils/clarionText');
const { fechaClarionHoyArgentina } = require('../../utils/dateUtils');
const auditoria = require('../auditoria.service');
const { contarUsosConvenio } = require('./referenciasConvenio');
const def = require('./conveniosDefinicion');

const { PESTANAS, IDS_PESTANAS, CABECERA, errorHttp, pestanaPorId } = def;

const TAM_PAGINA = 100;
const MAX_TAM_PAGINA = 500;
const MAX_FILAS_EXPORTAR = 50000;
const MODULO_AUDITORIA = 'FACTURACION';

/** Funciones que se usan en los datos pero no están en imFunciones (a confirmar con facturación). */
const FUNCIONES_SIN_CATALOGO = [7, 8];

// ─── Utilidades ────────────────────────────────────────────────────────────

function tipoMssql(c) {
	switch (c.sqlType) {
		case 'Int':
			return sql.Int;
		case 'TinyInt':
			return sql.TinyInt;
		case 'SmallInt':
			return sql.SmallInt;
		case 'Bit':
			return sql.Bit;
		case 'Money':
			return sql.Money;
		case 'Real':
			return sql.Real;
		case 'Decimal':
			return sql.Decimal(c.precision, c.scale);
		case 'Char':
			return sql.Char(c.length);
		case 'VarChar':
			return sql.VarChar(c.length);
		default:
			throw new Error(`Tipo SQL no soportado: ${c.sqlType}`);
	}
}

function valorSeguro(v) {
	return typeof v === 'string' ? sanitizarTextoParaBd(v) : v;
}

/** Arma parámetros posicionales @pN para executeQuery. */
function parametros() {
	const lista = [];
	return {
		lista,
		p(value, type) {
			lista.push(type ? { value, type } : { value });
			return `@p${lista.length - 1}`;
		},
	};
}

function entero(v, nombre = 'valor') {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 0) throw errorHttp(`${nombre} inválido`);
	return n;
}

function paginaDe(query, porDefecto = TAM_PAGINA) {
	const pagina = Math.max(1, parseInt(query?.pagina, 10) || 1);
	const tamPagina = Math.min(MAX_TAM_PAGINA, Math.max(1, parseInt(query?.tamPagina, 10) || porDefecto));
	return { pagina, tamPagina, offset: (pagina - 1) * tamPagina };
}

async function enTransaccion(fn) {
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const r = await fn(tx);
		await tx.commit();
		return r;
	} catch (e) {
		try {
			await tx.rollback();
		} catch {
			/* la transacción ya se abortó del lado del servidor */
		}
		throw e;
	}
}

function registrar(ctx, accion, idEntidad, detalle) {
	return auditoria.registrarSeguro({
		idEmpresa: Number(getTenantId()) || 0,
		modulo: MODULO_AUDITORIA,
		entidad: 'CONVENIO',
		idEntidad,
		accion,
		actor: ctx?.actor,
		ip: ctx?.ip,
		detalle,
	});
}

// ─── Catálogos ─────────────────────────────────────────────────────────────

async function catalogos() {
	const [clientes, letras, funciones, categorias] = await Promise.all([
		executeQuery(`SELECT Valor, RTRIM(RazonSocial) AS RazonSocial FROM dbo.imClientes ORDER BY RazonSocial`),
		executeQuery(`SELECT RTRIM(Valor) AS Valor, RTRIM(Descripcion) AS Descripcion FROM dbo.imClienteConvLetra ORDER BY Valor`),
		executeQuery(`SELECT Valor, RTRIM(Descripcion) AS Descripcion FROM dbo.imFunciones ORDER BY Valor`),
		executeQuery(`SELECT Valor, RTRIM(Descripcion) AS Descripcion, Porcentaje FROM dbo.imCategorias ORDER BY Valor`),
	]);
	const listaFunciones = funciones.map((f) => ({ valor: Number(f.Valor), descripcion: f.Descripcion, enCatalogo: true }));
	for (const n of FUNCIONES_SIN_CATALOGO) {
		if (!listaFunciones.some((f) => f.valor === n)) {
			listaFunciones.push({ valor: n, descripcion: `Función ${n} (sin descripción)`, enCatalogo: false });
		}
	}
	listaFunciones.sort((a, b) => a.valor - b.valor);
	return {
		obrasSociales: [
			{ valor: 0, razonSocial: 'Convenio general (sin obra social)' },
			...clientes.map((c) => ({ valor: Number(c.Valor), razonSocial: c.RazonSocial })),
		],
		letras: letras.map((l) => ({ valor: l.Valor, descripcion: l.Descripcion })),
		funciones: listaFunciones,
		categorias: categorias.map((c) => ({ valor: Number(c.Valor), descripcion: c.Descripcion, porcentaje: c.Porcentaje })),
		complejidades: Array.from({ length: 10 }, (_, i) => i + 1),
		pestanas: IDS_PESTANAS.map((id) => {
			const p = PESTANAS[id];
			return {
				id,
				titulo: p.titulo,
				paginada: p.paginada,
				filtroFuncion: Boolean(p.filtroFuncion),
				catalogo: p.catalogo ? p.catalogo.tabla : null,
				ajustables: p.ajustables,
				ajusteSoloFijos: p.ajusteSoloFijos,
				columnas: p.columnas.map((c) => ({
					name: c.name,
					label: c.label,
					kind: c.kind,
					sqlType: c.sqlType,
					length: c.length,
					required: c.required,
					defecto: c.defecto,
					min: c.min,
					max: c.max,
					scale: c.scale,
					oculta: c.oculta || undefined,
				})),
			};
		}),
	};
}

async function catalogosValidacion() {
	const [letras, funciones, categorias] = await Promise.all([
		executeQuery(`SELECT RTRIM(Valor) AS Valor FROM dbo.imClienteConvLetra`),
		executeQuery(`SELECT Valor FROM dbo.imFunciones`),
		executeQuery(`SELECT Valor FROM dbo.imCategorias`),
	]);
	return {
		letras: new Set(letras.map((l) => String(l.Valor).trim())),
		funciones: new Set([...funciones.map((f) => Number(f.Valor)), ...FUNCIONES_SIN_CATALOGO]),
		categorias: new Set(categorias.map((c) => Number(c.Valor))),
	};
}

async function existeObraSocial(valor) {
	if (valor === 0) return true;
	const r = await executeQuery(`SELECT 1 AS ok FROM dbo.imClientes WHERE Valor = @p0`, [{ value: valor, type: 'Int' }]);
	return r.length > 0;
}

/** Búsqueda en Nomenclador, Moduladas o Vademécum para dar de alta filas. */
async function buscarEnCatalogo(tipo, termino) {
	const q = String(termino || '').trim();
	if (q.length < 2 && !/^\d+$/.test(q)) return [];
	const numero = /^\d+$/.test(q) ? Number(q) : null;
	const like = `%${q.replace(/[[\]%_]/g, (m) => `[${m}]`)}%`;

	if (tipo === 'nomenclador' || tipo === 'moduladas') {
		const tabla = tipo === 'nomenclador' ? 'imNomenclador' : 'imModuladas';
		const filas = await executeQuery(
			`SELECT TOP 25 IDPractica, RTRIM(Descripcion) AS Descripcion, Letra, Tipo
			 FROM dbo.${tabla}
			 WHERE ${numero !== null ? 'IDPractica = @p0 OR CAST(IDPractica AS varchar(12)) LIKE @p1 OR ' : ''}Descripcion LIKE @p2
			 ORDER BY CASE WHEN IDPractica = @p0 THEN 0 ELSE 1 END, IDPractica`,
			[
				{ value: numero ?? -1, type: 'Int' },
				{ value: `${q}%`, type: 'VarChar', length: 20 },
				{ value: like, type: 'VarChar', length: 300 },
			],
		);
		return filas.map((f) => ({
			codigo: Number(f.IDPractica),
			descripcion: f.Descripcion,
			detalle: [f.Letra && `Letra ${String(f.Letra).trim()}`, f.Tipo && String(f.Tipo).trim() && `Tipo ${String(f.Tipo).trim()}`]
				.filter(Boolean)
				.join(' · '),
		}));
	}
	if (tipo === 'vademecum') {
		const filas = await executeQuery(
			`SELECT TOP 25 Troquel, RTRIM(Nombre) AS Nombre, RTRIM(Presentacion) AS Presentacion, RTRIM(Laboratorio) AS Laboratorio
			 FROM dbo.imVademecum
			 WHERE ${numero !== null ? 'Troquel = @p0 OR ' : ''}Nombre LIKE @p1 OR Descripcion LIKE @p1
			 ORDER BY CASE WHEN Troquel = @p0 THEN 0 ELSE 1 END, Nombre`,
			[
				{ value: numero ?? -1, type: 'Int' },
				{ value: like, type: 'VarChar', length: 100 },
			],
		);
		return filas.map((f) => ({
			codigo: Number(f.Troquel),
			descripcion: [f.Nombre, f.Presentacion].filter(Boolean).join(' - '),
			detalle: f.Laboratorio || '',
		}));
	}
	throw errorHttp('Catálogo desconocido', 404);
}

// ─── Cabecera: listado y detalle ───────────────────────────────────────────

const ESTADOS = ['vigente', 'futuro', 'vencido', 'sin_vigencia'];

function subconsultasConteo(alias = 'c') {
	return IDS_PESTANAS.map(
		(id) =>
			`(SELECT COUNT(*) FROM dbo.${PESTANAS[id].tabla} x WHERE x.ValorConvenio = ${alias}.Codigo${def.filtroPestana(PESTANAS[id], 'x')}) AS cnt_${id}`,
	).join(',\n\t\t\t');
}

function conteosDeFila(f) {
	const out = {};
	for (const id of IDS_PESTANAS) out[id] = Number(f[`cnt_${id}`]) || 0;
	return out;
}

function cabeceraListado(f) {
	return {
		codigo: Number(f.Codigo),
		descripcion: String(f.Descripcion || '').trim(),
		obraSocial: { valor: Number(f.Valor), razonSocial: f.RazonSocial ? String(f.RazonSocial).trim() : null },
		vigenciaDesde: def.cabeceraApi(f).VigenciaDesde,
		vigenciaHasta: def.cabeceraApi(f).VigenciaHasta,
		estado: f.Estado,
		multiConvenio: f.MultiConvenio === true || f.MultiConvenio === 1,
	};
}

/**
 * Listado paginado. `resumen` cuenta por estado con los mismos filtros salvo el
 * de estado (para los indicadores de arriba).
 */
async function listar(query = {}) {
	const { pagina, tamPagina, offset } = paginaDe(query, 50);
	const prm = parametros();
	const hoy = prm.p(fechaClarionHoyArgentina(), 'Int');
	const filtros = [];

	if (query.obraSocial !== undefined && query.obraSocial !== '') {
		filtros.push(`c.Valor = ${prm.p(entero(query.obraSocial, 'Obra social'), 'Int')}`);
	}
	const q = String(query.q || '').trim();
	if (q) {
		const like = prm.p(`%${q.replace(/[[\]%_]/g, (m) => `[${m}]`)}%`, 'VarChar');
		const porCodigo = /^\d+$/.test(q) ? `c.Codigo = ${prm.p(Number(q), 'Int')} OR ` : '';
		filtros.push(`(${porCodigo}c.Descripcion LIKE ${like} OR cli.RazonSocial LIKE ${like})`);
	}
	const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
	const estadoSql = def.SQL_ESTADO_VIGENCIA.replace(/@hoy/g, hoy);
	const estado = ESTADOS.includes(query.estado) ? query.estado : null;
	const filtroEstado = estado ? `WHERE b.Estado = '${estado}'` : '';

	const base = `
		WITH base AS (
			SELECT c.Codigo, c.Valor, c.Descripcion, c.VigenciaDesde, c.VigenciaHasta, c.MultiConvenio,
			       RTRIM(cli.RazonSocial) AS RazonSocial, ${estadoSql} AS Estado
			FROM dbo.imClientesConvenios c
			LEFT JOIN dbo.imClientes cli ON cli.Valor = c.Valor
			${where}
		)`;

	const [filas, resumen] = await Promise.all([
		executeQuery(
			`${base}
			SELECT b.*, COUNT(*) OVER () AS TotalFilas, ${subconsultasConteo('b')}
			FROM base b ${filtroEstado}
			ORDER BY b.Codigo DESC
			OFFSET ${offset} ROWS FETCH NEXT ${tamPagina} ROWS ONLY`,
			prm.lista,
		),
		executeQuery(`${base} SELECT b.Estado, COUNT(*) AS n FROM base b GROUP BY b.Estado`, prm.lista),
	]);

	const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
	for (const r of resumen) porEstado[r.Estado] = Number(r.n) || 0;
	const totalSinEstado = ESTADOS.reduce((a, e) => a + porEstado[e], 0);

	return {
		filas: filas.map((f) => ({ ...cabeceraListado(f), conteos: conteosDeFila(f) })),
		total: filas.length ? Number(filas[0].TotalFilas) : 0,
		pagina,
		tamPagina,
		resumen: { total: totalSinEstado, ...porEstado },
	};
}

async function filaCabecera(codigo) {
	const filas = await executeQuery(
		`SELECT c.*, RTRIM(cli.RazonSocial) AS RazonSocial, ${def.SQL_ESTADO_VIGENCIA.replace(/@hoy/g, '@p1')} AS Estado,
		        ${subconsultasConteo('c')}
		 FROM dbo.imClientesConvenios c
		 LEFT JOIN dbo.imClientes cli ON cli.Valor = c.Valor
		 WHERE c.Codigo = @p0`,
		[
			{ value: codigo, type: 'Int' },
			{ value: fechaClarionHoyArgentina(), type: 'Int' },
		],
	);
	if (!filas.length) throw errorHttp('El convenio no existe', 404);
	return filas[0];
}

async function obtener(codigoCrudo) {
	const codigo = entero(codigoCrudo, 'Convenio');
	const f = await filaCabecera(codigo);
	return {
		...cabeceraListado(f),
		cabecera: def.cabeceraApi(f),
		conteos: conteosDeFila(f),
	};
}

async function uso(codigoCrudo) {
	const codigo = entero(codigoCrudo, 'Convenio');
	await filaCabecera(codigo);
	return contarUsosConvenio(codigo);
}

// ─── Cabecera: alta y edición ──────────────────────────────────────────────

async function crear(body, ctx) {
	const valores = def.normalizarCabecera(body);
	if (!(await existeObraSocial(valores.Valor))) throw errorHttp('La obra social no existe');

	const pool = await getRequestPool();
	const req = pool.request();
	for (const c of CABECERA) req.input(c.name, tipoMssql(c), valorSeguro(valores[c.name]));
	const r = await req.query(
		`INSERT INTO dbo.imClientesConvenios (${CABECERA.map((c) => c.name).join(', ')})
		 VALUES (${CABECERA.map((c) => `@${c.name}`).join(', ')});
		 SELECT CONVERT(int, SCOPE_IDENTITY()) AS Codigo;`,
	);
	const codigo = Number(r.recordset?.[0]?.Codigo);
	await registrar(ctx, 'CREAR', codigo, { despues: valores });
	return obtener(codigo);
}

async function actualizar(codigoCrudo, body, ctx) {
	const codigo = entero(codigoCrudo, 'Convenio');
	const antes = def.cabeceraApi(await filaCabecera(codigo));
	const valores = def.normalizarCabecera(body);
	if (!(await existeObraSocial(valores.Valor))) throw errorHttp('La obra social no existe');

	const pool = await getRequestPool();
	const req = pool.request();
	req.input('Codigo', sql.Int, codigo);
	for (const c of CABECERA) req.input(c.name, tipoMssql(c), valorSeguro(valores[c.name]));
	await req.query(
		`UPDATE dbo.imClientesConvenios SET ${CABECERA.map((c) => `${c.name} = @${c.name}`).join(', ')}
		 WHERE Codigo = @Codigo`,
	);
	await registrar(ctx, 'EDITAR', codigo, { antes, despues: valores });
	return obtener(codigo);
}

// ─── Detalle: lectura ──────────────────────────────────────────────────────

function joinCatalogo(p) {
	if (!p.catalogo) return '';
	if (p.id === 'vademecum') {
		return `OUTER APPLY (SELECT TOP 1 v.Troquel AS catId, RTRIM(v.Nombre) AS catNombre, RTRIM(v.Presentacion) AS catPresentacion
		                     FROM dbo.imVademecum v WHERE v.Troquel = t.Troquel) cat`;
	}
	return `OUTER APPLY (SELECT TOP 1 x.IDPractica AS catId, RTRIM(x.Descripcion) AS catDescripcion
	                     FROM dbo.${p.catalogo.tabla} x WHERE x.IDPractica = t.Desde) cat`;
}

function catalogoDeFila(p, f) {
	if (!p.catalogo) return undefined;
	if (p.id === 'vademecum') {
		return { existe: f.catId != null, descripcion: [f.catNombre, f.catPresentacion].filter(Boolean).join(' - ') || null };
	}
	return { existe: f.catId != null, descripcion: f.catDescripcion || null };
}

async function listarPestana(codigoCrudo, pestanaId, query = {}, { sinLimite = false } = {}) {
	const codigo = entero(codigoCrudo, 'Convenio');
	const p = pestanaPorId(pestanaId);
	const prm = parametros();
	const conv = prm.p(codigo, 'Int');
	const filtros = [`t.ValorConvenio = ${conv}`];
	if (p.filtro) filtros.push(p.filtro);

	const q = String(query.q || '').trim();
	const conRango = Boolean(def.columna(p, 'Desde'));
	if (q && p.paginada) {
		if (/^\d+$/.test(q) && (conRango || p.id === 'vademecum')) {
			const n = prm.p(Number(q), 'Int');
			filtros.push(conRango ? `(t.Desde = ${n} OR (t.Desde <= ${n} AND t.Hasta >= ${n}))` : `t.Troquel = ${n}`);
		} else {
			const like = prm.p(`%${q.replace(/[[\]%_]/g, (m) => `[${m}]`)}%`, 'VarChar');
			const enCatalogo = !p.catalogo ? null : p.id === 'vademecum' ? 'cat.catNombre' : 'cat.catDescripcion';
			filtros.push(enCatalogo ? `(t.Descripcion LIKE ${like} OR ${enCatalogo} LIKE ${like})` : `t.Descripcion LIKE ${like}`);
		}
	}
	if (p.filtroFuncion && query.funcion !== undefined && query.funcion !== '') {
		filtros.push(`t.Funcion = ${prm.p(entero(query.funcion, 'Función'), 'TinyInt')}`);
	}

	const desde = `FROM dbo.${p.tabla} t ${joinCatalogo(p)} WHERE ${filtros.join(' AND ')}`;
	const { pagina, tamPagina, offset } = p.paginada && !sinLimite ? paginaDe(query) : { pagina: 1, tamPagina: MAX_FILAS_EXPORTAR, offset: 0 };
	const columnasSelect = [
		...(p.identidad ? [`t.${p.identidad}`] : []),
		...p.columnas.map((c) => `t.${c.name}`),
		...(p.catalogo ? ['cat.*'] : []),
	].join(', ');

	const consultas = [
		executeQuery(
			`SELECT ${columnasSelect}, COUNT(*) OVER () AS TotalFilas ${desde}
			 ORDER BY ${p.orden}
			 OFFSET ${offset} ROWS FETCH NEXT ${tamPagina} ROWS ONLY`,
			prm.lista,
		),
	];
	if (p.filtroFuncion) {
		consultas.push(
			executeQuery(
				`SELECT t.Funcion, COUNT(*) AS n FROM dbo.${p.tabla} t WHERE t.ValorConvenio = @p0 GROUP BY t.Funcion ORDER BY t.Funcion`,
				[{ value: codigo, type: 'Int' }],
			),
		);
	}
	const [filas, porFuncion] = await Promise.all(consultas);

	return {
		pestana: p.id,
		filas: filas.map((f) => {
			const fila = def.filaApi(p, f);
			const cat = catalogoDeFila(p, f);
			if (cat) fila._catalogo = cat;
			return fila;
		}),
		total: filas.length ? Number(filas[0].TotalFilas) : 0,
		pagina,
		tamPagina,
		porFuncion: porFuncion ? porFuncion.map((r) => ({ funcion: r.Funcion == null ? null : Number(r.Funcion), cantidad: Number(r.n) })) : undefined,
	};
}

// ─── Detalle: guardado en lote ─────────────────────────────────────────────

const TEMP = '#convLote';

function columnasTemp(p) {
	const claves = p.identidad ? [{ name: `o_${p.identidad}`, sql: 'int' }] : p.clave.map((k) => ({ name: `o_${k}`, sql: def.tipoSqlTexto(def.columna(p, k)) }));
	return [
		{ name: 'Op', sql: 'char(1) NOT NULL' },
		{ name: 'Fila', sql: 'int NOT NULL' },
		...claves,
		...p.columnas.map((c) => ({ name: c.name, sql: def.tipoSqlTexto(c) })),
	];
}

const igualNull = (a, b) => `(${a} = ${b} OR (${a} IS NULL AND ${b} IS NULL))`;

function condicionFilaOriginal(p) {
	if (p.identidad) return `t.${p.identidad} = l.o_${p.identidad}`;
	return p.clave.map((k) => igualNull(`t.${k}`, `l.o_${k}`)).join(' AND ');
}

/** Descripción vacía en prácticas: se completa con la del catálogo. */
function expresionColumna(p, c) {
	if (c.name === 'Descripcion' && p.catalogo && p.id !== 'vademecum') {
		return `COALESCE(NULLIF(LTRIM(RTRIM(l.Descripcion)), ''), cat.catDescripcion, '')`;
	}
	return `l.${c.name}`;
}

function joinCatalogoLote(p) {
	if (!p.catalogo || p.id === 'vademecum') return '';
	return `OUTER APPLY (SELECT TOP 1 RTRIM(x.Descripcion) AS catDescripcion FROM dbo.${p.catalogo.tabla} x WHERE x.IDPractica = l.Desde) cat`;
}

async function cargarTemp(tx, p, plan) {
	const cols = columnasTemp(p);
	await new sql.Request(tx).batch(
		`IF OBJECT_ID('tempdb..${TEMP}') IS NOT NULL DROP TABLE ${TEMP};
		 CREATE TABLE ${TEMP} (${cols.map((c) => `[${c.name}] ${c.sql}`).join(', ')});`,
	);

	const filas = [
		...plan.bajas.map((clave, i) => ({ op: 'B', fila: i, clave, valores: {} })),
		...plan.cambios.map((c, i) => ({ op: 'M', fila: i, clave: c.clave, valores: c.valores })),
		...plan.altas.map((v, i) => ({ op: 'A', fila: i, clave: {}, valores: v })),
	];
	const claves = p.identidad ? [p.identidad] : p.clave;
	const colsClave = claves.map((k) => (p.identidad ? { name: k, sqlType: 'Int' } : def.columna(p, k)));

	for (const tanda of def.enTandas(filas, cols.length)) {
		const req = new sql.Request(tx);
		const tuplas = tanda.map((f, j) => {
			const ph = [];
			req.input(`op${j}`, sql.Char(1), f.op);
			req.input(`fi${j}`, sql.Int, f.fila);
			ph.push(`@op${j}`, `@fi${j}`);
			colsClave.forEach((c, k) => {
				req.input(`k${k}_${j}`, tipoMssql(c), valorSeguro(f.clave[c.name] ?? null));
				ph.push(`@k${k}_${j}`);
			});
			p.columnas.forEach((c, k) => {
				const v = f.op === 'B' ? null : valorSeguro(f.valores[c.name] ?? null);
				req.input(`c${k}_${j}`, tipoMssql(c), v);
				ph.push(`@c${k}_${j}`);
			});
			return `(${ph.join(', ')})`;
		});
		await req.query(`INSERT INTO ${TEMP} (${cols.map((c) => `[${c.name}]`).join(', ')}) VALUES ${tuplas.join(',\n')}`);
	}
}

async function controlarDuplicados(tx, p, codigo) {
	const req = new sql.Request(tx);
	req.input('conv', sql.Int, codigo);
	const r = await req.query(
		`SELECT TOP 3 ${p.unica.map((k) => `t.${k}`).join(', ')}, COUNT(*) AS n
		 FROM dbo.${p.tabla} t
		 WHERE t.ValorConvenio = @conv${def.filtroPestana(p)}
		   AND EXISTS (SELECT 1 FROM ${TEMP} l WHERE l.Op IN ('A', 'M') AND ${p.unica.map((k) => igualNull(`t.${k}`, `l.${k}`)).join(' AND ')})
		 GROUP BY ${p.unica.map((k) => `t.${k}`).join(', ')}
		 HAVING COUNT(*) > 1`,
	);
	if (r.recordset.length) {
		const ejemplos = r.recordset.map((f) => def.describirClave(p, f));
		throw errorHttp(`Ya existe otra fila con ${ejemplos[0]}`, 409, { detalles: ejemplos });
	}
}

/**
 * Aplica { altas, cambios, bajas } de una pestaña en una transacción.
 * `cambios` y `bajas` usan el `_id` que devolvió el listado.
 */
async function guardarLote(codigoCrudo, pestanaId, lote, ctx) {
	const codigo = entero(codigoCrudo, 'Convenio');
	const p = pestanaPorId(pestanaId);
	await filaCabecera(codigo);
	const plan = def.planificarLote(p, lote, await catalogosValidacion());

	const resultado = await enTransaccion(async (tx) => {
		await cargarTemp(tx, p, plan);
		const cond = condicionFilaOriginal(p);
		const run = async (texto) => {
			const req = new sql.Request(tx);
			req.input('conv', sql.Int, codigo);
			try {
				const r = await req.query(texto);
				return r.rowsAffected?.[0] || 0;
			} catch (e) {
				// Índice único de la base (p. ej. una fila por categoría en imClientesConvCateg).
				if (e?.number === 2601 || e?.number === 2627) {
					const campos = p.unica.map((k) => def.columna(p, k).label).join(', ');
					throw errorHttp(`Ya existe otra fila con el mismo valor de ${campos}`, 409);
				}
				throw e;
			}
		};
		const cambiada = 'Los datos cambiaron mientras editabas (otra persona o pestaña). Recargá y volvé a aplicar los cambios.';

		let bajas = 0;
		if (plan.bajas.length) {
			bajas = await run(
				`DELETE t FROM dbo.${p.tabla} t INNER JOIN ${TEMP} l ON l.Op = 'B' AND ${cond} WHERE t.ValorConvenio = @conv${def.filtroPestana(p)}`,
			);
			if (bajas !== plan.bajas.length) throw errorHttp(cambiada, 409);
		}

		let cambios = 0;
		if (plan.cambios.length) {
			cambios = await run(
				`UPDATE t SET ${p.columnas.map((c) => `${c.name} = ${expresionColumna(p, c)}`).join(', ')}
				 FROM dbo.${p.tabla} t INNER JOIN ${TEMP} l ON l.Op = 'M' AND ${cond}
				 ${joinCatalogoLote(p)}
				 WHERE t.ValorConvenio = @conv${def.filtroPestana(p)}`,
			);
			if (cambios !== plan.cambios.length) throw errorHttp(cambiada, 409);
		}

		let altas = 0;
		if (plan.altas.length) {
			altas = await run(
				`INSERT INTO dbo.${p.tabla} (ValorConvenio, ${p.columnas.map((c) => c.name).join(', ')})
				 SELECT @conv, ${p.columnas.map((c) => expresionColumna(p, c)).join(', ')}
				 FROM ${TEMP} l ${joinCatalogoLote(p)}
				 WHERE l.Op = 'A' ORDER BY l.Fila`,
			);
		}

		if (plan.altas.length || plan.cambios.length) await controlarDuplicados(tx, p, codigo);
		await new sql.Request(tx).batch(`DROP TABLE ${TEMP}`);
		return { altas, cambios, bajas };
	});

	await registrar(ctx, 'EDITAR_DETALLE', codigo, {
		pestana: p.id,
		...resultado,
		bajas_ids: lote?.bajas?.slice(0, 50),
		cambios_muestra: plan.cambios.slice(0, 20).map((c) => ({ clave: c.clave, valores: c.valores })),
		altas_muestra: plan.altas.slice(0, 20),
	});
	return resultado;
}

// ─── Ajuste masivo por porcentaje ──────────────────────────────────────────

/** WHERE y descripción de lo que toca el ajuste en una pestaña (o null si no aplica). */
function alcanceAjuste(p, aj, prm) {
	const conFiltros = aj.funcion !== null || aj.desde !== null || aj.hasta !== null;
	if (conFiltros && !p.filtroFuncion) return null;
	const filtros = p.filtro ? [p.filtro] : [];
	if (p.ajusteSoloFijos) filtros.push(`t.TipoValor = '$'`);
	if (aj.funcion !== null) filtros.push(`t.Funcion = ${prm.p(aj.funcion, 'TinyInt')}`);
	if (aj.desde !== null) filtros.push(`t.Desde >= ${prm.p(aj.desde, 'Int')}`);
	if (aj.hasta !== null) filtros.push(`t.Desde <= ${prm.p(aj.hasta, 'Int')}`);
	return filtros;
}

function expresionAjustada(c, factor) {
	return `ROUND(t.${c} * ${factor}, 2)`;
}

/** Cuántas filas se modifican, cuántas desbordan el tipo de la columna y una muestra. */
async function previsualizarAjuste(codigoCrudo, body) {
	const codigo = entero(codigoCrudo, 'Convenio');
	await filaCabecera(codigo);
	const aj = def.normalizarAjuste(body);
	const salida = [];

	for (const id of aj.pestanas) {
		const p = pestanaPorId(id);
		const prm = parametros();
		const conv = prm.p(codigo, 'Int');
		const factor = prm.p(aj.factor, 'Float');
		const filtros = alcanceAjuste(p, aj, prm);
		if (!filtros) {
			salida.push({ pestana: p.id, titulo: p.titulo, aplica: false, filas: 0, desbordan: 0, muestra: [] });
			continue;
		}
		const where = [`t.ValorConvenio = ${conv}`, ...filtros].join(' AND ');
		const desbordes = p.ajustables
			.map((n) => def.columna(p, n))
			.filter((c) => c.sqlType === 'Decimal')
			.map((c) => `ABS(${expresionAjustada(c.name, factor)}) >= ${10 ** (c.precision - c.scale)}`);
		const principal = p.ajustables[0];
		const etiqueta = {
			valores: 't.ValorLetra',
			complejidad: 't.Complejidad',
			categorias: 't.ValorCategoria',
			vademecum: 't.Troquel',
			genericos: 't.Descripcion',
		}[p.id] || 't.Desde';

		const [conteo, muestra] = await Promise.all([
			executeQuery(
				`SELECT COUNT(*) AS n, SUM(CASE WHEN ${desbordes.length ? desbordes.join(' OR ') : '1 = 0'} THEN 1 ELSE 0 END) AS desbordan
				 FROM dbo.${p.tabla} t WHERE ${where}`,
				prm.lista,
			),
			executeQuery(
				`SELECT TOP 5 ${etiqueta} AS ref, t.${principal} AS antes, ${expresionAjustada(principal, factor)} AS despues
				 FROM dbo.${p.tabla} t WHERE ${where} AND t.${principal} IS NOT NULL AND t.${principal} <> 0
				 ORDER BY t.${principal} DESC`,
				prm.lista,
			),
		]);
		salida.push({
			pestana: p.id,
			titulo: p.titulo,
			aplica: true,
			columnas: p.ajustables,
			filas: Number(conteo[0]?.n) || 0,
			desbordan: Number(conteo[0]?.desbordan) || 0,
			muestra: muestra.map((m) => ({ referencia: String(m.ref).trim(), antes: Number(m.antes), despues: Number(m.despues) })),
		});
	}
	return { porcentaje: aj.porcentaje, pestanas: salida };
}

async function ejecutarAjuste(tx, codigo, aj) {
	const resultado = [];
	for (const id of aj.pestanas) {
		const p = pestanaPorId(id);
		const prm = parametros();
		const filtros = alcanceAjuste(p, aj, prm);
		if (!filtros) continue;
		const req = new sql.Request(tx);
		req.input('conv', sql.Int, codigo);
		req.input('factor', sql.Float, aj.factor);
		prm.lista.forEach((x, i) => req.input(`p${i}`, sql[x.type], x.value));
		const r = await req.query(
			`UPDATE t SET ${p.ajustables.map((c) => `${c} = ${expresionAjustada(c, '@factor')}`).join(', ')}
			 FROM dbo.${p.tabla} t WHERE ${['t.ValorConvenio = @conv', ...filtros].join(' AND ')}`,
		);
		resultado.push({ pestana: p.id, filas: r.rowsAffected?.[0] || 0 });
	}
	return resultado;
}

async function aplicarAjuste(codigoCrudo, body, ctx) {
	const codigo = entero(codigoCrudo, 'Convenio');
	const previa = await previsualizarAjuste(codigo, body);
	const conDesborde = previa.pestanas.filter((x) => x.desbordan > 0);
	if (conDesborde.length) {
		throw errorHttp(
			`El ajuste deja valores fuera de rango en ${conDesborde.map((x) => `${x.titulo} (${x.desbordan} filas)`).join(', ')}`,
		);
	}
	const aj = def.normalizarAjuste(body);
	const resultado = await enTransaccion((tx) => ejecutarAjuste(tx, codigo, aj));
	await registrar(ctx, 'AJUSTE_PORCENTAJE', codigo, { ajuste: aj, resultado });
	return { porcentaje: aj.porcentaje, pestanas: resultado };
}

// ─── Duplicar convenio ─────────────────────────────────────────────────────

async function duplicar(codigoCrudo, body, ctx) {
	const origen = entero(codigoCrudo, 'Convenio');
	const original = def.cabeceraApi(await filaCabecera(origen));
	const valores = def.normalizarCabecera({
		...original,
		Valor: body?.obraSocial ?? original.Valor,
		Descripcion: body?.descripcion ?? original.Descripcion,
		VigenciaDesde: body?.vigenciaDesde ?? null,
		VigenciaHasta: body?.vigenciaHasta ?? null,
	});
	if (!(await existeObraSocial(valores.Valor))) throw errorHttp('La obra social no existe');
	const ajusteCrudo = body?.ajustePorcentaje;
	const aj =
		ajusteCrudo === undefined || ajusteCrudo === null || String(ajusteCrudo).trim() === '' || Number(ajusteCrudo) === 0
			? null
			: def.normalizarAjuste({ porcentaje: ajusteCrudo });

	const { codigo, copiadas } = await enTransaccion(async (tx) => {
		const req = new sql.Request(tx);
		for (const c of CABECERA) req.input(c.name, tipoMssql(c), valorSeguro(valores[c.name]));
		const r = await req.query(
			`INSERT INTO dbo.imClientesConvenios (${CABECERA.map((c) => c.name).join(', ')})
			 VALUES (${CABECERA.map((c) => `@${c.name}`).join(', ')});
			 SELECT CONVERT(int, SCOPE_IDENTITY()) AS Codigo;`,
		);
		const nuevo = Number(r.recordset?.[0]?.Codigo);
		const filas = {};
		for (const id of IDS_PESTANAS) {
			const p = PESTANAS[id];
			const cols = p.columnas.map((c) => c.name).join(', ');
			const ins = new sql.Request(tx);
			ins.input('origen', sql.Int, origen);
			ins.input('nuevo', sql.Int, nuevo);
			const orden = p.identidad ? ` ORDER BY ${p.identidad}` : '';
			const rr = await ins.query(
				`INSERT INTO dbo.${p.tabla} (ValorConvenio, ${cols})
				 SELECT @nuevo, ${cols} FROM dbo.${p.tabla} t WHERE t.ValorConvenio = @origen${def.filtroPestana(p)}${orden}`,
			);
			filas[id] = rr.rowsAffected?.[0] || 0;
		}
		if (aj) await ejecutarAjuste(tx, nuevo, aj);
		return { codigo: nuevo, copiadas: filas };
	});

	await registrar(ctx, 'DUPLICAR', codigo, { origen, copiadas, ajustePorcentaje: aj?.porcentaje ?? null, cabecera: valores });
	return { ...(await obtener(codigo)), copiadas };
}

// ─── Exportación ───────────────────────────────────────────────────────────

async function exportar(codigoCrudo) {
	const convenio = await obtener(codigoCrudo);
	const pestanas = {};
	for (const id of IDS_PESTANAS) {
		const r = await listarPestana(convenio.codigo, id, {}, { sinLimite: true });
		pestanas[id] = r.filas;
	}
	return { convenio, pestanas };
}

// ─── Mantenimiento: filas huérfanas ────────────────────────────────────────

/** El convenio 0 se excluye: hay filas cargadas con 0 a propósito (valores por defecto). */
const NO_EXISTE_CABECERA = (col) =>
	`${col} <> 0 AND NOT EXISTS (SELECT 1 FROM dbo.imClientesConvenios c WHERE c.Codigo = ${col})`;

async function reporteMantenimiento() {
	const huerfanas = await executeQuery(
		IDS_PESTANAS.map(
			(id) => `SELECT '${id}' AS pestana, h.ValorConvenio AS codigo, COUNT(*) AS filas
			         FROM dbo.${PESTANAS[id].tabla} h WHERE ${NO_EXISTE_CABECERA('h.ValorConvenio')}${def.filtroPestana(PESTANAS[id], 'h')}
			         GROUP BY h.ValorConvenio`,
		).join('\nUNION ALL\n'),
	);
	const [practicas, duplicados, invertidos, vacios] = await Promise.all([
		executeQuery(`SELECT COUNT_BIG(*) AS n FROM dbo.imPracticasXConvenios h WHERE ${NO_EXISTE_CABECERA('h.IdConvenio')}`),
		executeQuery(
			`SELECT TOP 50 d.ValorConvenio AS codigo, RTRIM(c.Descripcion) AS descripcion, COUNT(*) AS grupos, SUM(d.n - 1) AS sobrantes
			 FROM (SELECT ValorConvenio, Desde, Hasta, Funcion, Ambulatorio, Internacion, COUNT(*) AS n
			       FROM dbo.imClientesConvNomenc
			       GROUP BY ValorConvenio, Desde, Hasta, Funcion, Ambulatorio, Internacion HAVING COUNT(*) > 1) d
			 JOIN dbo.imClientesConvenios c ON c.Codigo = d.ValorConvenio
			 GROUP BY d.ValorConvenio, c.Descripcion ORDER BY sobrantes DESC`,
		),
		executeQuery(
			`SELECT TOP 50 x.pestana, x.codigo, RTRIM(c.Descripcion) AS descripcion, x.Desde, x.Hasta FROM (
			   SELECT 'nomenclador' AS pestana, ValorConvenio AS codigo, Desde, Hasta FROM dbo.imClientesConvNomenc WHERE Desde > Hasta
			   UNION ALL
			   SELECT 'moduladas', ValorConvenio, Desde, Hasta FROM dbo.imClientesConvModuladas WHERE Desde > Hasta
			 ) x JOIN dbo.imClientesConvenios c ON c.Codigo = x.codigo ORDER BY x.codigo`,
		),
		executeQuery(
			`SELECT c.Codigo AS codigo, RTRIM(c.Descripcion) AS descripcion FROM dbo.imClientesConvenios c
			 WHERE ${IDS_PESTANAS.map((id) => `NOT EXISTS (SELECT 1 FROM dbo.${PESTANAS[id].tabla} x WHERE x.ValorConvenio = c.Codigo)`).join(' AND ')}
			 ORDER BY c.Codigo DESC`,
		),
	]);

	const porPestana = IDS_PESTANAS.map((id) => {
		const filas = huerfanas.filter((h) => h.pestana === id);
		return {
			pestana: id,
			titulo: PESTANAS[id].titulo,
			filas: filas.reduce((a, f) => a + Number(f.filas), 0),
			convenios: filas.map((f) => ({ codigo: Number(f.codigo), filas: Number(f.filas) })).sort((a, b) => b.filas - a.filas),
		};
	});

	return {
		huerfanas: porPestana,
		practicasXConvenioHuerfanas: Number(practicas[0]?.n) || 0,
		duplicadosNomenclador: duplicados.map((d) => ({
			codigo: Number(d.codigo),
			descripcion: d.descripcion,
			grupos: Number(d.grupos),
			sobrantes: Number(d.sobrantes),
		})),
		rangosInvertidos: invertidos.map((r) => ({
			pestana: r.pestana,
			codigo: Number(r.codigo),
			descripcion: r.descripcion,
			desde: Number(r.Desde),
			hasta: Number(r.Hasta),
		})),
		conveniosVacios: vacios.map((v) => ({ codigo: Number(v.codigo), descripcion: v.descripcion })),
	};
}

/**
 * Borra filas de detalle cuyo convenio no existe y luego las de
 * imPracticasXConvenios (los triggers las regeneran al borrar el detalle).
 */
async function limpiarHuerfanas(body, ctx) {
	const pestanas = Array.isArray(body?.pestanas) && body.pestanas.length ? body.pestanas.map(String) : IDS_PESTANAS;
	pestanas.forEach(pestanaPorId);

	const resultado = await enTransaccion(async (tx) => {
		const out = {};
		for (const id of pestanas) {
			const r = await new sql.Request(tx).query(
				`DELETE h FROM dbo.${PESTANAS[id].tabla} h WHERE ${NO_EXISTE_CABECERA('h.ValorConvenio')}${def.filtroPestana(PESTANAS[id], 'h')}`,
			);
			out[id] = r.rowsAffected?.[0] || 0;
		}
		const r = await new sql.Request(tx).query(
			`DELETE h FROM dbo.imPracticasXConvenios h WHERE ${NO_EXISTE_CABECERA('h.IdConvenio')}`,
		);
		out.practicasXConvenio = r.rowsAffected?.[0] || 0;
		return out;
	});
	await registrar(ctx, 'LIMPIAR_HUERFANAS', null, resultado);
	return resultado;
}

module.exports = {
	catalogos,
	buscarEnCatalogo,
	listar,
	obtener,
	uso,
	crear,
	actualizar,
	listarPestana,
	guardarLote,
	previsualizarAjuste,
	aplicarAjuste,
	duplicar,
	exportar,
	reporteMantenimiento,
	limpiarHuerfanas,
};
