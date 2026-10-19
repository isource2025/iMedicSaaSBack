/**
 * Definición de la cabecera de convenios (imClientesConvenios) y de sus tablas
 * de detalle, más las validaciones que no necesitan base de datos.
 *
 * Las tablas de detalle guardan el convenio en `ValorConvenio`, que apunta a
 * imClientesConvenios.Codigo (no a Valor, que es la obra social).
 * Ver docs/FACTURACION_CONVENIOS.md.
 */
const { convertirFechaAClarion, clarionAIsoCalendario } = require('../../utils/dateUtils');

function errorHttp(mensaje, statusCode = 400, extra = {}) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	Object.assign(err, extra);
	return err;
}

/** Valores válidos de TipoValor en el detalle: '' es "valor calculado". */
const TIPOS_VALOR = ['$', '%', ''];

const LIMITES_ENTEROS = {
	TinyInt: [0, 255],
	SmallInt: [-32768, 32767],
	Int: [-2147483648, 2147483647],
};
const MAX_MONEY = 922337203685477;

function col(name, sqlType, opts = {}) {
	return {
		name,
		sqlType,
		label: opts.label || name,
		length: opts.length,
		precision: opts.precision,
		scale: opts.scale,
		required: Boolean(opts.required),
		/** Qué editor usa el front y qué validación extra corre el back. */
		kind: opts.kind || (['VarChar', 'Char'].includes(sqlType) ? 'texto' : 'numero'),
		defecto: opts.defecto,
		min: opts.min,
		max: opts.max,
		/** Columna con valor fijo que no se muestra (p. ej. Troquel = 0 en Genéricos). */
		oculta: Boolean(opts.oculta),
	};
}

/** Los importes se guardan y se muestran con 2 decimales. */
const DECIMALES_IMPORTE = 2;

const flag = (name, label, defecto = 1) => col(name, 'TinyInt', { kind: 'flag', label, required: true, defecto, max: 1 });

const COLUMNAS_PRACTICA = (tipos) => [
	col('Desde', 'Int', { kind: 'practica', label: 'Desde', required: true, min: 0 }),
	col('Hasta', 'Int', { kind: 'practica', label: 'Hasta', required: true, min: 0 }),
	col('Descripcion', 'VarChar', { length: 255, label: 'Descripción' }),
	col('Funcion', 'TinyInt', { kind: 'funcion', label: 'Función', defecto: 0 }),
	col('NoCubre', 'TinyInt', { kind: 'flag', label: 'No cubre', defecto: 0, max: 1 }),
	col('TipoValor', 'Char', { length: 1, kind: 'tipoValor', label: 'Tipo', defecto: '$' }),
	col('Valor', tipos.valor.sqlType, { ...tipos.valor, kind: 'importe', label: 'Valor', min: 0 }),
	col('CategoriaA', tipos.categoria.sqlType, { ...tipos.categoria, kind: 'importe', label: 'Categ. A', min: 0 }),
	col('CategoriaB', tipos.categoria.sqlType, { ...tipos.categoria, kind: 'importe', label: 'Categ. B', min: 0 }),
	col('CategoriaC', tipos.categoria.sqlType, { ...tipos.categoria, kind: 'importe', label: 'Categ. C', min: 0 }),
	flag('Ambulatorio', 'Amb.'),
	flag('Internacion', 'Int.'),
];

/**
 * Pestañas de detalle. `identidad`: columna IDENTITY que identifica la fila;
 * si no hay, la fila se identifica por `clave` (PK de la tabla sin ValorConvenio).
 * `unica`: combinación que no se puede repetir dentro del convenio (la base no
 * siempre lo obliga; el back lo controla para las filas que se tocan).
 * `filtro`: parte de la tabla que le corresponde a la pestaña (alias `t`), para
 * las que comparten tabla. Vademécum y Genéricos usan imClientesConvVadem y se
 * reparten por Troquel: los genéricos son ítems cargados a demanda, sin troquel.
 */
