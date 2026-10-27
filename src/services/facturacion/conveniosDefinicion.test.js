const test = require('node:test');
const assert = require('node:assert');
const def = require('./conveniosDefinicion');

const { PESTANAS } = def;
const catalogos = { letras: new Set(['A', 'B']), funciones: new Set([0, 1, 7]) };

const filaNomenc = (extra = {}) => ({
	Desde: 420101,
	Hasta: 420101,
	Funcion: 0,
	TipoValor: '$',
	Valor: 100,
	Ambulatorio: 1,
	Internacion: 1,
	...extra,
});

test('valorParaBase: defectos, vacíos y TipoValor', () => {
	const tipo = def.columna(PESTANAS.nomenclador, 'TipoValor');
	assert.deepStrictEqual(def.valorParaBase(tipo, undefined), { valor: '$' });
	assert.deepStrictEqual(def.valorParaBase(tipo, ''), { valor: ' ' }, 'vacío es una opción elegida, no el defecto');
	assert.deepStrictEqual(def.valorParaBase(tipo, '%'), { valor: '%' });
	assert.ok(def.valorParaBase(tipo, 'X').error);

	const funcion = def.columna(PESTANAS.nomenclador, 'Funcion');
	assert.deepStrictEqual(def.valorParaBase(funcion, ''), { valor: 0 });
	assert.ok(def.valorParaBase(funcion, 1.5).error);
	assert.ok(def.valorParaBase(funcion, 300).error);
});

test('valorParaBase: redondeo y rangos de decimal/money', () => {
	const cat = def.columna(PESTANAS.nomenclador, 'CategoriaA');
	assert.deepStrictEqual(def.valorParaBase(cat, '12,345'), { valor: 12.35 });
	assert.ok(def.valorParaBase(cat, 100000).error, 'decimal(7,2) no admite 100000');
	const valor = def.columna(PESTANAS.nomenclador, 'Valor');
	assert.deepStrictEqual(def.valorParaBase(valor, 1.234567), { valor: 1.23 }, 'los importes quedan con 2 decimales');
	assert.deepStrictEqual(def.valorParaBase(def.columna(PESTANAS.moduladas, 'Valor'), '3167,125'), { valor: 3167.13 });
	assert.deepStrictEqual(def.valorParaBase(def.columna(PESTANAS.valores, 'ValorGaleno'), 80248.789), { valor: 80248.79 });
	assert.ok(def.valorParaBase(valor, -1).error);
	assert.ok(def.valorParaBase(valor, 'abc').error);
});

test('vademécum y genéricos se reparten imClientesConvVadem por troquel', () => {
	assert.strictEqual(PESTANAS.vademecum.tabla, PESTANAS.genericos.tabla);
	assert.strictEqual(def.filtroPestana(PESTANAS.genericos, 'h'), ' AND h.Troquel = 0');
	assert.strictEqual(def.filtroPestana(PESTANAS.nomenclador), '');

	const generico = { Descripcion: 'IBUPROFENO 400', TipoValor: '$', Valor: 10, Ambulatorio: 1, Internacion: 1 };
	const ok = def.normalizarFila(PESTANAS.genericos, generico);
	assert.deepStrictEqual(ok.errores, []);
	assert.strictEqual(ok.valores.Troquel, 0, 'el troquel de un genérico es siempre 0');
	assert.ok(def.normalizarFila(PESTANAS.genericos, { ...generico, Troquel: 5 }).errores.length);
	assert.ok(def.normalizarFila(PESTANAS.genericos, { ...generico, Descripcion: ' ' }).errores.length);
	assert.ok(def.normalizarFila(PESTANAS.vademecum, { ...generico, Troquel: 0 }).errores.length, 'troquel 0 va en Genéricos');
});

test('idDeFila / claveDeId ida y vuelta', () => {
	assert.strictEqual(def.idDeFila(PESTANAS.nomenclador, { Id: 55 }), '55');
	assert.deepStrictEqual(def.claveDeId(PESTANAS.nomenclador, '55'), { Id: 55 });
	assert.throws(() => def.claveDeId(PESTANAS.nomenclador, 'x'), /inválido/);

	const fila = { ValorLetra: 'A', Ambulatorio: 1, Internacion: 0 };
	const id = def.idDeFila(PESTANAS.valores, fila);
	assert.deepStrictEqual(def.claveDeId(PESTANAS.valores, id), fila);
	assert.throws(() => def.claveDeId(PESTANAS.valores, '[1]'), /inválido/);
});

test('filaApi recorta el relleno de char', () => {
	const f = def.filaApi(PESTANAS.vademecum, { Troquel: 1, Descripcion: 'X   ', TipoValor: '$', Valor: '10.5', Ambulatorio: true, Internacion: false });
	assert.deepStrictEqual(f, { _id: '[1,"X   "]', Troquel: 1, Descripcion: 'X', TipoValor: '$', Valor: 10.5, Ambulatorio: 1, Internacion: 0 });
});

