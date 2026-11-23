const test = require('node:test');
const assert = require('node:assert/strict');

const epi = require('../src/services/epicrisisIa.service');

const PE = epi.PERFIL_EPICRISIS;

function evolucion(dia, texto) {
	const d = String(dia).padStart(2, '0');
	return {
		FechaEv: `2026-03-${d}`,
		HoraEv: '09:30',
		ProfesionalNombreCompleto: 'Dr. Perez',
		EspecialidadDescripcion: 'Clinica Medica',
		Evolucion: texto,
	};
}

test('medicación: se toma el nombre real del fármaco y se agrupan las administraciones', () => {
	const filas = [
		{ NombreMedicamento: 'Ceftriaxona 1 g', FechaControl: '2026-03-02', Cantidad: 1, TipoUnidad: 'amp' },
		{ NombreMedicamento: 'Ceftriaxona 1 g', FechaControl: '2026-03-04', Cantidad: 1, TipoUnidad: 'amp' },
		{ NombreMedicamento: 'Ceftriaxona 1 g', FechaControl: '2026-03-03', Cantidad: 1, TipoUnidad: 'amp' },
		{ DescripcionMedicamento: 'Omeprazol 40 mg', FechaControl: '2026-03-02', Cantidad: 1, TipoUnidad: 'amp' },
	];
	const r = epi.consolidarMedicacion(filas);
	assert.equal(r.length, 2);
	const cef = r.find((x) => x.nombre.startsWith('Ceftriaxona'));
	assert.equal(cef.n, 3);
	assert.equal(cef.desde, '2026-03-02');
	assert.equal(cef.hasta, '2026-03-04');

	const ctx = epi.buildContextText({ numeroVisita: 1, medicamentos: filas }, { perfil: PE });
	assert.match(ctx, /Ceftriaxona 1 g \| dosis registrada: 1 amp \| 3 administración/);
	assert.match(ctx, /Omeprazol 40 mg/);
});

test('indicaciones: las hojas repetidas cada día se agrupan y se marca lo suspendido', () => {
	const base = { tipoDescripcion: 'Medicación', descripcion: 'Enoxaparina 40 mg', frecuencia: 'c/24 hs', cantidad: 1, tipoUnidad: 'jer' };
	const inds = [
		{ ...base, vigenteDesde: '2026-03-01', fechaCarga: '2026-03-01', suspendida: true, estado: 'S', fechaExpiro: '2026-03-02' },
		{ ...base, vigenteDesde: '2026-03-01', fechaCarga: '2026-03-02', suspendida: true, estado: 'S', fechaExpiro: '2026-03-03' },
		{ ...base, vigenteDesde: '2026-03-01', fechaCarga: '2026-03-03', suspendida: true, estado: 'S', fechaExpiro: '2026-03-04' },
	];
	const r = epi.consolidarIndicaciones(inds);
	assert.equal(r.length, 1);
	assert.equal(r[0].hojas, 3);
	assert.equal(r[0].activa, false);
	const ctx = epi.buildContextText({ numeroVisita: 1, indicaciones: inds }, { perfil: PE });
	assert.match(ctx, /Enoxaparina 40 mg/);
	assert.match(ctx, /SIN EFECTO desde 04\/03\/2026/);
});

