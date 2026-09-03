/**
 * Importación del Excel de liquidación de honorarios.
 *
 * La obra social devuelve, por período, un Excel con lo que efectivamente
 * liquidó de cada prestación. Ese importe se guarda en
 * dbo.imFacDetalle.ImporteLiquidado (la crea
 * scripts/sql/liquidacion_imfacdetalle.sql) y es lo que Mi Producción muestra
 * en la columna "Liquidado".
 *
 * El cruce es por IdPrestacion, que es la columna que traen todos los Excel de
 * liquidación. Ese id NO es único en imFacDetalle: el mismo valor aparece en la
 * fila de honorarios (TIPOPRESTACION 'H') y en las de gastos y medicamentos.
 * Cuando hay más de una candidata se toma la de honorarios, y si ni así queda
 * una sola la fila se informa como ambigua y no se escribe.
 *
 * Nada se escribe en la previsualización: primero se devuelve fila por fila qué
 * va a pasar y recién con `aplicar` se abre la transacción.
 */
const crypto = require('crypto');
const XLSX = require('xlsx');
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');

const TABLA = 'dbo.imFacDetalle';
const TABLA_IMPORT = 'dbo.imFacLiquidacionImport';
const TABLA_IMPORT_DETALLE = 'dbo.imFacLiquidacionImportDetalle';

/** Máximo de renglones de un Excel de liquidación (los reales rondan los cientos). */
const MAX_FILAS = 20000;
/** Filas del encabezado a explorar antes de dar por perdida una hoja. */
const MAX_FILAS_ENCABEZADO = 30;
/** Parámetros por consulta: SQL Server admite 2100. */
const IDS_POR_CONSULTA = 500;
const UPDATES_POR_LOTE = 100;
const DETALLES_POR_LOTE = 50;
/** Tolerancia al comparar importes (redondeos de Excel). */
const EPSILON = 0.005;

const ESTADOS = Object.freeze({
	APLICADO: 'APLICADO',
	SIN_CAMBIO: 'SIN_CAMBIO',
	AMBIGUA: 'AMBIGUA',
	SIN_MATCH: 'SIN_MATCH',
	DUPLICADA_EXCEL: 'DUPLICADA_EXCEL',
});

function httpError(mensaje, statusCode = 400, extra = {}) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	Object.assign(err, extra);
	return err;
}

// ============================================================================
// Esquema real de imFacDetalle
// ============================================================================

/**
 * Nombres posibles de cada columna. Las bases vienen del Clarion y no todas
 * escriben igual (IMPORTE_FINAL / ImporteFinal), así que se resuelven una vez
 * por tenant contra INFORMATION_SCHEMA en lugar de hardcodearse.
 */
const CANDIDATOS = Object.freeze({
	idDetalle: ['IDDETALLE', 'ID_DETALLE'],
	idPrestacion: ['IDPRESTACION', 'ID_PRESTACION'],
	tipoPrestacion: ['TIPOPRESTACION', 'TIPO_PRESTACION'],
	matricula: ['MATRICULA'],
	numeroVisita: ['NUMEROVISITA', 'NUMERO_VISITA'],
	importeFinal: ['IMPORTE_FINAL', 'IMPORTEFINAL'],
	importeLiquidado: ['IMPORTELIQUIDADO'],
	idPractica: ['IDPRACTICA', 'ID_PRACTICA'],
});

/** Solo columnas obligatorias para poder cruzar y escribir. */
const REQUERIDAS = ['idDetalle', 'idPrestacion', 'importeLiquidado'];

const esquema = createTenantOnce(async () => {
	const filas = await executeQuery(
		`SELECT COLUMN_NAME
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imFacDetalle'`,
	);
	if (!filas || filas.length === 0) {
		throw httpError('Esta base no tiene dbo.imFacDetalle: no hay facturación para liquidar.', 409);
	}

	const porNombre = new Map();
	for (const f of filas) {
		const real = String(f.COLUMN_NAME || '');
		if (real && !real.includes(']')) porNombre.set(real.toUpperCase(), real);
	}

	const cols = {};
	for (const [campo, alternativas] of Object.entries(CANDIDATOS)) {
		const encontrada = alternativas.map((a) => porNombre.get(a)).find(Boolean);
		if (encontrada) cols[campo] = `[${encontrada}]`;
	}

	const faltantes = REQUERIDAS.filter((c) => !cols[c]);
	if (faltantes.includes('importeLiquidado')) {
		throw httpError(
			'Falta la columna ImporteLiquidado en imFacDetalle. Aplicá ' +
				'scripts/sql/liquidacion_imfacdetalle.sql en esta base ' +
				'(node scripts/instalar_liquidacion_imfacdetalle.js --empresas=<id>).',
			409,
			{ code: 'LIQUIDACION_SIN_ESQUEMA' },
		);
	}
	if (faltantes.length > 0) {
		throw httpError(
			`dbo.imFacDetalle no tiene las columnas ${faltantes.join(', ')}: no se puede cruzar la liquidación.`,
			409,
		);
	}

	const historial = await executeQuery(
		`SELECT
			OBJECT_ID('${TABLA_IMPORT}', 'U')          AS cabecera,
			OBJECT_ID('${TABLA_IMPORT_DETALLE}', 'U')  AS detalle`,
	);
	const h = historial?.[0] || {};
	if (!h.cabecera || !h.detalle) {
		throw httpError(
			'Faltan las tablas del historial de importaciones. Aplicá ' +
				'scripts/sql/liquidacion_imfacdetalle.sql en esta base.',
			409,
			{ code: 'LIQUIDACION_SIN_ESQUEMA' },
		);
	}

	return cols;
});

