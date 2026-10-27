const test = require('node:test');
const assert = require('node:assert/strict');
const fechas = require('../src/asistente/fechas');
const { agenteLoop } = require('../src/asistente/loop');
const clinica = require('../src/asistente/clinica');

test('fechas: ISO pasa a DD/MM/AAAA, con hora si la trae', () => {
	assert.equal(fechas.aArgentina('2026-02-23'), '23/02/2026');
	assert.equal(fechas.aArgentina('2026-02-23 23:51'), '23/02/2026 23:51');
	assert.equal(fechas.aArgentina('2026-02-22T18:29:00.000Z'), '22/02/2026 18:29');
	assert.equal(
		fechas.aArgentina('No hay indicaciones cargadas el 2026-10-13 (vigentes desde 2026-02-13).'),
		'No hay indicaciones cargadas el 13/10/2026 (vigentes desde 13/02/2026).',
	);
	assert.equal(fechas.aArgentina('DNI 27358698, visita 408094'), 'DNI 27358698, visita 408094');
});

test('fechas: links y rutas quedan como están', () => {
	const r = fechas.paraModelo({
		fechaUltimo: '2026-02-23 23:51',
		link: { path: '/dashboard/beds?date=2026-02-23', label: 'ver' },
		url: '/api/x?date=2026-02-23',
		registros: [{ FechaControl: '2026-02-23', texto: 'ver /dashboard/x?date=2026-02-23' }],
		n: 71,
	});
	assert.equal(r.fechaUltimo, '23/02/2026 23:51');
	assert.equal(r.link.path, '/dashboard/beds?date=2026-02-23');
	assert.equal(r.url, '/api/x?date=2026-02-23');
	assert.equal(r.registros[0].FechaControl, '23/02/2026');
	assert.equal(r.registros[0].texto, 'ver /dashboard/x?date=2026-02-23');
	assert.equal(r.n, 71);
});

test('fechas: el modelo puede devolver DD/MM/AAAA a las tools', () => {
	assert.equal(fechas.aIso('23/02/2026'), '2026-02-23');
	assert.equal(fechas.aIso('3/2/2026'), '2026-02-03');
	assert.equal(fechas.aIso('2026-02-23'), '2026-02-23');
	assert.equal(fechas.aIso('31/13/2026'), null);
	assert.equal(clinica.fechaValida('23/02/2026'), '2026-02-23');
	assert.match(clinica.fechaValida('ayer'), /^\d{4}-\d{2}-\d{2}$/);
});

test('loop: formatear cambia lo que ve el modelo, no el resultado de la tool', async () => {
	const resultado = { fecha: '2026-02-23' };
	let vistoPorModelo;
	let llamada = 0;
	await agenteLoop({
		messages: [],
		tools: [],
		ejecutar: async () => resultado,
		chat: async ({ messages }) => {
			llamada += 1;
			if (llamada === 1) return { content: null, toolCalls: [{ id: 't1', function: { name: 'x', arguments: '{}' } }] };
			vistoPorModelo = messages.find((m) => m.role === 'tool').content;
			return { content: 'ok', toolCalls: [] };
		},
		formatear: fechas.paraModelo,
	});
	assert.equal(JSON.parse(vistoPorModelo).fecha, '23/02/2026');
	assert.equal(resultado.fecha, '2026-02-23');
});
