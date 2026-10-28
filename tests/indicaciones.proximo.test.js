/**
 * Próximo = última aplicación + intervalo. Intervalo de imFrecuenciasAdmin
 * es Clarion TIME; si se suma como minutos el próximo salta a nov/dic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql) => {
			const q = String(sql);
			if (/FROM imFrecuenciasAdmin/i.test(q)) {
				return [{ Intervalo: 2160001 }];
			}
			return [];
		},
	},
};

const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	clarionAIsoCalendario,
	convertirHoraClarionAString,
} = require(src('utils/dateUtils.js'));
const servicio = require(src('services/indicaciones.service.js'));

test('CADA 2 HS = 120 minutos (regex, sin pasar por el catálogo)', async () => {
	assert.equal(await servicio.obtenerIntervaloFrecuencia('CADA 2 HS'), 120);
});

test('4 VECES P/DIA = 360 minutos', async () => {
	assert.equal(await servicio.obtenerIntervaloFrecuencia('4 VECES P/DIA'), 360);
});

test('1 VEZ AL DIA = 1440 minutos', async () => {
	assert.equal(await servicio.obtenerIntervaloFrecuencia('1 VEZ AL DIA'), 1440);
});

test('2 VECES P/DIA = 720 minutos', async () => {
	assert.equal(await servicio.obtenerIntervaloFrecuencia('2 VECES P/DIA'), 720);
});

test('28 GTS (X MIN) usa Intervalo Clarion del catálogo convertido a minutos', async () => {
	assert.equal(await servicio.obtenerIntervaloFrecuencia('28 GTS (X MIN)'), 360);
});

test('aplicar a las 10:00 con 4/24 hs marca próximo 16:00 el mismo día', () => {
	const fecha = convertirFechaAClarion('2026-10-28');
	const hora = convertirHoraAClarion('10:00:00');
	const r = servicio.calcularProximaAplicacion(fecha, hora, 360);
	assert.equal(clarionAIsoCalendario(r.fechaProximo), '2026-10-28');
	assert.equal(convertirHoraClarionAString(r.horaProximo), '16:00:00');
});

test('aplicar a las 22:00 con lapso de 6 hs marca próximo 04:00 del día siguiente', () => {
	const fecha = convertirFechaAClarion('2026-10-28');
	const hora = convertirHoraAClarion('22:00:00');
	const r = servicio.calcularProximaAplicacion(fecha, hora, 360);
	assert.equal(clarionAIsoCalendario(r.fechaProximo), '2026-10-29');
	assert.equal(convertirHoraClarionAString(r.horaProximo), '04:00:00');
});

test('CADA 2 HS a las 15:01 marca próximo 17:01 (sin restar UTC-3)', () => {
	const fecha = convertirFechaAClarion('2026-10-26');
	const hora = convertirHoraAClarion('15:01:00');
	const r = servicio.calcularProximaAplicacion(fecha, hora, 120);
	assert.equal(clarionAIsoCalendario(r.fechaProximo), '2026-10-26');
	assert.equal(convertirHoraClarionAString(r.horaProximo), '17:01:00');
});