// ============================================================================
// Lectura del Excel
// ============================================================================

/** 'Nro. Visita' -> 'nro visita' (sin tildes, sin puntuación, sin dobles espacios). */
function normalizarEncabezado(valor) {
	return String(valor ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

const ALIAS = Object.freeze({
	idPrestacion: ['idprestacion', 'id prestacion'],
	importe: ['importe final', 'importefinal', 'importe total', 'importetotal', 'importe'],
	matricula: ['matricula', 'mat'],
	numeroVisita: ['nro visita', 'numero visita', 'nrovisita', 'numerovisita', 'visita'],
	idDetalle: ['iddetalle', 'id detalle'],
	cantidad: ['cantidad', 'cant'],
	codigo: ['codigo', 'practica', 'codigo practica'],
	profesional: ['nombre profesional', 'profesional', 'apellido y nombre profesional'],
	fecha: ['fecha', 'fecha practica'],
});

/** Campos sin los cuales el archivo no sirve. */
const ALIAS_REQUERIDOS = ['idPrestacion', 'importe'];


function aNumero(valor) {
	if (valor == null || valor === '') return null;
	if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
	if (valor instanceof Date) return null;

	let texto = String(valor).trim().replace(/\s/g, '').replace(/[$]/g, '');
	if (!texto) return null;

	const coma = texto.lastIndexOf(',');
	const punto = texto.lastIndexOf('.');
	if (coma >= 0 && punto >= 0) {
		// El separador más a la derecha es el decimal.
		texto =
			coma > punto
				? texto.replace(/\./g, '').replace(',', '.')
				: texto.replace(/,/g, '');
	} else if (coma >= 0) {
		texto = texto.replace(/,/g, '.');
	} else if ((texto.match(/\./g) || []).length > 1) {
		// 1.234.567 = separador de miles.
		texto = texto.replace(/\./g, '');
	}

	const n = Number(texto);
	return Number.isFinite(n) ? n : null;
}

function aEntero(valor) {
	const n = aNumero(valor);
	return n == null ? null : Math.trunc(n);
}

function aTexto(valor, max = 300) {
	if (valor == null) return null;
	const texto = String(valor).trim();
	return texto ? texto.slice(0, max) : null;
}

function nombreArchivoVisible(valor, fallback = 'liquidacion.xlsx') {
	const sinRuta = String(valor ?? '')
		.replace(/^.*[\\/]/, '')
		.trim();
	return aTexto(sinRuta, 260) || fallback;
}

function codigoDePractica(valor) {
	if (valor == null || valor === '') return null;
	const texto = String(valor).trim();
	if (!texto || texto === '0') return null;
	return aTexto(texto, 50);
}

/**
 * Ubica el encabezado en una hoja: los Excel de liquidación arrancan con
 * títulos y subtotales, así que la fila de nombres no es la primera.
 * @returns {{ fila: number, columnas: Object }|null}
 */
function detectarEncabezado(matriz) {
	const limite = Math.min(matriz.length, MAX_FILAS_ENCABEZADO);
	for (let i = 0; i < limite; i++) {
		const fila = matriz[i] || [];
		const columnas = {};
		for (let c = 0; c < fila.length; c++) {
			const texto = normalizarEncabezado(fila[c]);
			if (!texto) continue;
			for (const [campo, alias] of Object.entries(ALIAS)) {
				if (columnas[campo] == null && alias.includes(texto)) columnas[campo] = c;
			}
		}
		if (ALIAS_REQUERIDOS.every((campo) => columnas[campo] != null)) {
			return { fila: i, columnas };
		}
	}
	return null;
}

/**
 * Parsea el archivo: busca la primera hoja con un encabezado reconocible y
 * devuelve los renglones con las columnas que interesan.
 */
function parsearExcel(buffer, nombreArchivo) {
	let libro;
	try {
		libro = XLSX.read(buffer, { type: 'buffer', cellDates: true });
	} catch (e) {
		throw httpError(`No pude leer el Excel: ${e.message}`, 400);
	}

	for (const nombreHoja of libro.SheetNames) {
		const hoja = libro.Sheets[nombreHoja];
		if (!hoja || !hoja['!ref']) continue;

		const matriz = XLSX.utils.sheet_to_json(hoja, {
			header: 1,
			raw: true,
			blankrows: true,
			defval: null,
		});
		const encabezado = detectarEncabezado(matriz);
		if (!encabezado) continue;

		const { fila: filaEncabezado, columnas } = encabezado;
		const desplazamiento = XLSX.utils.decode_range(hoja['!ref']).s.r;
		const filas = [];

		for (let i = filaEncabezado + 1; i < matriz.length; i++) {
			const fila = matriz[i] || [];
			const celda = (campo) =>
				columnas[campo] != null ? fila[columnas[campo]] : null;

			const vacia = Object.keys(columnas).every((campo) => {
				const v = celda(campo);
				return v == null || String(v).trim() === '';
			});
			if (vacia) continue;

			filas.push({
				// Número de fila tal como se ve en Excel, para poder señalarla.
				fila: desplazamiento + i + 1,
				idPrestacion: aEntero(celda('idPrestacion')),
				importeExcel: aNumero(celda('importe')),
				matricula: aEntero(celda('matricula')),
				numeroVisita: aEntero(celda('numeroVisita')),
				idDetalleExcel: aEntero(celda('idDetalle')),
				cantidad: aNumero(celda('cantidad')),
				codigo: aTexto(celda('codigo'), 50),
				profesional: aTexto(celda('profesional'), 120),
			});

			if (filas.length > MAX_FILAS) {
				throw httpError(
					`El archivo tiene más de ${MAX_FILAS} renglones: revisá que sea el Excel de una liquidación.`,
					400,
				);
			}
		}

		if (filas.length === 0) {
			throw httpError(
				`La hoja "${nombreHoja}" tiene el encabezado pero ningún renglón con datos.`,
				400,
			);
		}

		return {
			archivo: aTexto(nombreArchivo, 260) || 'liquidacion.xlsx',
			hoja: nombreHoja,
			filaEncabezado: desplazamiento + filaEncabezado + 1,
			columnasDetectadas: Object.keys(columnas).sort(),
			filas,
		};
	}

	throw httpError(
		'No encontré en el archivo una hoja con las columnas IdPrestacion e Importe Final.',
		400,
	);
}

// ============================================================================
// Cruce contra imFacDetalle
// ============================================================================

/** Trae las filas de imFacDetalle de esos IdPrestacion, en lotes. */
async function buscarCandidatas(cols, ids) {
	const porPrestacion = new Map();

	for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
		const lote = ids.slice(i, i + IDS_POR_CONSULTA);
		const marcadores = lote.map((_, j) => `@p${j}`).join(', ');
		const filas = await executeQuery(
			`SELECT
				${cols.idDetalle}    AS idDetalle,
				${cols.idPrestacion} AS idPrestacion,
				${cols.tipoPrestacion ? `${cols.tipoPrestacion} AS tipoPrestacion,` : ''}
				${cols.matricula ? `${cols.matricula} AS matricula,` : ''}
				${cols.numeroVisita ? `${cols.numeroVisita} AS numeroVisita,` : ''}
				${cols.importeFinal ? `${cols.importeFinal} AS importeFinal,` : ''}
				${cols.idPractica ? `${cols.idPractica} AS idPractica,` : ''}
				${cols.importeLiquidado} AS importeLiquidado
			 FROM ${TABLA}
			 WHERE ${cols.idPrestacion} IN (${marcadores})`,
			lote.map((value) => ({ value, type: 'Int' })),
		);

		for (const f of filas || []) {
			const clave = Number(f.idPrestacion);
			if (!porPrestacion.has(clave)) porPrestacion.set(clave, []);
			porPrestacion.get(clave).push({
				idDetalle: Number(f.idDetalle),
				tipoPrestacion: aTexto(f.tipoPrestacion, 5),
				matricula: f.matricula != null ? Number(f.matricula) : null,
				numeroVisita: f.numeroVisita != null ? Number(f.numeroVisita) : null,
				importeFinal: f.importeFinal != null ? Number(f.importeFinal) : null,
				idPractica: f.idPractica != null ? f.idPractica : null,
				importeLiquidado: f.importeLiquidado != null ? Number(f.importeLiquidado) : null,
			});
		}
	}

	return porPrestacion;
}

const esHonorario = (fila) =>
	String(fila.tipoPrestacion || '').trim().toUpperCase() === 'H';

const mismoImporte = (a, b) =>
	a != null && b != null && Math.abs(Number(a) - Number(b)) <= EPSILON;

/**
 * Elige la fila de imFacDetalle a actualizar entre las que comparten
 * IdPrestacion. Si hay varias, la de honorarios; si sigue habiendo varias,
 * no se decide sola.
 */
function elegirDestino(candidatas) {
	if (candidatas.length === 1) return { destino: candidatas[0] };


	const honorarios = candidatas.filter(esHonorario);
	if (honorarios.length === 1) return { destino: honorarios[0] };

	return {
		detalle:
			honorarios.length > 1
				? `${honorarios.length} filas de honorarios con ese IdPrestacion`
				: `${candidatas.length} filas con ese IdPrestacion y ninguna de honorarios`,
	};
}

/** Marca los IdPrestacion repetidos dentro del propio Excel. */
function detectarDuplicados(filas) {
	const porPrestacion = new Map();
	for (const f of filas) {
		if (f.idPrestacion == null) continue;
		if (!porPrestacion.has(f.idPrestacion)) porPrestacion.set(f.idPrestacion, []);
		porPrestacion.get(f.idPrestacion).push(f);
	}

	const duplicadas = new Set();
	for (const grupo of porPrestacion.values()) {
		if (grupo.length < 2) continue;
		const importes = new Set(grupo.map((g) => Number(g.importeExcel).toFixed(2)));
		if (importes.size > 1) {
			// Importes distintos para la misma prestación: no hay forma de elegir.
			for (const g of grupo) duplicadas.add(g.fila);
		} else {
			// Mismo importe repetido: se aplica una sola vez.
			for (const g of grupo.slice(1)) duplicadas.add(g.fila);
		}
	}
	return duplicadas;
}

/** Apellido y nombre de imPersonal por matrícula, para mostrar en el preview. */
async function nombresPorMatricula(matriculas) {
	const ids = [
		...new Set(
			(matriculas || []).filter((m) => Number.isFinite(Number(m)) && Number(m) > 0).map(Number),
		),
	];
	const porMatricula = new Map();
	if (!ids.length) return porMatricula;

	for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
		const lote = ids.slice(i, i + IDS_POR_CONSULTA);
		const marcadores = lote.map((_, j) => `@p${j}`).join(', ');
		let filas;
		try {
			filas = await executeQuery(
				`SELECT p.Matricula AS matricula, p.ApellidoNombre AS nombre
				 FROM dbo.imPersonal p
				 WHERE p.Matricula IN (${marcadores})`,
				lote.map((value) => ({ value, type: 'Int' })),
			);
		} catch {
			return porMatricula;
		}
		for (const f of filas || []) {
			const mat = Number(f.matricula);
			const nombre = aTexto(f.nombre, 120);
			if (Number.isFinite(mat) && mat > 0 && nombre && !porMatricula.has(mat)) {
				porMatricula.set(mat, nombre);
			}
		}
	}
	return porMatricula;
}