test('normalizarFila valida rango, letra y función', () => {
	assert.deepStrictEqual(def.normalizarFila(PESTANAS.nomenclador, filaNomenc(), catalogos).errores, []);
	assert.match(def.normalizarFila(PESTANAS.nomenclador, filaNomenc({ Desde: 5, Hasta: 1 }), catalogos).errores[0], /Desde/);
	assert.match(def.normalizarFila(PESTANAS.nomenclador, filaNomenc({ Funcion: 9 }), catalogos).errores[0], /función 9/);
	assert.match(def.normalizarFila(PESTANAS.valores, { ValorLetra: 'z' }, catalogos).errores[0], /letra "Z"/);
});

test('planificarLote: lote vacío, ids repetidos y duplicados dentro del lote', () => {
	assert.throws(() => def.planificarLote(PESTANAS.nomenclador, {}, catalogos), /No hay cambios/);
	assert.throws(
		() => def.planificarLote(PESTANAS.nomenclador, { bajas: ['1'], cambios: [{ ...filaNomenc(), _id: '1' }] }, catalogos),
		(e) => e.statusCode === 400 && e.detalles.some((d) => /dos veces/.test(d)),
	);
	assert.throws(
		() => def.planificarLote(PESTANAS.nomenclador, { altas: [filaNomenc(), filaNomenc({ Valor: 5 })] }, catalogos),
		(e) => e.detalles.some((d) => /repite/.test(d)),
	);
	const plan = def.planificarLote(
		PESTANAS.nomenclador,
		{ altas: [filaNomenc()], cambios: [{ ...filaNomenc({ Funcion: 1 }), _id: '7' }], bajas: ['8'] },
		catalogos,
	);
	assert.strictEqual(plan.altas.length, 1);
	assert.deepStrictEqual(plan.cambios[0].clave, { Id: 7 });
	assert.deepStrictEqual(plan.bajas, [{ Id: 8 }]);
	assert.strictEqual(plan.altas[0].NoCubre, 0);
});

test('enTandas respeta el límite de parámetros', () => {
	const tandas = def.enTandas(Array.from({ length: 450 }, (_, i) => i), 15, 2000);
	assert.deepStrictEqual(tandas.map((t) => t.length), [133, 133, 133, 51]);
});

test('normalizarCabecera: fechas ISO a Clarion y vigencia coherente', () => {
	const base = { Valor: 2, Descripcion: 'Abril', VigenciaDesde: '2026-04-01', VigenciaHasta: '2026-04-30' };
	const v = def.normalizarCabecera(base);
	assert.strictEqual(v.VigenciaHasta - v.VigenciaDesde, 29);
	assert.strictEqual(v.MultiConvenio, 0);
	const api = def.cabeceraApi({ Codigo: 1, ...v });
	assert.strictEqual(api.VigenciaDesde, '2026-04-01');

	assert.strictEqual(def.normalizarCabecera({ ...base, VigenciaDesde: '', VigenciaHasta: '' }).VigenciaDesde, 0);
	assert.throws(() => def.normalizarCabecera({ ...base, VigenciaHasta: '2026-03-01' }), /anterior/);
	assert.throws(() => def.normalizarCabecera({ ...base, VigenciaDesde: '' }), /primero/);
	assert.throws(() => def.normalizarCabecera({ ...base, Descripcion: '' }), /obligatori/);
});

test('estadoVigencia', () => {
	assert.strictEqual(def.estadoVigencia(0, 0, 100), 'sin_vigencia');
	assert.strictEqual(def.estadoVigencia(200, 0, 100), 'futuro');
	assert.strictEqual(def.estadoVigencia(50, 0, 100), 'vigente');
	assert.strictEqual(def.estadoVigencia(50, 99, 100), 'vencido');
	assert.strictEqual(def.estadoVigencia(50, 100, 100), 'vigente');
});

test('normalizarAjuste', () => {
	const a = def.normalizarAjuste({ porcentaje: '10,5', pestanas: ['nomenclador', 'nomenclador'] });
	assert.strictEqual(a.factor, 1.105);
	assert.deepStrictEqual(a.pestanas, ['nomenclador']);
	assert.strictEqual(a.funcion, null);
	assert.throws(() => def.normalizarAjuste({ porcentaje: 0 }), /0/);
	assert.throws(() => def.normalizarAjuste({ porcentaje: -100 }), /-100/);
	assert.throws(() => def.normalizarAjuste({ porcentaje: 5, desde: 10, hasta: 1 }), /Desde/);
	assert.throws(() => def.normalizarAjuste({ porcentaje: 5, pestanas: ['nada'] }), /desconocida/);
});