const PESTANAS = {
	valores: {
		id: 'valores',
		titulo: 'Valores por letra',
		tabla: 'imClientesConvValores',
		identidad: null,
		clave: ['ValorLetra', 'Ambulatorio', 'Internacion'],
		columnas: [
			col('ValorLetra', 'Char', { length: 1, kind: 'letra', label: 'Letra', required: true }),
			col('ValorGaleno', 'Real', { kind: 'importe', label: 'Galeno (honorarios)', min: 0 }),
			col('ValorGastos', 'Real', { kind: 'importe', label: 'Gastos', min: 0 }),
			col('CategoriaA', 'Real', { kind: 'importe', label: 'Categ. A', min: 0 }),
			col('CategoriaB', 'Real', { kind: 'importe', label: 'Categ. B', min: 0 }),
			col('CategoriaC', 'Real', { kind: 'importe', label: 'Categ. C', min: 0 }),
			flag('Ambulatorio', 'Amb.'),
			flag('Internacion', 'Int.'),
		],
		orden: 't.ValorLetra, t.Ambulatorio DESC, t.Internacion DESC',
		paginada: false,
		ajustables: ['ValorGaleno', 'ValorGastos', 'CategoriaA', 'CategoriaB', 'CategoriaC'],
		ajusteSoloFijos: false,
	},
	nomenclador: {
		id: 'nomenclador',
		titulo: 'Nomenclador',
		tabla: 'imClientesConvNomenc',
		identidad: 'Id',
		unica: ['Desde', 'Hasta', 'Funcion', 'Ambulatorio', 'Internacion'],
		columnas: COLUMNAS_PRACTICA({
			valor: { sqlType: 'Money' },
			categoria: { sqlType: 'Decimal', precision: 7, scale: 2 },
		}),
		catalogo: { tabla: 'imNomenclador', clave: 'IDPractica' },
		orden: 't.Desde, t.Hasta, t.Funcion, t.Id',
		paginada: true,
		filtroFuncion: true,
		ajustables: ['Valor', 'CategoriaA', 'CategoriaB', 'CategoriaC'],
		ajusteSoloFijos: true,
	},
	moduladas: {
		id: 'moduladas',
		titulo: 'Moduladas',
		tabla: 'imClientesConvModuladas',
		identidad: 'Id',
		unica: ['Desde', 'Hasta', 'Funcion', 'Ambulatorio', 'Internacion'],
		columnas: [
			...COLUMNAS_PRACTICA({
				valor: { sqlType: 'Decimal', precision: 19, scale: 4 },
				categoria: { sqlType: 'Decimal', precision: 11, scale: 4 },
			}),
			col('CodModulo', 'Int', { label: 'Cód. módulo', min: 0, defecto: 0 }),
		],
		catalogo: { tabla: 'imModuladas', clave: 'IDPractica' },
		orden: 't.Desde, t.Hasta, t.Funcion, t.Id',
		paginada: true,
		filtroFuncion: true,
		ajustables: ['Valor', 'CategoriaA', 'CategoriaB', 'CategoriaC'],
		ajusteSoloFijos: true,
	},
	vademecum: {
		id: 'vademecum',
		titulo: 'Vademécum',
		tabla: 'imClientesConvVadem',
		identidad: null,
		clave: ['Troquel', 'Descripcion'],
		filtro: 't.Troquel <> 0',
		columnas: [
			col('Troquel', 'Int', { kind: 'troquel', label: 'Troquel', required: true, min: 1 }),
			col('Descripcion', 'VarChar', { length: 80, label: 'Descripción', defecto: '' }),
			col('TipoValor', 'Char', { length: 1, kind: 'tipoValor', label: 'Tipo', defecto: '$' }),
			col('Valor', 'Money', { kind: 'importe', label: 'Valor', min: 0 }),
			col('Ambulatorio', 'Bit', { kind: 'flag', label: 'Amb.', defecto: 1, max: 1 }),
			col('Internacion', 'Bit', { kind: 'flag', label: 'Int.', defecto: 1, max: 1 }),
		],
		catalogo: { tabla: 'imVademecum', clave: 'Troquel' },
		orden: 't.Troquel, t.Descripcion',
		paginada: true,
		ajustables: ['Valor'],
		ajusteSoloFijos: true,
	},
	genericos: {
		id: 'genericos',
		titulo: 'Genéricos',
		tabla: 'imClientesConvVadem',
		identidad: null,
		clave: ['Troquel', 'Descripcion'],
		filtro: 't.Troquel = 0',
		columnas: [
			col('Troquel', 'Int', { label: 'Troquel', required: true, defecto: 0, min: 0, max: 0, oculta: true }),
			col('Descripcion', 'VarChar', { length: 80, label: 'Descripción', required: true }),
			col('TipoValor', 'Char', { length: 1, kind: 'tipoValor', label: 'Tipo', defecto: '$' }),
			col('Valor', 'Money', { kind: 'importe', label: 'Valor', min: 0 }),
			col('Ambulatorio', 'Bit', { kind: 'flag', label: 'Amb.', defecto: 1, max: 1 }),
			col('Internacion', 'Bit', { kind: 'flag', label: 'Int.', defecto: 1, max: 1 }),
		],
		orden: 't.Descripcion',
		paginada: true,
		ajustables: ['Valor'],
		ajusteSoloFijos: true,
	},
	complejidad: {
		id: 'complejidad',
		titulo: 'Anestesistas',
		tabla: 'imClientesConvComplejidad',
		identidad: null,
		clave: ['Complejidad', 'NoCubre', 'TipoValor', 'Ambulatorio', 'Internacion'],
		columnas: [
			col('Complejidad', 'TinyInt', { kind: 'complejidad', label: 'Complejidad', required: true, min: 1, max: 10 }),
			col('NoCubre', 'TinyInt', { kind: 'flag', label: 'No cubre', required: true, defecto: 0, max: 1 }),
			col('TipoValor', 'Char', { length: 1, kind: 'tipoValor', label: 'Tipo', defecto: '$' }),
			col('Valor', 'Real', { kind: 'importe', label: 'Valor', min: 0 }),
			flag('Ambulatorio', 'Amb.'),
			flag('Internacion', 'Int.'),
		],
		orden: 't.Complejidad, t.Ambulatorio DESC, t.Internacion DESC',
		paginada: false,
		ajustables: ['Valor'],
		ajusteSoloFijos: true,
	},
};