/** Código de práctica e importe facturado de imFacDetalle, para el historial. */
async function datosDeImFacDetalle(cols, idsDetalle) {
	const ids = [
		...new Set(
			(idsDetalle || [])
				.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)
				.map(Number),
		),
	];
	const porId = new Map();
	if (!ids.length) return porId;

	const extra = [
		cols.idPractica ? `${cols.idPractica} AS idPractica` : null,
		cols.importeFinal ? `${cols.importeFinal} AS importeFinal` : null,
	].filter(Boolean);
	if (!extra.length) return porId;

	for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
		const lote = ids.slice(i, i + IDS_POR_CONSULTA);
		const marcadores = lote.map((_, j) => `@p${j}`).join(', ');
		const filas = await executeQuery(
			`SELECT ${cols.idDetalle} AS idDetalle, ${extra.join(', ')}
			 FROM ${TABLA}
			 WHERE ${cols.idDetalle} IN (${marcadores})`,
			lote.map((value) => ({ value, type: 'Int' })),
		);
		for (const f of filas || []) {
			const id = Number(f.idDetalle);
			if (!Number.isFinite(id) || porId.has(id)) continue;
			porId.set(id, {
				codigo: codigoDePractica(f.idPractica),
				importeFinal: f.importeFinal != null ? Number(f.importeFinal) : null,
			});
		}
	}
	return porId;
}

