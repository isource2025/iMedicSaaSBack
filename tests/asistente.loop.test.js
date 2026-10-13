const test = require('node:test');
const assert = require('node:assert/strict');
const { agenteLoop, parseArgs } = require('../src/asistente/loop');

test('parseArgs acepta JSON y objeto', () => {
	assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
	assert.deepEqual(parseArgs({ a: 1 }), { a: 1 });
	assert.deepEqual(parseArgs('no-json'), {});
});

test('agenteLoop devuelve texto cuando no hay tools', async () => {
	const out = await agenteLoop({
		messages: [{ role: 'user', content: 'hola' }],
		tools: [],
		ejecutar: async () => ({}),
		chat: async () => ({ content: 'Hola, ¿en qué ayudo?', toolCalls: [] }),
	});
	assert.equal(out.texto, 'Hola, ¿en qué ayudo?');
	assert.equal(out.invocadas.length, 0);
});

test('agenteLoop ejecuta tools y reenvía el resultado', async () => {
	let paso = 0;
	const ejecutadas = [];
	const out = await agenteLoop({
		messages: [{ role: 'user', content: 'buscá a Pérez' }],
		tools: [{ type: 'function', function: { name: 'buscar_pacientes' } }],
		ejecutar: async (nombre, args) => {
			ejecutadas.push({ nombre, args });
			return { items: [{ ApellidoNombre: 'Pérez' }] };
		},
		chat: async ({ messages }) => {
			paso += 1;
			if (paso === 1) {
				return {
					content: null,
					toolCalls: [
						{
							id: 'c1',
							function: { name: 'buscar_pacientes', arguments: '{"termino":"Pérez"}' },
						},
					],
				};
			}
			const toolMsg = messages.find((m) => m.role === 'tool');
			assert.ok(toolMsg);
			assert.match(toolMsg.content, /Pérez/);
			return { content: 'Encontré a Pérez', toolCalls: [] };
		},
	});
	assert.equal(out.texto, 'Encontré a Pérez');
	assert.equal(ejecutadas[0].nombre, 'buscar_pacientes');
	assert.deepEqual(ejecutadas[0].args, { termino: 'Pérez' });
});

test('agenteLoop cierra cuando se agotan iteraciones', async () => {
	const out = await agenteLoop({
		messages: [{ role: 'user', content: 'x' }],
		tools: [],
		maxIter: 1,
		ejecutar: async () => ({}),
		chat: async ({ toolChoice }) => {
			if (toolChoice === 'none') return { content: 'cierre', toolCalls: [] };
			return {
				content: null,
				toolCalls: [{ id: 'c1', function: { name: 'noop', arguments: '{}' } }],
			};
		},
	});
	assert.equal(out.texto, 'cierre');
	assert.equal(out.finishReason, 'max_iter');
});
