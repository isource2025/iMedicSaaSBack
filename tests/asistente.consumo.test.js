const test = require('node:test');
const assert = require('node:assert/strict');
const costos = require('../src/asistente/costos');
const consumo = require('../src/asistente/consumo');
const tokens = require('../src/asistente/tokens');
const reporte = require('../src/asistente/reporteConsumo');
const { agenteLoop } = require('../src/asistente/loop');

const casi = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('tokenizador real o200k_base', () => {
	assert.equal(tokens.nombreTokenizador(), 'o200k_base');
	assert.ok(tokens.contar('Cargá una evolución médica para la cama 12') > 5);
	assert.equal(tokens.contar(''), 0);
});

test('costos: precio por prefijo, cache y modelo desconocido', () => {
	assert.equal(costos.precioDe('gpt-4o-mini-2024-07-18').modelo, 'gpt-4o-mini');
	assert.equal(costos.precioDe('gpt-4o-2024-08-06').modelo, 'gpt-4o');
	assert.equal(costos.precioDe('modelo-raro').conocido, false);
	const c = costos.costoDe(
		{ prompt_tokens: 10000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 4000 } },
		'gpt-4o-mini',
	);
	casi(c.usd, (6000 * 0.15 + 4000 * 0.075 + 1000 * 0.6) / 1e6);
});

test('costos: ASISTENTE_PRECIOS pisa la tabla', () => {
	process.env.ASISTENTE_PRECIOS = JSON.stringify({ 'gpt-4o-mini': { entrada: 1, cache: 1, salida: 1 } });
	costos._reiniciar();
	try {
		casi(costos.costoDe({ prompt_tokens: 1e6, completion_tokens: 0 }, 'gpt-4o-mini').usd, 1);
	} finally {
		delete process.env.ASISTENTE_PRECIOS;
		costos._reiniciar();
	}
});

test('medidor: totales = usage real, reparto por parte del prompt y por herramienta', async () => {
	const medidor = consumo.crearMedidor();
	const respuestas = [
		{
			content: null,
			toolCalls: [{ id: 'a', function: { name: 'buscar_internacion', arguments: '{"texto":"Perez"}' } }],
			usage: { prompt_tokens: 8000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 } },
			modelo: 'gpt-4o-mini-2024-07-18',
		},
		{
			content: null,
			toolCalls: [{ id: 'b', function: { name: 'generar_borrador_epicrisis', arguments: '{"numeroVisita":5}' } }],
			usage: { prompt_tokens: 9000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 7680 } },
			modelo: 'gpt-4o-mini-2024-07-18',
		},
		{
			content: 'Listo',
			toolCalls: [],
			usage: { prompt_tokens: 11000, completion_tokens: 900, prompt_tokens_details: { cached_tokens: 8960 } },
			modelo: 'gpt-4o-mini-2024-07-18',
		},
	];
	let i = 0;
	const chat = consumo.medirChat(async () => respuestas[i++], medidor);
	await agenteLoop({
		messages: [
			{ role: 'system', content: 'Sos el asistente. '.repeat(300) },
			{ role: 'user', content: 'hola' },
			{ role: 'assistant', content: 'hola, ¿en qué ayudo?' },
			{ role: 'user', content: 'epicrisis de Perez' },
		],
		tools: [{ type: 'function', function: { name: 'buscar_internacion', parameters: { type: 'object' } } }],
		chat,
		ejecutar: async (nombre) => {
			if (nombre === 'generar_borrador_epicrisis') {
				medidor.registrarExterno({
					origen: 'epicrisis_ia',
					herramienta: nombre,
					modelo: 'gpt-4o-mini',
					usage: { prompt_tokens: 20000, completion_tokens: 2000 },
				});
				return { borrador: 'texto '.repeat(500) };
			}
			return { pacientes: [{ nombre: 'Perez' }] };
		},
	});
	const r = medidor.resumen();
	assert.equal(r.llamadas, 3);
	assert.equal(r.llamadasExternas, 1);
	assert.equal(r.modelo, 'gpt-4o-mini');
	assert.equal(r.tokens.entrada, 8000 + 9000 + 11000 + 20000);
	assert.equal(r.tokens.cacheadas, 7680 + 8960);
	assert.equal(r.tokens.salida, 40 + 30 + 900 + 2000);

	const esperado =
		costos.costoDe(respuestas[0].usage, 'gpt-4o-mini').usd +
		costos.costoDe(respuestas[1].usage, 'gpt-4o-mini').usd +
		costos.costoDe(respuestas[2].usage, 'gpt-4o-mini').usd +
		costos.costoDe({ prompt_tokens: 20000, completion_tokens: 2000 }, 'gpt-4o-mini').usd;
	casi(r.costoUsd, esperado, 2e-6);

	const sumaComp = Object.values(r.composicionEntrada).reduce((s, x) => s + x.tokens, 0);
	assert.ok(Math.abs(sumaComp - 28000) <= 12, `composición ${sumaComp} ≠ 28000`);
	assert.ok(r.composicionEntrada.sistema.tokens > 0);
	assert.ok(r.composicionEntrada.historial.tokens > 0);
	assert.ok(r.composicionEntrada.resultadosHerramientas.tokens > 0);

	const epi = r.porHerramienta.find((h) => h.nombre === 'generar_borrador_epicrisis');
	assert.equal(epi.veces, 1);
	assert.ok(epi.costoUsd >= costos.costoDe({ prompt_tokens: 20000, completion_tokens: 2000 }, 'gpt-4o-mini').usd - 1e-6);
	assert.equal(r.porHerramienta[0].nombre, 'generar_borrador_epicrisis');
	assert.ok(r.calibracion > 0);
	assert.match(consumo.lineaLog(r), /US\$\d+\.\d{5} · 3 llamadas \+1 ext/);
});