const IDS_PESTANAS = Object.keys(PESTANAS);

for (const p of Object.values(PESTANAS)) {
	if (!p.unica) p.unica = p.clave;
}

function pestanaPorId(id) {
	const p = PESTANAS[String(id || '')];
	if (!p) throw errorHttp('Pestaña de convenio desconocida', 404);
	return p;
}

function columna(pestana, nombre) {
	return pestana.columnas.find((c) => c.name === nombre);
}

/** Condición extra de la pestaña sobre la tabla con el alias pedido (' AND …' o ''). */
function filtroPestana(pestana, alias = 't') {
	return pestana.filtro ? ` AND ${pestana.filtro.replace(/\bt\./g, `${alias}.`)}` : '';
}

/** Tipo SQL para declarar columnas de tablas temporales. */
function tipoSqlTexto(c) {
	switch (c.sqlType) {
		case 'VarChar':
			return `varchar(${c.length}) COLLATE DATABASE_DEFAULT`;
		case 'Char':
			return `char(${c.length}) COLLATE DATABASE_DEFAULT`;
		case 'Decimal':
			return `decimal(${c.precision}, ${c.scale})`;
		default:
			return c.sqlType.toLowerCase();
	}
}

// ─── Normalización de valores ──────────────────────────────────────────────

function aNumero(v) {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
	if (typeof v === 'boolean') return v ? 1 : 0;
	const s = String(v).trim();
	if (!s) return null;
	const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s);
	return Number.isFinite(n) ? n : NaN;
}