/**
 * Cruza el Excel con imFacDetalle y devuelve, sin escribir nada, qué pasaría
 * con cada renglón.
 */
async function evaluar(buffer, nombreArchivo) {
	const cols = await esquema();
	const parseado = parsearExcel(buffer, nombreArchivo);
	const duplicadas = detectarDuplicados(parseado.filas);

	const ids = [
		...new Set(
			parseado.filas
				.filter((f) => f.idPrestacion != null && f.idPrestacion > 0)
				.map((f) => f.idPrestacion),
		),
	];
	const candidatasPorId = ids.length ? await buscarCandidatas(cols, ids) : new Map();

	const filas = parseado.filas.map((f) => {
		const base = {
			...f,
			idDetalle: null,
			tipoPrestacion: null,
			importeFinal: null,
			importeAnterior: null,
			importeNuevo: null,
			coincideImporte: null,
			coincideMatricula: null,
			coincideVisita: null,
		};

		if (f.idPrestacion == null || f.idPrestacion <= 0) {
			return { ...base, estado: ESTADOS.SIN_MATCH, detalle: 'sin IdPrestacion' };
		}
		if (f.importeExcel == null) {
			return { ...base, estado: ESTADOS.SIN_MATCH, detalle: 'sin importe' };
		}
		if (duplicadas.has(f.fila)) {
			return {
				...base,
				estado: ESTADOS.DUPLICADA_EXCEL,
				detalle: 'el IdPrestacion se repite en el archivo',
			};
		}

		const candidatas = candidatasPorId.get(f.idPrestacion) || [];
		if (candidatas.length === 0) {
			return {
				...base,
				estado: ESTADOS.SIN_MATCH,
				detalle: 'el IdPrestacion no está en la facturación de esta base',
			};
		}

		const { destino, detalle } = elegirDestino(candidatas);
		if (!destino) {
			return { ...base, estado: ESTADOS.AMBIGUA, detalle };
		}

		const comparada = {
			...base,
			codigo: f.codigo || codigoDePractica(destino.idPractica),
			matricula: destino.matricula ?? f.matricula,
			numeroVisita: destino.numeroVisita ?? f.numeroVisita,
			idDetalle: destino.idDetalle,
			tipoPrestacion: destino.tipoPrestacion,
			importeFinal: destino.importeFinal,
			importeAnterior: destino.importeLiquidado,
			importeNuevo: f.importeExcel,
			coincideImporte: mismoImporte(f.importeExcel, destino.importeFinal),
			coincideMatricula:
				f.matricula != null && destino.matricula != null
					? f.matricula === destino.matricula
					: null,
			coincideVisita:
				f.numeroVisita != null && destino.numeroVisita != null
					? f.numeroVisita === destino.numeroVisita
					: null,
			detalle: detalle || null,
		};

		if (mismoImporte(destino.importeLiquidado, f.importeExcel)) {
			return { ...comparada, estado: ESTADOS.SIN_CAMBIO };
		}
		return { ...comparada, estado: ESTADOS.APLICADO };
	});

	const nombres = await nombresPorMatricula(filas.map((f) => f.matricula));
	for (const f of filas) {
		if (f.matricula != null && nombres.has(f.matricula)) {
			f.profesional = nombres.get(f.matricula);
		}
	}

	const cuenta = (estado) => filas.filter((f) => f.estado === estado).length;
	const aplicables = filas.filter((f) => f.estado === ESTADOS.APLICADO);

	return {
		...parseado,
		filas,
		resumen: {
			filas: filas.length,
			aplicables: aplicables.length,
			sinCambio: cuenta(ESTADOS.SIN_CAMBIO),
			ambiguas: cuenta(ESTADOS.AMBIGUA),
			sinMatch: cuenta(ESTADOS.SIN_MATCH),
			duplicadas: cuenta(ESTADOS.DUPLICADA_EXCEL),
			rechazadas:
				cuenta(ESTADOS.AMBIGUA) + cuenta(ESTADOS.SIN_MATCH) + cuenta(ESTADOS.DUPLICADA_EXCEL),
			importeArchivo: filas.reduce((acc, f) => acc + (Number(f.importeExcel) || 0), 0),
			importeAplicable: aplicables.reduce((acc, f) => acc + (Number(f.importeNuevo) || 0), 0),
			importeDistintoAlFacturado: filas.filter((f) => f.coincideImporte === false).length,
		},
	};
}