test('laboratorio: llegan los valores de cada parámetro y los fuera de rango', () => {
	const ctx = epi.buildContextText(
		{
			numeroVisita: 1,
			laboratorios: [
				{
					FechaExamen: '2026-03-02',
					HoraExamen: '08:00',
					TipoEstudio: 'Hemograma',
					Laboratorio: 'Central',
					detalles: [
						{ NombreParametro: 'Hemoglobina', Resultado: '8.9', UnidadMedida: 'g/dL', FueraDeRango: 1, ValorReferencia: '12-16' },
						{ NombreParametro: 'Plaquetas', Resultado: '250000', UnidadMedida: '/mm3', FueraDeRango: 0 },
					],
				},
			],
		},
		{ perfil: PE },
	);
	assert.match(ctx, /Hemoglobina 8\.9 g\/dL \(FUERA DE RANGO, ref 12-16\)/);
	assert.match(ctx, /Plaquetas 250000 \/mm3/);
	assert.doesNotMatch(ctx, /Plaquetas 250000 \/mm3 \(FUERA/);
});

test('protocolos y prácticas: se incluye el nombre y el texto del informe', () => {
	const ctx = epi.buildContextText(
		{
			numeroVisita: 1,
			protocolos: [
				{
					tipoDescripcion: 'Colecistectomía laparoscópica',
					fechaHoraInicio: '2026-03-05T10:00:00',
					diagnosticoPreDescripcion: 'Colelitiasis',
					diagnosticoPosDescripcion: 'Colecistitis aguda litiásica',
					tecnica: 'Laparoscópica 4 trócares',
					texto: 'Se identifica vesícula distendida con paredes engrosadas.',
					practicas: [{ descripcion: 'Colecistectomía', profesionales: [{ funcionNombre: 'Cirujano', apellidoNombre: 'Gomez' }] }],
				},
			],
			practicasPaciente: [{ PracticaDescripcion: 'Ecografía abdominal', Practica: 12345, FechaPractica: '2026-03-04', CantidadPractica: 1 }],
		},
		{ perfil: PE },
	);
	assert.match(ctx, /Colecistectomía laparoscópica/);
	assert.match(ctx, /Colecistitis aguda litiásica/);
	assert.match(ctx, /vesícula distendida con paredes engrosadas/);
	assert.match(ctx, /Cirujano: Gomez/);
	assert.match(ctx, /Ecografía abdominal/);
	assert.doesNotMatch(ctx, /12345/);
});

test('epicrisis: ninguna evolución se descarta y salen en orden cronológico', () => {
	// llegan newest-first, como las devuelve el servicio de evoluciones
	const evo = [];
	for (let i = 90; i >= 1; i--) evo.push(evolucion((i % 28) + 1, `Evolución número ${i} con detalle clínico propio.`));
	const ctx = epi.buildContextText({ numeroVisita: 1, evolucionesMedicas: evo }, { perfil: PE });
	for (let i = 1; i <= 90; i++) assert.ok(ctx.includes(`Evolución número ${i} con`), `falta la evolución ${i}`);
	assert.ok(ctx.indexOf('Evolución número 1 con') < ctx.indexOf('Evolución número 90 con'));
});

test('epicrisis: una evolución larga no se corta a 700 caracteres', () => {
	const larga = `Inicio ${'dato clínico relevante '.repeat(80)}FIN-DE-LA-EVOLUCION`;
	const ctx = epi.buildContextText({ numeroVisita: 1, evolucionesMedicas: [evolucion(1, larga)] }, { perfil: PE });
	assert.ok(ctx.includes('FIN-DE-LA-EVOLUCION'));
	const corto = epi.buildContextText({ numeroVisita: 1, evolucionesMedicas: [evolucion(1, larga)] });
	assert.ok(!corto.includes('FIN-DE-LA-EVOLUCION'), 'el perfil de resumen conserva su recorte corto');
});

test('controles: se resumen en rangos y cubren toda la internación (no solo los últimos)', () => {
	const ctrl = [];
	for (let d = 1; d <= 20; d++) {
		const dia = String(d).padStart(2, '0');
		ctrl.push({ Fecha: `2026-03-${dia}`, Hora: '08:00', Maximo: 120 + d, Minimo: 70, Pulso: 80, Saturometria: 96, Axilar: 36.5 });
		ctrl.push({ Fecha: `2026-03-${dia}`, Hora: '20:00', Maximo: 110, Minimo: 65, Pulso: 90, Saturometria: 94, Axilar: 37.8 });
	}
	const lineas = epi.resumirControles(ctrl, 45);
	assert.equal(lineas.length, 20);
	assert.match(lineas[0], /^01\/03\/2026: PA 110-121\/65-70 \| FC 80-90/);
	assert.match(lineas[0], /Tax 36\.5-37\.8/);
	assert.match(lineas[0], /\(2 control/);

	const agrupadas = epi.resumirControles(ctrl, 5);
	assert.ok(agrupadas.length <= 5);
	assert.match(agrupadas[0], /01\/03\/2026 a /);
});

test('muestrear conserva primero y último y reparte el resto', () => {
	const arr = Array.from({ length: 100 }, (_, i) => i);
	const m = epi.muestrear(arr, 10);
	assert.equal(m.length, 10);
	assert.equal(m[0], 0);
	assert.equal(m[m.length - 1], 99);
	assert.deepEqual(epi.muestrear([1, 2, 3], 10), [1, 2, 3]);
});

test('dividirEnTramos respeta el tamaño y el orden', () => {
	const items = Array.from({ length: 10 }, (_, i) => ({ fecha: `2026-03-${String(i + 1).padStart(2, '0')}`, linea: 'x'.repeat(100) }));
	const tramos = epi.dividirEnTramos(items, 350);
	assert.ok(tramos.length >= 3);
	assert.equal(tramos.reduce((s, t) => s + t.n, 0), 10);
	assert.equal(tramos[0].desde, '2026-03-01');
	assert.equal(tramos[tramos.length - 1].hasta, '2026-03-10');
});

test('deslinde: se agrega completo aunque el cuerpo sea larguísimo', () => {
	const cuerpo = 'a'.repeat(9000);
	const out = epi.asegurarDisclaimerEnTexto(cuerpo, true);
	assert.ok(out.length <= 8000);
	assert.ok(out.endsWith(epi.DISCLAIMER_IA));
	assert.equal(epi.asegurarDisclaimerEnTexto('texto', false), 'texto');
});

test('cortarEnLimite no deja frases a medias cuando hay un corte cercano', () => {
	const t = `${'Linea completa uno.\n'.repeat(10)}Esto es una linea final que se pasa del limite`;
	const c = epi.cortarEnLimite(t, 200);
	assert.ok(c.length <= 200);
	assert.ok(c.endsWith('.'));
});

test('formatear: rótulos internos en minúscula no se convierten en títulos de sección', () => {
	const t = epi.formatearEpicrisisVisual(
		'CURSO HOSPITALARIO\nIngresó febril. Estudios: hemocultivos negativos. Medicación: ceftriaxona.\n\nCONDICIÓN AL EGRESO\nAfebril.',
	);
	assert.match(t, /Estudios: hemocultivos negativos\. Medicación: ceftriaxona\./);
});

test('ajustarContexto: una sección enorme no hace desaparecer las secciones del final', () => {
	const interconsultas = Array.from({ length: 200 }, (_, i) => ({
		FechaSolicitud: `2026-03-${String(Math.floor(i / 10) + 1).padStart(2, '0')}`,
		HoraSolicitud: `${String(i % 10).padStart(2, '0')}:00`,
		ServicioDescripcion: `Servicio ${i}`,
		Motivo: `Motivo ${i}`,
		Respuesta: `Respuesta larga ${i} ${'detalle clinico '.repeat(150)}`,
	}));
	const dossier = {
		numeroVisita: 1,
		interconsultas,
		medicamentos: [{ NombreMedicamento: 'Ceftriaxona 1 g', FechaControl: '2026-03-02', Cantidad: 1, TipoUnidad: 'amp' }],
		laboratorios: [
			{ FechaExamen: '2026-03-02', detalles: [{ NombreParametro: 'Hemoglobina', Resultado: '8.9', UnidadMedida: 'g/dL' }] },
		],
		controles: [{ Fecha: '2026-03-02', Hora: '08:00', Maximo: 110, Minimo: 70, Pulso: 95 }],
	};
	const crudo = epi.buildContextText(dossier, { perfil: PE, sinAjuste: true });
	assert.ok(crudo.length > 120000, 'el caso debe superar el tope para que la prueba tenga sentido');
	const ctx = epi.buildContextText(dossier, { perfil: PE });
	assert.ok(ctx.length <= 120000);
	assert.match(ctx, /Ceftriaxona 1 g/);
	assert.match(ctx, /Hemoglobina 8\.9 g\/dL/);
	assert.match(ctx, /PA 110\/70/);
	assert.match(ctx, /registros omitidos por tamaño/);
	// las muestras cubren toda la internación: están la primera y la última interconsulta
	assert.match(ctx, /Respuesta larga 0 /);
	assert.match(ctx, /Respuesta larga 199 /);
});

test('reducirSeccion: conserva primero y último registro y respeta el presupuesto', () => {
	const sec = ['=== 5. X ===', ...Array.from({ length: 50 }, (_, i) => `${i + 1}. registro ${i + 1} ${'x'.repeat(100)}`)].join('\n');
	const r = epi.reducirSeccion(sec, 1500);
	assert.ok(r.length <= 1500);
	assert.match(r, /50\. registro 50/);
	assert.match(r, /1\. registro 1 /);
});
