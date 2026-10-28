/**
 * "Vigente desde" es la primera indicación de la cadena (NroIndicacionAnterior),
 * no la FechaCarga de la copia diaria al reindicar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
	path.join(__dirname, '..', 'src', 'services', 'indicaciones.service.js'),
	'utf8',
);

function vigenteDesdeCadena(nro, filas) {
	const porNro = new Map(filas.map((f) => [f.nro, f]));
	const vistos = new Set();
	let cur = nro;
	let ultimo = porNro.get(cur);
	while (cur && !vistos.has(cur)) {
		vistos.add(cur);
		const row = porNro.get(cur);
		if (!row) break;
		ultimo = row;
		const ant = Number(row.anterior) || 0;
		if (ant <= 0) break;
		cur = ant;
	}
	return ultimo;
}

test('la consulta de cama recorre NroIndicacionAnterior hasta la original', () => {
	assert.match(src, /cadenaVigente/);
	assert.match(src, /origenVigente/);
	assert.match(src, /NroIndicacionAnterior/);
	assert.match(src, /FechaVigente/);
	assert.match(src, /HoraVigente/);
	assert.match(src, /COALESCE\(NULLIF\(origenVigente\.FechaVigente/);
});

test('reindicada varios días: vigente es la primera carga, no la de hoy', () => {
	const filas = [
		{ nro: 30, anterior: 20, fecha: '2026-10-28', hora: '20:45:00' },
		{ nro: 20, anterior: 10, fecha: '2026-10-27', hora: '20:51:00' },
		{ nro: 10, anterior: 0, fecha: '2026-10-16', hora: '08:12:00' },
	];
	const orig = vigenteDesdeCadena(30, filas);
	assert.equal(orig.fecha, '2026-10-16');
	assert.equal(orig.hora, '08:12:00');
});

test('indicación nueva (sin anterior) usa su propia fecha/hora', () => {
	const orig = vigenteDesdeCadena(1, [
		{ nro: 1, anterior: 0, fecha: '2026-10-28', hora: '11:02:00' },
	]);
	assert.equal(orig.fecha, '2026-10-28');
	assert.equal(orig.hora, '11:02:00');
});
