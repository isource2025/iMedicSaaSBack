/**
 * Protocolos con varias prácticas: cada práctica de la cirugía va a imFacPracticas por
 * IdProtocolo con su propio equipo; la fecha de la práctica es la de fin del procedimiento.
 * Acá se prueban los helpers puros (sin SQL).
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
	exports: { executeQuery: async () => [], getRequestPool: async () => ({}), sql: {} },
};

const svc = require(src('services/protocolos.service.js'));

test('fecha de pared "datetime-local" → Clarion sin corrimiento de zona', () => {
	const r = svc._parseFechaHora('2026-10-08T14:30', 'x');
	assert.equal(r.fecha, '2026-10-08');
	assert.equal(r.hora, '14:30:00');
	// 14:30:00 → (14*3600+30*60)*100 + 1 centésimas
	assert.equal(r.clarionHora, 14 * 360000 + 30 * 6000 + 1);
	// Date para tedious: la hora argentina en los campos UTC.
	assert.equal(r.wall.toISOString(), '2026-10-08T14:30:00.000Z');
	assert.equal(svc._parseFechaHora('', 'x'), null);
	assert.equal(svc._parseFechaHora(null, 'x'), null);
	assert.throws(() => svc._parseFechaHora('ayer', 'Fecha'), /Fecha inválida\. Revisá día y hora\./);
});

test('fin obligatorio; la práctica toma fecha de fin y hora de inicio si la hay', () => {
	assert.throws(
		() => svc._resolverFechasProcedimiento({ fechaHoraInicio: '2026-10-08T10:00', fechaHoraFin: '' }),
		/Falta la fecha y hora de fin/,
	);
	const soloFin = svc._resolverFechasProcedimiento({ fechaHoraFin: '2026-10-08T12:15' });
	assert.equal(soloFin.inicio, null);
	assert.equal(soloFin.horaInicio, soloFin.horaFin);

	const ambos = svc._resolverFechasProcedimiento({
		fechaHoraInicio: '2026-10-07T23:30',
		fechaHoraFin: '2026-10-08T01:10',
	});
	assert.equal(ambos.fechaPractica, svc._parseFechaHora('2026-10-08', 'x').clarionFecha);
	assert.equal(ambos.horaInicio, svc._parseFechaHora('2026-10-07T23:30', 'x').clarionHora);
	assert.equal(ambos.horaFin, svc._parseFechaHora('2026-10-08T01:10', 'x').clarionHora);

	assert.throws(
		() =>
			svc._resolverFechasProcedimiento({
				fechaHoraInicio: '2026-10-08T15:00',
				fechaHoraFin: '2026-10-08T14:00',
			}),
		/inicio es posterior al fin/,
	);
});

test('normaliza N prácticas con equipos distintos y acepta el payload viejo de una sola', () => {
	const lista = svc._normalizarPracticas({
		practicas: [
			{ idPractica: 420101, tipoPractica: 'no', profesionales: [{ valorPersonal: 10, funcion: 1 }] },
			{
				valorPractica: 973000,
				idPractica: 420102,
				tipoPractica: 'MO',
				cantidad: 2,
				profesionales: [
					{ valorPersonal: 10, funcion: 1 },
					{ valorPersonal: 11, funcion: 2 },
					{ valorPersonal: 12, funcion: 4 },
				],
			},
		],
	});
	assert.equal(lista.length, 2);
	assert.deepEqual(lista[0], {
		valorPractica: null,
		idPractica: 420101,
		tipoPractica: 'NO',
		cantidad: 1,
		profesionales: [{ valorPersonal: 10, funcion: 1 }],
	});
	assert.equal(lista[1].valorPractica, 973000);
	assert.equal(lista[1].cantidad, 2);
	assert.equal(lista[1].profesionales.length, 3);

	const viejo = svc._normalizarPracticas({
		idPractica: 1,
		tipoPractica: 'NO',
		profesionales: [{ valorPersonal: 5, funcion: 1 }],
	});
	assert.equal(viejo.length, 1);
	assert.equal(viejo[0].idPractica, 1);

	assert.equal(svc._normalizarPracticas({}), null);
	assert.throws(() => svc._normalizarPracticas({ practicas: [] }), /al menos una práctica/);
	assert.throws(
		() => svc._normalizarPracticas({ practicas: [{ idPractica: 7, profesionales: [] }] }),
		/Práctica 1: no tiene equipo/,
	);
	// Existente (valorPractica) sin equipo: se admite acá; actualizarProtocolo decide según facturación.
	const existenteSinEquipo = svc._normalizarPracticas({
		practicas: [{ valorPractica: 973116, idPractica: 130102, profesionales: [] }],
	});
	assert.equal(existenteSinEquipo[0].profesionales.length, 0);
	assert.throws(
		() =>
			svc._normalizarPracticas({
				practicas: [{ idPractica: 7, tipoPractica: 'XX', profesionales: [{ valorPersonal: 1, funcion: 1 }] }],
			}),
		/MO o NO/,
	);
	assert.throws(
		() =>
			svc._normalizarPracticas({
				practicas: [{ idPractica: 7, cantidad: 0, profesionales: [{ valorPersonal: 1, funcion: 1 }] }],
			}),
		/cantidad debe ser un número entre 1 y 999/,
	);
});

test('medicamentos: rubro como lo graba el escritorio (STRING 15) y orden de a 10', () => {
	const meds = svc._normalizarMedicamentos([
		{ idProducto: 9958083, rubro: 'Descartable', cantidad: 2, unidad: 'UNIDADES', descripcion: 'SOLUC. FISIOL.' },
		{ idProducto: 9943020, rubro: 'medicamento', cantidad: '' },
		{ idProducto: 1002, rubro: 'DESC' },
	]);
	assert.equal(meds[0].rubro, 'Descartable    ');
	assert.equal(meds[0].rubro.length, 15);
	assert.equal(meds[0].orden, 10);
	assert.equal(meds[1].rubro, 'Medicamento    ');
	assert.equal(meds[1].cantidad, null);
	assert.equal(meds[1].orden, 20);
	assert.equal(meds[2].rubro, 'Descartable    ');
	assert.equal(svc._normalizarMedicamentos(undefined), null);
	assert.deepEqual(svc._normalizarMedicamentos([]), []);
	assert.throws(() => svc._normalizarMedicamentos([{ idProducto: 0 }]), /no está identificado/);
});
