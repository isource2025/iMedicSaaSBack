/**
 * Partes puras de la producción hospitalaria: validación de filtros, períodos,
 * granularidad y armado de la consulta. No toca la base.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../src/services/produccionHospital.service');
const matriz = require('../src/utils/permisos');

const ESQUEMA = { liquidado: true, noFacturable: true };

function filtrosBase(extra = {}) {
	return svc.normalizarFiltros({ fechaInicio: '2026-01-01', fechaFin: '2026-01-31', ...extra });
}

test('por defecto trae sólo lo valorizado', () => {
	const f = filtrosBase();
	assert.equal(f.soloValorizadas, true);
	assert.equal(f.liquidacion, 'todas');
});

test('soloValorizadas=false permite ver todo', () => {
	assert.equal(filtrosBase({ soloValorizadas: 'false' }).soloValorizadas, false);
	assert.equal(filtrosBase({ soloValorizadas: '0' }).soloValorizadas, false);
	assert.equal(filtrosBase({ soloValorizadas: 'true' }).soloValorizadas, true);
});

test('exige fechas y valida el formato', () => {
	assert.throws(() => svc.normalizarFiltros({}), (e) => e.statusCode === 400);
	assert.throws(
		() => svc.normalizarFiltros({ fechaInicio: '2026-13-01', fechaFin: '2026-01-31' }),
		(e) => e.statusCode === 400,
	);
	assert.throws(
		() => svc.normalizarFiltros({ fechaInicio: '01/01/2026', fechaFin: '2026-01-31' }),
		(e) => e.statusCode === 400,
	);
});

test('rechaza inicio mayor que fin, rango excesivo y fechas anteriores a 2000', () => {
	assert.throws(
		() => svc.normalizarFiltros({ fechaInicio: '2026-02-01', fechaFin: '2026-01-01' }),
		(e) => e.statusCode === 400,
	);
	assert.throws(
		() => svc.normalizarFiltros({ fechaInicio: '2020-01-01', fechaFin: '2026-01-01' }),
		(e) => e.statusCode === 400 && /1100/.test(e.message),
	);
	assert.throws(
		() => svc.normalizarFiltros({ fechaInicio: '1999-12-31', fechaFin: '2000-01-31' }),
		(e) => e.statusCode === 400,
	);
});

test('acota el fin a hoy (las fechas futuras son carga errónea)', () => {
	const f = svc.normalizarFiltros({ fechaInicio: '2026-01-01', fechaFin: '2099-12-31' });
	assert.equal(f.periodo.finAjustado, true);
	assert.ok(f.periodo.fin < '2099-12-31');
});

test('listas: enteros y códigos se validan y se deduplican', () => {
	const f = filtrosBase({ coberturas: '1,2,2,3', sectores: 'CM1,UTI' });
	assert.deepEqual(f.coberturas, [1, 2, 3]);
	assert.deepEqual(f.sectores, ['CM1', 'UTI']);
	assert.throws(() => filtrosBase({ coberturas: '1; DROP TABLE x' }), (e) => e.statusCode === 400);
	assert.throws(() => filtrosBase({ sectores: "A'B" }), (e) => e.statusCode === 400);
});

test('liquidacion sólo admite los valores conocidos', () => {
	assert.equal(filtrosBase({ liquidacion: 'liquidadas' }).liquidacion, 'liquidadas');
	assert.throws(() => filtrosBase({ liquidacion: 'cualquiera' }), (e) => e.statusCode === 400);
});

test('el período anterior tiene la misma duración y termina el día previo', () => {
	const f = filtrosBase();
	const previo = svc.periodoAnterior(f.periodo);
	assert.equal(previo.fin, '2025-12-31');
	assert.equal(previo.inicio, '2025-12-01');
	assert.equal(previo.dias, 31);
});

test('granularidad: día, semana o mes según el largo del rango', () => {
	assert.equal(svc.granularidadPara(30), 'dia');
	assert.equal(svc.granularidadPara(90), 'semana');
	assert.equal(svc.granularidadPara(365), 'mes');
});

test('la consulta filtra por estado valorizado por defecto y parametriza todo', () => {
	const f = filtrosBase({ coberturas: '5,6', sectores: 'CM1' });
	const { con, donde, params } = svc.construirConsulta(f.periodo, f, ESQUEMA);

	assert.match(con, /d\.TIPOPRESTACION = 'H'/, 'sólo honorarios: los gastos no son producción profesional');
	assert.match(con, /p\.FechaPractica BETWEEN @p0 AND @p1/, 'el rango va sobre el entero Clarion');
	assert.match(con, /COALESCE\(r\.idCliente, v\.CLIENTE\)/, 'cobertura: la de la rendición, si no la de la visita');
	assert.match(donde, /estado = 'V'/);
	assert.match(donde, /coberturaId IN \(@p2, @p3\)/);
	assert.match(donde, /sectorId IN \(@p4\)/);
	assert.deepEqual(
		params.map((x) => x.value).slice(2),
		[5, 6, 'CM1'],
		'los valores del usuario viajan como parámetros, nunca en el texto',
	);
	assert.doesNotMatch(donde, /CM1/);
});

test('con soloValorizadas=false no restringe el estado', () => {
	const f = filtrosBase({ soloValorizadas: 'false' });
	const { donde } = svc.construirConsulta(f.periodo, f, ESQUEMA);
	assert.equal(donde, '');
});

test('liquidadas / pendientes implican valorizadas', () => {
	for (const [liq, cond] of [
		['liquidadas', /liquidado IS NOT NULL/],
		['pendientes', /liquidado IS NULL/],
	]) {
		const f = filtrosBase({ soloValorizadas: 'false', liquidacion: liq });
		const { donde } = svc.construirConsulta(f.periodo, f, ESQUEMA);
		assert.match(donde, /estado = 'V'/);
		assert.match(donde, cond);
	}
});

test('sin columna ImporteLiquidado la consulta degrada a NULL en vez de fallar', () => {
	const f = filtrosBase();
	const { con } = svc.construirConsulta(f.periodo, f, { liquidado: false, noFacturable: false });
	assert.doesNotMatch(con, /ImporteLiquidado/);
	assert.doesNotMatch(con, /cli\.NoFacturable/);
});

test('sólo ADMIN y SUPER_ADMIN ven Reportes → Facturación', () => {
	const conPermiso = Object.entries(matriz.PLANTILLAS)
		.filter(([, lista]) => lista.includes('REPORTES.FACTURACION.VER'))
		.map(([rol]) => rol)
		.sort();
	assert.deepEqual(conPermiso, ['ADMIN', 'SUPER_ADMIN']);
});
