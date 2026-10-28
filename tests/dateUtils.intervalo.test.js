const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
	clarionTimeAMinutos,
	sumarMinutosAFechaHoraWall,
	convertirFechaAClarion,
	convertirHoraAClarion,
	clarionAIsoCalendario,
	convertirHoraClarionAString,
} = require(path.join(__dirname, '..', 'src', 'utils', 'dateUtils.js'));

test('4/24 hs (Clarion 2.160.001) son 360 minutos, no 2.160.001 minutos', () => {
	assert.equal(clarionTimeAMinutos(2160001), 360);
	assert.equal(clarionTimeAMinutos(2160000), 360);
	assert.equal(clarionTimeAMinutos(8640001), 1440);
	assert.equal(clarionTimeAMinutos(2880001), 480);
});

test('sumar 6 hs a las 10:00 queda el mismo día a las 16:00 (no cruza a diciembre)', () => {
	const next = sumarMinutosAFechaHoraWall('2026-10-28', '10:00:00', 360);
	assert.deepEqual(next, { fecha: '2026-10-28', hora: '16:00:00' });
});

test('sumar 6 hs a las 22:00 pasa al día siguiente a las 04:00', () => {
	const next = sumarMinutosAFechaHoraWall('2026-10-28', '22:00:00', 360);
	assert.deepEqual(next, { fecha: '2026-10-29', hora: '04:00:00' });
});

test('el bug de tratar Intervalo Clarion como minutos caería ~1500 días después', () => {
	const mal = sumarMinutosAFechaHoraWall('2026-10-28', '10:00:00', 2160000);
	assert.equal(mal.fecha, '2030-12-06');
	const bien = sumarMinutosAFechaHoraWall('2026-10-28', '10:00:00', clarionTimeAMinutos(2160001));
	assert.equal(bien.fecha, '2026-10-28');
	assert.equal(bien.hora, '16:00:00');
});

test('ida y vuelta Clarion de 10:00 + 6 hs = 16:00', () => {
	const fecha = convertirFechaAClarion('2026-10-28');
	const hora = convertirHoraAClarion('10:00:00');
	assert.ok(fecha > 0);
	assert.ok(hora > 0);
	assert.equal(clarionAIsoCalendario(fecha), '2026-10-28');
	assert.equal(convertirHoraClarionAString(hora), '10:00:00');
});