/** Valor leído de la base → valor de la API (strings sin el relleno de char). */
function valorDeBase(c, v) {
	if (v === null || v === undefined) return null;
	if (c.sqlType === 'Char' || c.sqlType === 'VarChar') return String(v).trim();
	if (c.sqlType === 'Bit') return v === true || v === 1 ? 1 : 0;
	if (typeof v === 'number') return v;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/**
 * Valor de la API → valor para guardar. Devuelve { valor } o { error }.
 * Los vacíos toman el `defecto` de la columna; los char vacíos se guardan como ' '.
 */
function valorParaBase(c, crudo) {
	let v = crudo;
	const esTexto = c.sqlType === 'Char' || c.sqlType === 'VarChar';
	// En texto, '' es un valor elegido (p. ej. TipoValor vacío = valor calculado).
	const vacio = v === null || v === undefined || (!esTexto && typeof v === 'string' && v.trim() === '');
	if (vacio && c.defecto !== undefined) v = c.defecto;

	if (esTexto) {
		const s = v === null || v === undefined ? '' : String(v).trim();
		if (c.kind === 'tipoValor' && !TIPOS_VALOR.includes(s)) {
			return { error: `${c.label}: tiene que ser $, % o vacío` };
		}
		if (c.required && !s) return { error: `${c.label} es obligatorio` };
		if (s.length > c.length) return { error: `${c.label}: máximo ${c.length} caracteres` };
		if (c.sqlType === 'Char') return { valor: s ? s.toUpperCase() : ' ' };
		return { valor: s };
	}

	let n = aNumero(v);
	if (n === null) {
		if (c.required) return { error: `${c.label} es obligatorio` };
		return { valor: null };
	}
	if (Number.isNaN(n)) return { error: `${c.label}: tiene que ser un número` };
	if (c.kind === 'importe') n = Math.round(n * 10 ** DECIMALES_IMPORTE) / 10 ** DECIMALES_IMPORTE;
	if (c.min !== undefined && n < c.min) return { error: `${c.label}: no puede ser menor a ${c.min}` };
	if (c.max !== undefined && n > c.max) return { error: `${c.label}: no puede ser mayor a ${c.max}` };

	if (LIMITES_ENTEROS[c.sqlType]) {
		if (!Number.isInteger(n)) return { error: `${c.label}: tiene que ser un número entero` };
		const [lo, hi] = LIMITES_ENTEROS[c.sqlType];
		if (n < lo || n > hi) return { error: `${c.label}: fuera de rango` };
		return { valor: n };
	}
	if (c.sqlType === 'Bit') {
		if (n !== 0 && n !== 1) return { error: `${c.label}: tiene que ser sí o no` };
		return { valor: n };
	}
	if (c.sqlType === 'Decimal') {
		const max = 10 ** (c.precision - c.scale);
		if (Math.abs(n) >= max) return { error: `${c.label}: el máximo es ${max - 10 ** -c.scale}` };
		const f = 10 ** c.scale;
		return { valor: Math.round(n * f) / f };
	}
	if (c.sqlType === 'Money') {
		if (Math.abs(n) > MAX_MONEY) return { error: `${c.label}: fuera de rango` };
		return { valor: Math.round(n * 10000) / 10000 };
	}
	return { valor: n };
}

// ─── Identificación de filas ───────────────────────────────────────────────

/** Id de fila para el front: el IDENTITY o la clave original serializada. */
function idDeFila(pestana, filaBase) {
	if (pestana.identidad) return String(filaBase[pestana.identidad]);
	return JSON.stringify(pestana.clave.map((k) => filaBase[k] ?? null));
}

/** Decodifica el `_id` que manda el front. Devuelve el Id o el objeto clave. */
function claveDeId(pestana, id) {
	if (pestana.identidad) {
		const n = Number(id);
		if (!Number.isInteger(n) || n <= 0) throw errorHttp('Identificador de fila inválido');
		return { [pestana.identidad]: n };
	}
	let arr;
	try {
		arr = JSON.parse(String(id));
	} catch {
		throw errorHttp('Identificador de fila inválido');
	}
	if (!Array.isArray(arr) || arr.length !== pestana.clave.length) {
		throw errorHttp('Identificador de fila inválido');
	}
	const out = {};
	pestana.clave.forEach((k, i) => {
		const c = columna(pestana, k);
		const v = arr[i];
		if (c.sqlType === 'Char' || c.sqlType === 'VarChar') out[k] = v == null ? null : String(v);
		else if (c.sqlType === 'Bit') out[k] = v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null;
		else out[k] = v == null ? null : Number(v);
	});
	return out;
}

/** Fila de la base → fila de la API. */
function filaApi(pestana, filaBase) {
	const out = { _id: idDeFila(pestana, filaBase) };
	for (const c of pestana.columnas) out[c.name] = valorDeBase(c, filaBase[c.name]);
	return out;
}

// ─── Validación de filas y lotes ───────────────────────────────────────────

/**
 * @param {object} catalogos { letras: Set<string>, funciones: Set<number> }
 * @returns {{ valores: object, errores: string[] }}
 */
function normalizarFila(pestana, fila, catalogos = {}) {
	const valores = {};
	const errores = [];
	for (const c of pestana.columnas) {
		const r = valorParaBase(c, fila ? fila[c.name] : undefined);
		if (r.error) {
			errores.push(r.error);
			continue;
		}
		valores[c.name] = r.valor;
	}
	if (errores.length) return { valores, errores };

	if (valores.Desde != null && valores.Hasta != null && valores.Desde > valores.Hasta) {
		errores.push('"Desde" no puede ser mayor que "Hasta"');
	}
	const letra = columna(pestana, 'ValorLetra');
	if (letra && catalogos.letras && !catalogos.letras.has(String(valores.ValorLetra).trim())) {
		errores.push(`La letra "${String(valores.ValorLetra).trim()}" no existe en el catálogo de letras`);
	}
	if (columna(pestana, 'Funcion') && catalogos.funciones && valores.Funcion != null && !catalogos.funciones.has(valores.Funcion)) {
		errores.push(`La función ${valores.Funcion} no existe`);
	}
	return { valores, errores };
}

function textoClaveUnica(pestana, valores) {
	return JSON.stringify(pestana.unica.map((k) => (typeof valores[k] === 'string' ? valores[k].trim() : valores[k] ?? null)));
}

function describirClave(pestana, valores) {
	return pestana.unica
		.map((k) => {
			const c = columna(pestana, k);
			let v = valores[k];
			if (c.kind === 'flag') v = Number(v) === 1 ? 'sí' : 'no';
			if (typeof v === 'string') v = v.trim() || '(vacío)';
			return `${c.label} ${v ?? '—'}`;
		})
		.join(', ');
}

const MAX_OPERACIONES_LOTE = 20000;

/**
 * Valida el lote { altas, cambios, bajas } y lo deja listo para guardar.
 * Lanza 400 con `detalles` (una entrada por fila con problema).
 */
function planificarLote(pestana, lote, catalogos = {}) {
	const altasIn = Array.isArray(lote?.altas) ? lote.altas : [];
	const cambiosIn = Array.isArray(lote?.cambios) ? lote.cambios : [];
	const bajasIn = Array.isArray(lote?.bajas) ? lote.bajas : [];
	const total = altasIn.length + cambiosIn.length + bajasIn.length;
	if (total === 0) throw errorHttp('No hay cambios para guardar');
	if (total > MAX_OPERACIONES_LOTE) {
		throw errorHttp(`Demasiados cambios juntos (máximo ${MAX_OPERACIONES_LOTE}). Guardá en partes.`);
	}

	const detalles = [];
	const idsTocados = new Set();
	const tomarId = (id, donde) => {
		const k = String(id);
		if (idsTocados.has(k)) detalles.push(`${donde}: la misma fila aparece dos veces en el lote`);
		idsTocados.add(k);
		return claveDeId(pestana, id);
	};

	const bajas = bajasIn.map((id, i) => {
		try {
			return tomarId(id, `Baja ${i + 1}`);
		} catch (e) {
			detalles.push(`Baja ${i + 1}: ${e.message}`);
			return null;
		}
	});

	const cambios = cambiosIn.map((f, i) => {
		let clave = null;
		try {
			clave = tomarId(f?._id, `Cambio ${i + 1}`);
		} catch (e) {
			detalles.push(`Cambio ${i + 1}: ${e.message}`);
		}
		const { valores, errores } = normalizarFila(pestana, f, catalogos);
		errores.forEach((m) => detalles.push(`Fila modificada ${i + 1}: ${m}`));
		return { clave, valores };
	});

	const altas = altasIn.map((f, i) => {
		const { valores, errores } = normalizarFila(pestana, f, catalogos);
		errores.forEach((m) => detalles.push(`Fila nueva ${i + 1}: ${m}`));
		return valores;
	});

	if (!detalles.length) {
		const vistas = new Map();
		const revisar = (valores, donde) => {
			const k = textoClaveUnica(pestana, valores);
			if (vistas.has(k)) {
				detalles.push(`${donde} repite ${describirClave(pestana, valores)} (igual que ${vistas.get(k)})`);
			} else vistas.set(k, donde);
		};
		cambios.forEach((c, i) => revisar(c.valores, `Fila modificada ${i + 1}`));
		altas.forEach((v, i) => revisar(v, `Fila nueva ${i + 1}`));
	}

	if (detalles.length) {
		throw errorHttp(
			detalles.length === 1 ? detalles[0] : `Hay ${detalles.length} problemas en los cambios`,
			400,
			{ detalles: detalles.slice(0, 50) },
		);
	}
	return { altas, cambios, bajas };
}

/** Parte un array en tandas que respetan el límite de 2.100 parámetros de SQL Server. */
function enTandas(items, paramsPorItem, maxParams = 2000) {
	const tam = Math.max(1, Math.floor(maxParams / Math.max(1, paramsPorItem)));
	const out = [];
	for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam));
	return out;
}