// ============================================================================
// Previsualización y aplicación
// ============================================================================

const hashArchivo = (buffer) =>
	crypto.createHash('sha256').update(buffer).digest('hex');

function usuarioDeAuth(auth) {
	const u = auth?.usuario || {};
	const nombre = [u.apellido, u.nombre].filter(Boolean).join(' ').trim();
	const username = String(u.username || '').trim();
	const etiqueta = username && nombre ? `${username} (${nombre})` : username || nombre;
	return {
		usuario: etiqueta ? etiqueta.slice(0, 115) : null,
		codOperador: Number.isFinite(Number(u.codOperador)) ? Number(u.codOperador) : null,
	};
}

/** Importación anterior del mismo archivo, para avisar que ya se subió. */
async function buscarImportacionPrevia(hash) {
	const filas = await executeQuery(
		`SELECT TOP 1 IdImport, Archivo, FechaHora, Usuario, FilasAplicadas, Estado
		 FROM ${TABLA_IMPORT}
		 WHERE HashArchivo = @p0
		 ORDER BY IdImport DESC`,
		[{ value: hash, type: 'Char', length: 64 }],
	);
	return filas?.[0] || null;
}

async function previsualizar(buffer, nombreArchivo) {
	const evaluacion = await evaluar(buffer, nombreArchivo);
	const hash = hashArchivo(buffer);
	return {
		...evaluacion,
		hash,
		importacionPrevia: await buscarImportacionPrevia(hash),
		aplicado: null,
	};
}

