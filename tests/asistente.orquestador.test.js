const test = require('node:test');
const assert = require('node:assert/strict');
const orquestador = require('../src/asistente/agentes/orquestador');
const catalogo = require('../src/asistente/catalogo');
const permisosService = require('../src/services/permisos.service');

function internacionLista() {
	return Boolean(orquestador.porId('INTERNACION')?.LISTO);
}

test('clasifica soporte vs internación y hace fallback si el módulo no está listo', () => {
	assert.equal(orquestador.clasificar({ texto: 'cómo hago un ingreso de un paciente' }), 'SOPORTE');
	assert.equal(orquestador.clasificar({ texto: 'llevame al mapa de camas' }), 'SOPORTE');
	assert.equal(orquestador.clasificar({ texto: 'dónde está internada sanabria' }), 'INTERNACION');
	assert.equal(orquestador.clasificar({ texto: 'egresar a gomez' }), 'INTERNACION');

	const intern = orquestador.resolver({ texto: 'dónde está internada sanabria' });
	assert.equal(intern.pedido, 'INTERNACION');
	assert.equal(intern.id, internacionLista() ? 'INTERNACION' : 'SOPORTE');
	if (!internacionLista()) assert.equal(intern.aviso, 'INTERNACION');

	const sop = orquestador.resolver({ texto: 'cómo hago un ingreso de un paciente' });
	assert.equal(sop.id, 'SOPORTE');
	assert.equal(sop.aviso, null);
});

test('sticky: sin cambio de tema se queda en el agente activo listo', () => {
	assert.equal(
		orquestador.clasificar({ texto: 'y en el inicio qué veo', agenteActivo: 'SOPORTE' }),
		'SOPORTE',
	);
});

test('Soporte selecciona exactamente 5 tools', () => {
	const names = catalogo
		.seleccionar({
			permisos: ['ADMISION.PACIENTES.VER'],
			agente: 'SOPORTE',
			tienePermiso: permisosService.tienePermiso,
		})
		.map((h) => h.name);
	assert.deepEqual(
		names.sort(),
		['buscar_en_manual', 'diagnosticar', 'escribir_en_campo', 'listar_pantallas', 'navegar'].sort(),
	);
});