// ─── Cabecera ──────────────────────────────────────────────────────────────

const CABECERA = [
	col('Valor', 'Int', { label: 'Obra social', required: true, min: 0 }),
	col('Descripcion', 'VarChar', { length: 40, label: 'Descripción', required: true }),
	col('VigenciaDesde', 'Int', { kind: 'fecha', label: 'Vigencia desde', defecto: 0 }),
	col('VigenciaHasta', 'Int', { kind: 'fecha', label: 'Vigencia hasta', defecto: 0 }),
	col('TipoValor', 'TinyInt', { label: 'Tipo de valor', defecto: 0 }),
	col('CatProfesional', 'TinyInt', { kind: 'categoria', label: 'Categoría profesional', defecto: 0 }),
	col('CoberturaHonorarios', 'Money', { kind: 'importe', label: 'Cobertura honorarios', defecto: 0, min: 0 }),
	col('CoberturaGastos', 'Money', { kind: 'importe', label: 'Cobertura gastos', defecto: 0, min: 0 }),
	col('CoberturaMedicamentos', 'Money', { kind: 'importe', label: 'Cobertura medicamentos', defecto: 0, min: 0 }),
	col('CoberturaDescartables', 'Money', { kind: 'importe', label: 'Cobertura descartables', defecto: 0, min: 0 }),
	col('PrecioMedicamentos', 'Money', { kind: 'importe', label: 'Precio medicamentos', defecto: 0, min: 0 }),
	col('AplicaPrecioMed', 'Char', { length: 1, label: 'Aplica precio medicamentos', defecto: '' }),
	col('MedicamTotal', 'Money', { kind: 'importe', label: 'Medicamentos total', defecto: 0, min: 0 }),
	col('MedicamSobre', 'VarChar', { length: 3, label: 'Medicamentos sobre', defecto: '' }),
	col('DescartTotal', 'Money', { kind: 'importe', label: 'Descartables total', defecto: 0, min: 0 }),
	col('DescartSobre', 'Char', { length: 3, label: 'Descartables sobre', defecto: '' }),
	col('MultiConvenio', 'Bit', { kind: 'flag', label: 'Multiconvenio', defecto: 0, max: 1 }),
];