/**
 * Escribe ImporteLiquidado de las filas que coinciden y registra la importación.
 *
 * Por defecto solo aplica si el archivo entero coincide: si hay renglones
 * rechazados hace falta `confirmarParcial`, que es la confirmación explícita del
 * operador de aplicar nada más que la parte que cruzó.
 */
async function aplicar(buffer, nombreArchivo, auth, { confirmarParcial = false, nombreArchivo: alias } = {}) {
	const cols = await esquema();
	const evaluacion = await evaluar(buffer, nombreArchivo);
	const { resumen, filas } = evaluacion;

	if (resumen.aplicables === 0) {
		throw httpError(
			resumen.sinCambio === resumen.filas
				? 'Todos los renglones ya tenían ese importe liquidado: no hay nada que actualizar.'
				: 'Ningún renglón del archivo coincide con la facturación de esta base.',
			409,
			{ resumen },
		);
	}
	if (resumen.rechazadas > 0 && !confirmarParcial) {
		throw httpError(
			`${resumen.rechazadas} de ${resumen.filas} renglones no coinciden con la facturación. ` +
				'Revisá el detalle y confirmá si querés aplicar solo los que cruzaron.',
			409,
			{ code: 'LIQUIDACION_PARCIAL', resumen },
		);
	}

	const { usuario, codOperador } = usuarioDeAuth(auth);
	const hash = hashArchivo(buffer);
	const aplicables = filas.filter((f) => f.estado === ESTADOS.APLICADO);
	const importeAplicado = aplicables.reduce((acc, f) => acc + Number(f.importeNuevo), 0);
	const archivoGuardar = nombreArchivoVisible(alias || nombreArchivo, evaluacion.archivo);

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqCabecera = new sql.Request(tx);
		reqCabecera.input('archivo', sql.NVarChar(260), archivoGuardar);
		reqCabecera.input('hash', sql.Char(64), hash);
		reqCabecera.input('hoja', sql.NVarChar(128), evaluacion.hoja);
		reqCabecera.input('usuario', sql.VarChar(115), usuario);
		reqCabecera.input('codOperador', sql.Int, codOperador);
		reqCabecera.input('filas', sql.Int, resumen.filas);
		reqCabecera.input('aplicadas', sql.Int, aplicables.length);
		reqCabecera.input('rechazadas', sql.Int, resumen.rechazadas);
		reqCabecera.input('importe', sql.Decimal(19, 4), importeAplicado);
		const cabecera = await reqCabecera.query(
			`INSERT INTO ${TABLA_IMPORT}
				(Archivo, HashArchivo, Hoja, Usuario, IdOperador,
				 FilasArchivo, FilasAplicadas, FilasRechazadas, ImporteAplicado)
			 VALUES (@archivo, @hash, @hoja, @usuario, @codOperador,
				 @filas, @aplicadas, @rechazadas, @importe);
			 SELECT CONVERT(INT, SCOPE_IDENTITY()) AS idImport;`,
		);
		const idImport = Number(cabecera.recordset?.[0]?.idImport);
		if (!Number.isFinite(idImport) || idImport <= 0) {
			throw new Error('no pude registrar la cabecera de la importación');
		}

		for (let i = 0; i < aplicables.length; i += UPDATES_POR_LOTE) {
			const lote = aplicables.slice(i, i + UPDATES_POR_LOTE);
			const req = new sql.Request(tx);
			const sentencias = lote.map((f, j) => {
				req.input(`imp${j}`, sql.Decimal(19, 4), f.importeNuevo);
				req.input(`det${j}`, sql.Int, f.idDetalle);
				return `UPDATE ${TABLA} SET ${cols.importeLiquidado} = @imp${j} WHERE ${cols.idDetalle} = @det${j};`;
			});
			const r = await req.query(sentencias.join('\n'));
			const afectadas = (r.rowsAffected || []).reduce((a, b) => a + b, 0);
			if (afectadas !== lote.length) {
				throw new Error(
					`el UPDATE afectó ${afectadas} filas en lugar de ${lote.length}: se cancela la importación`,
				);
			}
		}

		for (let i = 0; i < filas.length; i += DETALLES_POR_LOTE) {
			const lote = filas.slice(i, i + DETALLES_POR_LOTE);
			const req = new sql.Request(tx);
			req.input('idImport', sql.Int, idImport);
			const valores = lote.map((f, j) => {
				req.input(`fila${j}`, sql.Int, f.fila);
				req.input(`pre${j}`, sql.Int, f.idPrestacion);
				req.input(`exc${j}`, sql.Int, f.idDetalleExcel);
				req.input(`mat${j}`, sql.Int, f.matricula);
				req.input(`vis${j}`, sql.Int, f.numeroVisita);
				req.input(`impExc${j}`, sql.Decimal(19, 4), f.importeExcel);
				req.input(`det${j}`, sql.Int, f.idDetalle);
				req.input(`tipo${j}`, sql.VarChar(5), f.tipoPrestacion);
				req.input(`ant${j}`, sql.Decimal(19, 4), f.importeAnterior);
				req.input(`nue${j}`, sql.Decimal(19, 4), f.estado === ESTADOS.APLICADO ? f.importeNuevo : null);
				req.input(`est${j}`, sql.VarChar(20), f.estado);
				req.input(`obs${j}`, sql.NVarChar(300), f.detalle);
				return `(@idImport, @fila${j}, @pre${j}, @exc${j}, @mat${j}, @vis${j}, @impExc${j},
					@det${j}, @tipo${j}, @ant${j}, @nue${j}, @est${j}, @obs${j})`;
			});
			await req.query(
				`INSERT INTO ${TABLA_IMPORT_DETALLE}
					(IdImport, FilaExcel, IdPrestacion, IdDetalleExcel, Matricula, NumeroVisita,
					 ImporteExcel, IdDetalle, TipoPrestacion, ImporteAnterior, ImporteNuevo, Estado, Detalle)
				 VALUES ${valores.join(',\n')}`,
			);
		}

		await tx.commit();

		return {
			...evaluacion,
			hash,
			importacionPrevia: null,
			aplicado: {
				idImport,
				filasAplicadas: aplicables.length,
				filasRechazadas: resumen.rechazadas,
				importeAplicado,
			},
		};
	} catch (e) {
		try {
			await tx.rollback();
		} catch {
			/* la transacción ya pudo abortar sola */
		}
		throw e;
	}
}

