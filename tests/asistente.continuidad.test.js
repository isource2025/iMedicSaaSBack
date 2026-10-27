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

test('signos escritos en las evoluciones: serie de la más vieja a la más reciente y lo fuera de rango con fecha', () => {
	const { signosDeEvoluciones } = require('../src/asistente/analisisClinico');
	const filas = [
		{ FechaEv: '2026-02-22', Evolucion: 'TA: 110/70 mmHg FC: 77 lpm FR: 16 rpm T°: 36.5 ºC SAT: 99% AA DIURESIS: 2400 BALANCE: -1000 GLUCEMIAS: 138-196-80-108' },
		{ FechaEv: '2026-02-20', Evolucion: 'T.A: 130/80 F.C 75 SAT: 96 % GLUCEMIAS: 177/113/68 BALANCE: + 3600' },
		{ FechaEv: '2026-02-18', Evolucion: 'pasa a sala de clinica medica' },
	];
	const s = signosDeEvoluciones(filas);
	assert.deepEqual(s.serie.map((x) => x.fecha), ['2026-02-20', '2026-02-22']);
	assert.deepEqual(s.serie[0], { fecha: '2026-02-20', TA: '130/80', FC: 75, Sat: 96, Glucemias: '177/113/68', Balance: '+3600' });
	assert.equal(s.serie[1].T, 36.5);
	assert.deepEqual(s.fueraDeRango, ['HGT 68 (2026-02-20)', 'HGT 196 (2026-02-22)']);
	assert.equal(signosDeEvoluciones(filas.slice(2)), undefined);
});

test('recorte al tope: la tendencia de signos se conserva; se van el detalle por día y los registros', () => {
	const sv = {
		seccion: 'signos_vitales',
		resumen: {
			tendencia: { TAS: 'fuera de rango del 2026-02-14 al 2026-02-19 (máximo 171 el 2026-02-17 23:00)' },
			criterio: 'Fuera de rango: TAS >139',
			porDia: Array.from({ length: 30 }, (_, i) => `día ${i}: TAS 120-171, FC 70-90`),
			fueraDeRango: Array.from({ length: 20 }, (_, i) => `TAS 171 (2026-02-${10 + i})`),
		},
		registros: Array.from({ length: 10 }, (_, i) => ({ FechaControl: `2026-02-${10 + i}`, Maximo: 120, Observaciones: 'x'.repeat(80) })),
	};
	const enf = { seccion: 'evolucion_enfermeria', registros: Array.from({ length: 10 }, () => ({ Texto: 'y'.repeat(150) })) };
	resumir.recortarAlTope([sv, enf], 1500);
	assert.ok(JSON.stringify([sv, enf]).length <= 1500);
	assert.match(sv.resumen.tendencia.TAS, /máximo 171/);
	assert.equal(sv.resumen.porDia, undefined);
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