/** Fila de imClientesConvenios → cabecera de la API (fechas ISO, textos sin relleno). */
function cabeceraApi(fila) {
	const out = { Codigo: Number(fila.Codigo) };
	for (const c of CABECERA) {
		const v = fila[c.name];
		if (c.kind === 'fecha') out[c.name] = clarionAIsoCalendario(v);
		else out[c.name] = valorDeBase(c, v);
	}
	out.MultiConvenio = out.MultiConvenio == null ? 0 : out.MultiConvenio;
	return out;
}

/** Cabecera de la API → valores para guardar. Lanza 400 con `detalles`. */
function normalizarCabecera(body) {
	const valores = {};
	const detalles = [];
	for (const c of CABECERA) {
		let crudo = body ? body[c.name] : undefined;
		if (c.kind === 'fecha') {
			if (crudo === null || crudo === undefined || String(crudo).trim() === '') {
				valores[c.name] = 0;
				continue;
			}
			if (!/^\d{4}-\d{2}-\d{2}$/.test(String(crudo))) {
				detalles.push(`${c.label}: fecha inválida`);
				continue;
			}
			crudo = convertirFechaAClarion(String(crudo));
		}
		const r = valorParaBase(c, crudo);
		if (r.error) detalles.push(r.error);
		else valores[c.name] = r.valor;
	}
	if (!detalles.length && valores.VigenciaDesde > 0 && valores.VigenciaHasta > 0 && valores.VigenciaHasta < valores.VigenciaDesde) {
		detalles.push('La vigencia "hasta" no puede ser anterior a "desde"');
	}
	if (!detalles.length && valores.VigenciaHasta > 0 && !valores.VigenciaDesde) {
		detalles.push('Para cargar vigencia "hasta" primero indicá "desde"');
	}
	if (detalles.length) {
		throw errorHttp(detalles.length === 1 ? detalles[0] : 'Revisá los datos del convenio', 400, { detalles });
	}
	return valores;
}

