const test = require('node:test');
const assert = require('node:assert/strict');
const { filtrarEstudiosDeVisita } = require('../src/services/pacs.service');

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
