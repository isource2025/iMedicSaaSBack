/**
 * Validación síncrona del contrato: sin ficha ni matrícula → error;
 * con ficha válida no consulta DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverFichaParaFacProfesional } = require('./fichaFacProfesional');

test('resolverFichaParaFacProfesional usa ficha cuando viene cargada', async () => {
	const ficha = await resolverFichaParaFacProfesional({ ficha: 12345, matricula: 999 });
	assert.equal(ficha, 12345);
});

test('resolverFichaParaFacProfesional falla sin ficha ni matrícula', async () => {
	await assert.rejects(
		() => resolverFichaParaFacProfesional({}),
		(e) => e.statusCode === 400 && /ficha o matrícula/i.test(e.message),
	);
	await assert.rejects(
		() => resolverFichaParaFacProfesional({ ficha: 0, matricula: null }),
		(e) => e.statusCode === 400,
	);
});