/**
 * Estado de vigencia con las fechas Clarion de la cabecera.
 * 'sin_vigencia' | 'futuro' | 'vigente' | 'vencido'
 */
function estadoVigencia(desde, hasta, hoy) {
	const d = Number(desde) || 0;
	const h = Number(hasta) || 0;
	if (!d) return 'sin_vigencia';
	if (hoy < d) return 'futuro';
	if (h && hoy > h) return 'vencido';
	return 'vigente';
}

/** Expresión SQL equivalente a estadoVigencia (con @hoy en fecha Clarion). */
const SQL_ESTADO_VIGENCIA = `CASE
	WHEN ISNULL(c.VigenciaDesde, 0) = 0 THEN 'sin_vigencia'
	WHEN @hoy < c.VigenciaDesde THEN 'futuro'
	WHEN ISNULL(c.VigenciaHasta, 0) <> 0 AND @hoy > c.VigenciaHasta THEN 'vencido'
	ELSE 'vigente' END`;

// ─── Ajuste masivo ─────────────────────────────────────────────────────────

/** Valida { porcentaje, pestanas, funcion, desde, hasta } del ajuste masivo. */
function normalizarAjuste(body) {
	const porcentaje = aNumero(body?.porcentaje);
	if (porcentaje === null || Number.isNaN(porcentaje)) throw errorHttp('Indicá el porcentaje de ajuste');
	if (porcentaje === 0) throw errorHttp('El porcentaje no puede ser 0');
	if (porcentaje <= -100) throw errorHttp('El porcentaje tiene que ser mayor a -100');
	if (porcentaje > 1000) throw errorHttp('El porcentaje no puede superar 1000');

	const pestanas = Array.isArray(body?.pestanas) && body.pestanas.length ? body.pestanas.map(String) : IDS_PESTANAS;
	pestanas.forEach(pestanaPorId);

	const funcion = aNumero(body?.funcion);
	const desde = aNumero(body?.desde);
	const hasta = aNumero(body?.hasta);
	for (const [n, v] of [
		['Función', funcion],
		['Desde', desde],
		['Hasta', hasta],
	]) {
		if (Number.isNaN(v) || (v !== null && (!Number.isInteger(v) || v < 0))) throw errorHttp(`${n}: valor inválido`);
	}
	if (desde !== null && hasta !== null && desde > hasta) throw errorHttp('"Desde" no puede ser mayor que "Hasta"');

	return { porcentaje, factor: 1 + porcentaje / 100, pestanas: [...new Set(pestanas)], funcion, desde, hasta };
}

module.exports = {
	PESTANAS,
	IDS_PESTANAS,
	CABECERA,
	SQL_ESTADO_VIGENCIA,
	errorHttp,
	pestanaPorId,
	columna,
	filtroPestana,
	tipoSqlTexto,
	valorParaBase,
	idDeFila,
	claveDeId,
	filaApi,
	normalizarFila,
	planificarLote,
	describirClave,
	enTandas,
	cabeceraApi,
	normalizarCabecera,
	estadoVigencia,
	normalizarAjuste,
};
