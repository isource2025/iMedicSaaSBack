const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrarEstudiosDeVisita, visitaDueniaDelEstudio } = require('../src/services/pacs.service');

const estudio = (uid, studyDate, accessionNumber = '') => ({ studyInstanceUid: uid, studyDate, accessionNumber });

test('incluye estudios con fecha dentro de ingreso-egreso (bordes inclusive)', () => {
	const r = filtrarEstudiosDeVisita(
		[
			estudio('antes', '20260509'),
			estudio('ingreso', '20260510'),
			estudio('medio', '20260512'),
			estudio('egreso', '20260515'),
			estudio('despues', '20260516'),
		],
		{ numeroVisita: 2569, desde: '2026-05-10', hasta: '2026-05-15' },
	);
	assert.deepEqual(r.map((s) => s.studyInstanceUid), ['ingreso', 'medio', 'egreso']);
});

test('AccessionNumber manda sobre la fecha', () => {
	const r = filtrarEstudiosDeVisita(
		[
			estudio('acc-propio-fuera-de-fecha', '20250101', '2569'),
			estudio('acc-otra-visita-en-fecha', '20260512', '2570'),
			estudio('sin-acc-en-fecha', '20260512'),
		],
		{ numeroVisita: 2569, desde: '2026-05-10', hasta: '2026-05-15' },
	);
	assert.deepEqual(r.map((s) => s.studyInstanceUid), ['acc-propio-fuera-de-fecha', 'sin-acc-en-fecha']);
});

test('sin fecha de estudio o sin ingreso no se asocia', () => {
	assert.equal(filtrarEstudiosDeVisita([estudio('x', '')], { numeroVisita: 1, desde: '2026-01-01', hasta: '2026-12-31' }).length, 0);
	assert.equal(filtrarEstudiosDeVisita([estudio('x', '20260101')], { numeroVisita: 1, desde: null, hasta: null }).length, 0);
});

test('dos visitas el mismo día: el estudio queda en la más reciente', () => {
	// Más reciente primero (como ORDER BY FECHAADMISIONS DESC, NumeroVisita DESC).
	const visitas = [
		{ numeroVisita: 3002, desde: '2026-11-12', hasta: '2026-11-12' },
		{ numeroVisita: 3001, desde: '2026-11-12', hasta: '2026-11-12' },
	];
	assert.equal(visitaDueniaDelEstudio('20261112', visitas).numeroVisita, 3002);

	const enReciente = filtrarEstudiosDeVisita(
		[estudio('tc', '20261112')],
		{ numeroVisita: 3002, desde: '2026-11-12', hasta: '2026-11-12', visitasPaciente: visitas },
	);
	const enAnterior = filtrarEstudiosDeVisita(
		[estudio('tc', '20261112')],
		{ numeroVisita: 3001, desde: '2026-11-12', hasta: '2026-11-12', visitasPaciente: visitas },
	);
	assert.deepEqual(enReciente.map((s) => s.studyInstanceUid), ['tc']);
	assert.deepEqual(enAnterior.map((s) => s.studyInstanceUid), []);
});

test('visita abierta vieja no se queda con el estudio de una visita más nueva', () => {
	const visitas = [
		{ numeroVisita: 4100, desde: '2026-11-10', hasta: '2026-11-10' },
		{ numeroVisita: 4000, desde: '2026-10-01', hasta: '2026-11-12' }, // abierta → hasta=hoy
	];
	assert.equal(visitaDueniaDelEstudio('20261110', visitas).numeroVisita, 4100);

	const enNueva = filtrarEstudiosDeVisita(
		[estudio('tc', '20261110')],
		{ numeroVisita: 4100, desde: '2026-11-10', hasta: '2026-11-10', visitasPaciente: visitas },
	);
	const enVieja = filtrarEstudiosDeVisita(
		[estudio('tc', '20261110')],
		{ numeroVisita: 4000, desde: '2026-10-01', hasta: '2026-11-12', visitasPaciente: visitas },
	);
	assert.deepEqual(enNueva.map((s) => s.studyInstanceUid), ['tc']);
	assert.deepEqual(enVieja.map((s) => s.studyInstanceUid), []);
});

test('AccessionNumber propio sigue mostrando el estudio aunque otra visita sea dueña por fecha', () => {
	const visitas = [
		{ numeroVisita: 5002, desde: '2026-11-12', hasta: '2026-11-12' },
		{ numeroVisita: 5001, desde: '2026-11-12', hasta: '2026-11-12' },
	];
	const r = filtrarEstudiosDeVisita(
		[estudio('acc-vieja', '20261112', '5001')],
		{ numeroVisita: 5001, desde: '2026-11-12', hasta: '2026-11-12', visitasPaciente: visitas },
	);
	assert.deepEqual(r.map((s) => s.studyInstanceUid), ['acc-vieja']);
});
