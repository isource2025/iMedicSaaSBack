/**
 * Ticket: "se carga presión máxima y mínima, la media debe calcularla y no lo hace".
 *
 * PAM = (PAS + 2 × PAD) / 3, redondeada. Se verifica la utilidad y que cada camino que guarda en
 * imInterCtrlFrecuente (control frecuente / RAC, signos vitales, HC de ingreso, aplicar control)
 * persista la media calculada. La base está simulada: se inspeccionan los parámetros del INSERT/UPDATE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// --- Base simulada (antes de cargar los servicios) ---
const llamadas = [];
let respuestas = [];
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => {
			llamadas.push({ sql: String(sql), params });
			return respuestas.length ? respuestas.shift() : [{ Valor: 1 }];
		},
		getRequestPool: async () => {
			throw new Error('no debería usarse');
		},
	},
};

const { calcularPresionMedia, resolverPresionMedia } = require(src('utils/presionArterial.js'));
const controles = require(src('services/controlesFrecuentes.service.js'));
const signosVitales = require(src('services/signosVitales.service.js'));

const valorDe = (llamada, indice) => llamada.params[indice].value;

test.beforeEach(() => {
	llamadas.length = 0;
	respuestas = [];
});

// ---------- Utilidad ----------
test('120/80 → 93 (el caso del ticket)', () => {
	assert.equal(calcularPresionMedia(120, 80), 93);
});

test('redondea al entero más cercano', () => {
	assert.equal(calcularPresionMedia(130, 85), 100); // 100
	assert.equal(calcularPresionMedia(110, 70), 83); // 83.33
	assert.equal(calcularPresionMedia(140, 95), 110); // 110
	assert.equal(calcularPresionMedia(100, 61), 74); // 74
});

test('acepta números en texto (como llegan de un formulario)', () => {
	assert.equal(calcularPresionMedia('120', '80'), 93);
});

test('sin máxima o sin mínima no calcula', () => {
	assert.equal(calcularPresionMedia(120, null), null);
	assert.equal(calcularPresionMedia(undefined, 80), null);
	assert.equal(calcularPresionMedia('', ''), null);
	assert.equal(calcularPresionMedia(0, 80), null);
	assert.equal(calcularPresionMedia(120, 0), null);
});

test('mínima mayor que la máxima es un dato inválido: no calcula', () => {
	assert.equal(calcularPresionMedia(80, 120), null);
});

test('resolverPresionMedia: calcula, y si no puede conserva la media informada o 0', () => {
	assert.equal(resolverPresionMedia({ presionMax: 120, presionMin: 80 }), 93);
	// manda lo calculado sobre un valor manual inconsistente
	assert.equal(resolverPresionMedia({ presionMax: 120, presionMin: 80, presionMedia: 50 }), 93);
	assert.equal(resolverPresionMedia({ presionMedia: 90 }), 90);
	assert.equal(resolverPresionMedia({ presionMax: 120, presionMedia: 90 }), 90);
	assert.equal(resolverPresionMedia({}), 0);
	assert.equal(resolverPresionMedia(), 0);
});

// ---------- Control frecuente (NuevoControlModal y RAC) ----------
test('crearControl guarda PAMedia calculada aunque el cliente no la mande', async () => {
	await controles.crearControl({
		numeroVisita: 10,
		fechaControl: '2026-10-02',
		horaControl: '08:30',
		operadorCarga: 5,
		presionMax: 120,
		presionMin: 80,
	});
	const insert = llamadas.find((l) => /INSERT INTO dbo\.imInterCtrlFrecuente/.test(l.sql));
	assert.ok(insert, 'debe insertar el control');
	assert.equal(valorDe(insert, 8), 120); // Maximo
	assert.equal(valorDe(insert, 9), 80); // Minimo
	assert.equal(valorDe(insert, 14), 93); // PAMedia
});

test('crearControl ignora una media manual incoherente cuando hay máxima y mínima', async () => {
	await controles.crearControl({
		numeroVisita: 10,
		fechaControl: '2026-10-02',
		horaControl: '08:30',
		presionMax: 130,
		presionMin: 85,
		presionMedia: 1,
	});
	const insert = llamadas.find((l) => /INSERT INTO/.test(l.sql));
	assert.equal(valorDe(insert, 14), 100);
});

test('crearControl sin presión guarda PAMedia 0 (compatibilidad Clarion)', async () => {
	await controles.crearControl({
		numeroVisita: 10,
		fechaControl: '2026-10-02',
		horaControl: '08:30',
		pulso: 70,
	});
	const insert = llamadas.find((l) => /INSERT INTO/.test(l.sql));
	assert.equal(valorDe(insert, 14), 0);
});

test('actualizarControl recalcula PAMedia al editar máxima y mínima', async () => {
	await controles.actualizarControl(77, { presionMax: 140, presionMin: 90 });
	const update = llamadas.find((l) => /UPDATE dbo\.imInterCtrlFrecuente/.test(l.sql));
	assert.ok(update);
	assert.equal(valorDe(update, 4), 140); // Maximo
	assert.equal(valorDe(update, 5), 90); // Minimo
	assert.equal(valorDe(update, 10), 107); // PAMedia = (140 + 180) / 3
});

test('actualizarControl: si sólo cambia la máxima usa la mínima guardada', async () => {
	// 1ª consulta: obtenerControlPorId (para completar la mínima) · luego el UPDATE · luego el SELECT final
	respuestas = [[{ Valor: 77, Maximo: 120, Minimo: 80, PAMedia: 93 }]];
	await controles.actualizarControl(77, { presionMax: 150 });
	const update = llamadas.find((l) => /UPDATE dbo\.imInterCtrlFrecuente/.test(l.sql));
	assert.ok(update);
	assert.equal(valorDe(update, 10), 103); // (150 + 2×80) / 3 = 103.33
});

test('actualizarControl sin tocar presión no pisa PAMedia', async () => {
	await controles.actualizarControl(77, { pulso: 90 });
	const update = llamadas.find((l) => /UPDATE dbo\.imInterCtrlFrecuente/.test(l.sql));
	assert.equal(valorDe(update, 10), null); // COALESCE conserva el valor guardado
});

// ---------- HC de ingreso (SV_PA "120/80") ----------
test('HC de ingreso: SV_PA "120/80" guarda PAMedia 93 en el control', async () => {
	const hc = require(src('services/hcIngreso.service.js'));
	await hc.guardarSignosVitalesEnControles({
		NumeroVisita: 5,
		SV_PA: '120/80',
		SV_FC: '72',
		IdProfecional: 3,
		IdSector: 'CM1',
		IdHCIngreso: 9,
	});
	const insert = llamadas.find((l) => /INSERT INTO dbo\.imInterCtrlFrecuente/.test(l.sql));
	assert.ok(insert, 'debe insertar el control');
	assert.equal(valorDe(insert, 8), 120); // Maximo
	assert.equal(valorDe(insert, 9), 80); // Minimo
	assert.equal(valorDe(insert, 18), 93); // PAMedia
});

// ---------- Signos vitales ----------
test('signos vitales: prepararDatosControl calcula PAMedia', () => {
	const datos = signosVitales.prepararDatosControl({
		medibles: { presionMax: 120, presionMin: 80 },
		NumeroVisita: 1,
		OperadorCarga: 2,
		Profesional: 2,
		IdSector: 'CM1',
	});
	assert.equal(datos.Maximo, 120);
	assert.equal(datos.Minimo, 80);
	assert.equal(datos.PAMedia, 93);
});

test('signos vitales: sin máxima/mínima conserva la media informada', () => {
	const datos = signosVitales.prepararDatosControl({
		medibles: { presionMedia: 90 },
		NumeroVisita: 1,
	});
	assert.equal(datos.PAMedia, 90);
	const sin = signosVitales.prepararDatosControl({ medibles: { pulso: 70 }, NumeroVisita: 1 });
	assert.equal(sin.PAMedia, undefined);
});