test('medidor: sin usage estima con el tokenizador', async () => {
	const medidor = consumo.crearMedidor();
	const chat = consumo.medirChat(async () => ({ content: 'ok', toolCalls: [] }), medidor);
	await chat({ messages: [{ role: 'user', content: 'hola' }], tools: [] });
	const r = medidor.resumen();
	assert.equal(r.porLlamada[0].estimado, true);
	assert.ok(r.tokens.entrada > 0);
});

test('reporte: suma pedidos, no duplica la epicrisis disparada por el asistente', () => {
	const msg = (actor, dia, usd, extra = {}) => ({
		entidad: 'MENSAJE',
		accion: 'MENSAJE',
		actor,
		actorNombre: `Usuario ${actor}`,
		dia,
		detalle: JSON.stringify({
			consumo: {
				modelo: 'gpt-4o-mini',
				llamadas: 3,
				llamadasExternas: 0,
				tokens: { entrada: 20000, cacheadas: 8000, salida: 500 },
				costoUsd: usd,
				porHerramienta: [{ nombre: 'consulta_sql', veces: 1, costoUsd: usd / 2 }],
				composicionEntrada: { definicionesHerramientas: { tokens: 12000, costoUsd: usd / 3 } },
			},
			...extra,
		}),
	});
	const filas = [
		msg(1, '2026-10-01', 0.004),
		msg(1, '2026-10-02', 0.006),
		msg(2, '2026-10-02', 0.01),
		{ entidad: 'MENSAJE', accion: 'MENSAJE', actor: 2, dia: '2026-10-02', detalle: JSON.stringify({ herramientas: [] }) },
		{
			entidad: 'CONSUMO_IA',
			accion: 'EPICRISIS_IA',
			actor: 2,
			dia: '2026-10-02',
			detalle: JSON.stringify({ origen: 'asistente', consumo: { costoUsd: 0.005, tokens: { entrada: 1 } } }),
		},
		{
			entidad: 'CONSUMO_IA',
			accion: 'EPICRISIS_IA',
			actor: 1,
			dia: '2026-10-02',
			detalle: JSON.stringify({ origen: 'pantalla', consumo: { costoUsd: 0.003, llamadas: 1, tokens: { entrada: 15000, salida: 2000 } } }),
		},
	];
	const r = reporte.agregar(filas, { dias: 2 });
	assert.equal(r.totales.pedidos, 4);
	casi(r.totales.costoUsd, 0.023, 1e-6);
	assert.equal(r.notas.pedidosSinMedir, 1);
	assert.equal(r.notas.consumosInternosYaIncluidos, 1);
	assert.equal(r.porUsuario[0].actor, 1);
	casi(r.porUsuario[0].costoUsd, 0.013, 1e-6);
	assert.equal(r.porDia.length, 2);
	assert.equal(r.porHerramienta[0].nombre, 'consulta_sql');
	assert.equal(r.porHerramienta[0].pedidos, 3);
	casi(r.proyeccionMensual.costoUsd, (0.023 / 2) * 30, 1e-6);
	assert.equal(r.otrasFuncionesIa[0].accion, 'EPICRISIS_IA');
});

test('reporte: fila por mensaje con pregunta, error y epicrisis interna', () => {
	const f = reporte.filaMensaje({
		id: 7,
		entidad: 'MENSAJE',
		accion: 'MENSAJE_ERROR',
		actor: 3,
		actorNombre: 'Perez, Ana ',
		fecha: '2026-10-10 18:47:00',
		detalle: JSON.stringify({
			pregunta: 'Cuántos internados hay por sector?',
			error: 'timeout',
			herramientas: ['consulta_sql'],
			consumo: { modelo: 'gpt-4o-mini', llamadas: 2, llamadasExternas: 1, tokens: { total: 9 }, costoUsd: 0.001 },
		}),
	});
	assert.equal(f.tipo, 'CHAT');
	assert.equal(f.error, 'timeout');
	assert.equal(f.nombre, 'Perez, Ana');
	assert.equal(f.llamadas, 3);
	assert.equal(f.costoUsd, 0.001);
	const epi = reporte.filaMensaje({
		id: 8,
		entidad: 'CONSUMO_IA',
		accion: 'EPICRISIS_IA',
		detalle: JSON.stringify({ origen: 'asistente', consumo: { costoUsd: 0.002 } }),
	});
	assert.equal(epi.tipo, 'EPICRISIS_IA');
	assert.equal(epi.incluidoEnChat, true);
});

test('reporte: rango por defecto de 30 días', () => {
	const r = reporte.rango(null, '2026-10-10');
	assert.equal(r.desde, '2026-09-11');
	assert.equal(r.dias, 30);
});
