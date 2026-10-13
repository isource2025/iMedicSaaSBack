const test = require('node:test');
const assert = require('node:assert/strict');
const sesion = require('../src/asistente/sesion');
const hc = require('../src/asistente/historiaClinica');
const resumir = require('../src/asistente/resumir');

test('sesion.restaurar: retoma los últimos mensajes solo en una sesión vacía', () => {
	sesion.resetStore();
	const conv = sesion.crear({ idEmpresa: 1, valorPersonal: 7 });
	const historial = [
		{ role: 'user', content: 'analizá los signos de Duarte' },
		{ role: 'assistant', content: 'Análisis de DUARTE SERGIO RAUL…' },
		{ role: 'system', content: 'no tiene que entrar' },
		{ role: 'user', content: '' },
	];
	assert.equal(sesion.restaurar(conv, historial), true);
	assert.deepEqual(conv.mensajes.map((m) => m.role), ['user', 'assistant']);
	assert.equal(sesion.restaurar(conv, [{ role: 'user', content: 'otra cosa' }]), false, 'no pisa una sesión con mensajes');
	assert.equal(sesion.historialParaModelo(conv).length, 2);
});

test('HC de ingreso: IMC calculado y aviso si el texto dice otra categoría', () => {
	const f = hc.SECCIONES.hc_ingreso.enriquecer({ SV_PESOACTUAL: '97 kg', SV_TALLA: '1.80 cm', SV_ESTADONUTRICIONAL: 'IMC Normopeso ' });
	assert.equal(f.imcCalculado, '29.9 (sobrepeso) con 97 kg y 1.8 m');
	assert.match(f.avisoImc, /dice «IMC Normopeso», pero .* 29\.9 \(sobrepeso\)/);
	assert.equal(Object.keys(f)[0], 'avisoImc', 'va primero: el recorte borra los últimos campos');
	const ok = hc.SECCIONES.hc_ingreso.enriquecer({ SV_PESOACTUAL: '70', SV_TALLA: '175 cm', SV_ESTADONUTRICIONAL: 'normopeso' });
	assert.equal(ok.imcCalculado, '22.9 (normopeso) con 70 kg y 1.75 m');
	assert.equal(ok.avisoImc, undefined);
	assert.deepEqual(hc.SECCIONES.hc_ingreso.enriquecer({ SV_TALLA: '1.80' }), { SV_TALLA: '1.80' });
});

test('resumen agrupado: masFrecuentes aunque haya pocos ítems (items va por última vez)', () => {
	const filas = [
		{ Especialidad: 'TRAUMATOLOGIA', FechaSolicitud: '2026-02-23' },
		{ Especialidad: 'CLINICA MEDICA', FechaSolicitud: '2026-02-18' },
		{ Especialidad: 'CLINICA MEDICA', FechaSolicitud: '2026-02-17' },
		{ Especialidad: 'CLINICA MEDICA', FechaSolicitud: '2026-02-16' },
		{ Especialidad: 'TRAUMATOLOGIA', FechaSolicitud: '2026-02-15' },
	];
	const out = resumir.presentar(filas, { resumen: { tipo: 'agrupar', por: ['Especialidad'] }, soloResumen: true }, 60);
	assert.equal(out.resumen.items[0].nombre, 'TRAUMATOLOGIA');
	assert.equal(out.resumen.masFrecuentes[0], 'CLINICA MEDICA (3)');
});