// ============================================================================
// Historial
// ============================================================================

async function listarImportaciones(opts = {}) {
	await esquema();
	const raw = typeof opts === 'number' || typeof opts === 'string' ? { limite: opts } : opts || {};
	const top = Math.min(Math.max(Number(raw.limite) || 200, 1), 500);
	const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.desde || '').trim())
		? String(raw.desde).trim()
		: null;
	const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.hasta || '').trim())
		? String(raw.hasta).trim()
		: null;

	const filas = await executeQuery(
		`SELECT TOP (@p0)
			IdImport, Archivo, Hoja, FechaHora, Usuario, IdOperador,
			FilasArchivo, FilasAplicadas, FilasRechazadas, ImporteAplicado, Estado
		 FROM ${TABLA_IMPORT}
		 WHERE (@p1 IS NULL OR CAST(FechaHora AS DATE) >= @p1)
		   AND (@p2 IS NULL OR CAST(FechaHora AS DATE) <= @p2)
		 ORDER BY IdImport DESC`,
		[
			{ value: top, type: 'Int' },
			{ value: desde, type: 'VarChar', length: 10 },
			{ value: hasta, type: 'VarChar', length: 10 },
		],
	);
	return filas || [];
}

async function obtenerImportacion(idImport) {
	const cols = await esquema();
	const id = Number(idImport);
	if (!Number.isFinite(id) || id <= 0) throw httpError('Importación inválida', 400);

	const cabeceras = await executeQuery(
		`SELECT IdImport, Archivo, Hoja, FechaHora, Usuario, IdOperador,
			FilasArchivo, FilasAplicadas, FilasRechazadas, ImporteAplicado, Estado
		 FROM ${TABLA_IMPORT}
		 WHERE IdImport = @p0`,
		[{ value: id, type: 'Int' }],
	);
	const cabecera = cabeceras?.[0];
	if (!cabecera) throw httpError('No encontré esa importación', 404);

	const detalle = await executeQuery(
		`SELECT FilaExcel, IdPrestacion, IdDetalleExcel, Matricula, NumeroVisita,
			ImporteExcel, IdDetalle, TipoPrestacion, ImporteAnterior, ImporteNuevo, Estado, Detalle
		 FROM ${TABLA_IMPORT_DETALLE}
		 WHERE IdImport = @p0
		 ORDER BY FilaExcel, IdImportDetalle`,
		[{ value: id, type: 'Int' }],
	);

	const nombres = await nombresPorMatricula((detalle || []).map((f) => f.Matricula));
	const extra = await datosDeImFacDetalle(
		cols,
		(detalle || []).map((f) => f.IdDetalle),
	);
	return {
		...cabecera,
		detalle: (detalle || []).map((f) => {
			const fact = extra.get(Number(f.IdDetalle)) || {};
			return {
				...f,
				profesional: nombres.get(Number(f.Matricula)) || null,
				codigo: fact.codigo || null,
				importeFinal: fact.importeFinal ?? null,
			};
		}),
	};
}

