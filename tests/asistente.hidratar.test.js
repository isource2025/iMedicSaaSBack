const test = require('node:test');
const assert = require('node:assert/strict');
const hidratar = require('../src/asistente/hidratar');
const ficha = require('../src/asistente/ficha');
const manifiesto = require('../src/asistente/manifiesto');

test('ficha de contexto arma el texto completo, no un campo suelto', () => {
	const t = ficha.textoDe({
		tipo: 'internacion',
		paciente: 'SANABRIA ELIZABETH',
		documento: '123',
		numeroVisita: 10,
		sector: 'QUR2',
		sectorDescripcion: 'INT. QUIRURGICA 2',
		cama: '01',
		diagnostico: 'C23',
	});
	assert.match(t, /SANABRIA/);
	assert.match(t, /QUR2/);
	assert.match(t, /INT\. QUIRURGICA 2/);
	assert.match(t, /01/);
	assert.match(t, /C23/);
});

test('hidratar: sin catálogo no confirma, pide el valor real', async () => {
	const ep = manifiesto.resolver('POST', '/api/patients/visitas/egreso');
	assert.ok(ep);
	const out = await hidratar.hidratar({
		ep,
		args: { body: {} },
		ctx: {
			foco: { numeroVisita: 99, paciente: 'SANABRIA', diagnostico: 'C23' },
			req: { headers: {} },
			token: 't',
		},
	});
	assert.ok(out.pedir || out.faltan?.length);
	assert.equal(out.body.numeroVisita, 99);
});

test('hidratar resuelve texto de catálogo a Valor', () => {
	const clinica = require('../src/asistente/clinica');
	const lista = [
		{ Valor: 1, Descripcion: 'ALTA MEDICA' },
		{ Valor: 2, Descripcion: 'DERIVACION' },
	];
	assert.equal(clinica.resolverDisposicion(lista, 'alta medica').Valor, 1);
});