/**
 * Deshace una importación: devuelve cada fila al importe que tenía antes.
 *
 * Solo toca las filas que siguen con el valor que dejó esta importación: si
 * después entró otra liquidación sobre la misma prestación, esa gana y la fila
 * se deja como está.
 */
async function revertir(idImport) {
	const cols = await esquema();
	const id = Number(idImport);
	if (!Number.isFinite(id) || id <= 0) throw httpError('Importación inválida', 400);

	const cabecera = (
		await executeQuery(
			`SELECT IdImport, Estado, FilasAplicadas FROM ${TABLA_IMPORT} WHERE IdImport = @p0`,
			[{ value: id, type: 'Int' }],
		)
	)?.[0];
	if (!cabecera) throw httpError('No encontré esa importación', 404);
	if (String(cabecera.Estado) === 'REVERTIDO') {
		throw httpError('Esa importación ya estaba revertida', 409);
	}

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqDeshacer = new sql.Request(tx);
		reqDeshacer.input('id', sql.Int, id);
		const r = await reqDeshacer.query(`
			UPDATE d
			SET d.${cols.importeLiquidado} = det.ImporteAnterior
			FROM ${TABLA} d
			JOIN ${TABLA_IMPORT_DETALLE} det ON det.IdDetalle = d.${cols.idDetalle}
			WHERE det.IdImport = @id
			  AND det.Estado = '${ESTADOS.APLICADO}'
			  AND d.${cols.importeLiquidado} = det.ImporteNuevo;
		`);
		const revertidas = (r.rowsAffected || []).reduce((a, b) => a + b, 0);

		const reqEstados = new sql.Request(tx);
		reqEstados.input('id', sql.Int, id);
		await reqEstados.query(`
			UPDATE ${TABLA_IMPORT_DETALLE}
			SET Estado = 'REVERTIDO'
			WHERE IdImport = @id AND Estado = '${ESTADOS.APLICADO}';

			UPDATE ${TABLA_IMPORT}
			SET Estado = 'REVERTIDO'
			WHERE IdImport = @id;
		`);

		await tx.commit();
		return {
			idImport: id,
			revertidas,
			omitidas: Math.max(Number(cabecera.FilasAplicadas || 0) - revertidas, 0),
		};
	} catch (e) {
		try {
			await tx.rollback();
		} catch {
			/* la transacción ya pudo abortar sola */
		}
		throw e;
	}
}

async function renombrar(idImport, archivo) {
	await esquema();
	const id = Number(idImport);
	if (!Number.isFinite(id) || id <= 0) throw httpError('Importación inválida', 400);
	const nombre = nombreArchivoVisible(archivo, '');
	if (!nombre) throw httpError('El nombre no puede quedar vacío', 400);

	const actualizado = await executeQuery(
		`UPDATE ${TABLA_IMPORT}
		 SET Archivo = @p0
		 OUTPUT INSERTED.IdImport, INSERTED.Archivo
		 WHERE IdImport = @p1`,
		[
			{ value: nombre, type: 'NVarChar', length: 260 },
			{ value: id, type: 'Int' },
		],
	);
	if (!actualizado?.[0]) throw httpError('No encontré esa importación', 404);
	return actualizado[0];
}

module.exports = {
	previsualizar,
	aplicar,
	listarImportaciones,
	obtenerImportacion,
	revertir,
	renombrar,
	ESTADOS,
};
