/**
 * Ticket: "al modificar una indicación con adicional no puedo agregar otro adicional".
 *
 * Parte backend: un adicional (NroAdicional = nº de la indicación principal) hereda la FechaCarga
 * de su padre. Antes se exigía "hoy o mañana" y agregar un adicional a una indicación de un día
 * anterior fallaba con 400. La base está simulada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const llamadas = [];
let fechaPadre = '2026-09-28'; // ayer o antes (no es hoy ni mañana)
let padreExiste = true;

const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => {
			const q = String(sql);
			llamadas.push({ sql: q, params });
			if (/SELECT TOP 1 CONVERT\(varchar\(10\), DATEADD\(DAY, CAST\(FechaCarga/.test(q)) {
				return padreExiste ? [{ FechaCarga: fechaPadre }] : [];
			}
			if (/COUNT\(\*\) as Total/.test(q)) return [{ Total: 1 }];
			if (/SELECT TOP 1 NroIndicacion/.test(q)) return []; // sin choque de horario
			if (/INSERT INTO dbo\.imInterIndMedicas/.test(q)) return [{ NroIndicacion: 5001 }];
			if (/SELECT Tipo FROM imInterTipoIndicacion/.test(q)) return [{ Tipo: 'M' }];
			return [];
		},
	},
};

// La validación de identidad consulta imPersonal/imPassword: aquí no es lo que se prueba.
const idPath = require.resolve(src('utils/identidadClinica.js'));
require.cache[idPath] = {
	id: idPath,
	filename: idPath,
	loaded: true,
	exports: { assertIdentidadParaIndicacion: async () => {} },
};

const { convertirFechaAClarion } = require(src('utils/dateUtils.js'));
const servicio = require(src('services/indicaciones.service.js'));

const base = {
	NumeroVisita: 100,
	TipoIndicacion: 1,
	Codigo: 55,
	CantidadIndicada: 1,
	Cantidad: 3,
	TipoUnidad: 'ML',
	Frecuencia: '8',
	ProfesionalAsiste: 7,
	OperadorCarga: 7,
	IdSector: 'CM1',
	AliasMedicamento: 'CLORURO DE POTASIO',
};

test.beforeEach(() => {
	llamadas.length = 0;
	fechaPadre = '2026-09-28';
	padreExiste = true;
});

const insertDe = () => llamadas.find((l) => /INSERT INTO dbo\.imInterIndMedicas/.test(l.sql));

test('un adicional de una indicación de un día anterior se guarda con la fecha del padre', async () => {
	const r = await servicio.nuevaIndicacion({
		...base,
		NroAdicional: 4000,
		FechaCarga: '2026-09-28', // la que el formulario copia del padre
	});
	assert.equal(r.NroIndicacion, 5001);
	const ins = insertDe();
	assert.ok(ins, 'debe insertar el adicional');
	assert.equal(ins.params[1].value, 4000, 'NroAdicional apunta al padre');
	assert.equal(ins.params[2].value, convertirFechaAClarion('2026-09-28'), 'FechaCarga = la del padre');
});

test('el adicional hereda la fecha del padre aunque el formulario mande otra', async () => {
	fechaPadre = '2026-09-27';
	await servicio.nuevaIndicacion({ ...base, NroAdicional: 4000, FechaCarga: '2030-01-01' });
	assert.equal(insertDe().params[2].value, convertirFechaAClarion('2026-09-27'));
});

test('un adicional cuyo padre no existe responde 404', async () => {
	padreExiste = false;
	await assert.rejects(
		() => servicio.nuevaIndicacion({ ...base, NroAdicional: 4000 }),
		(e) => e.statusCode === 404 && /no existe/.test(e.message),
	);
	assert.equal(insertDe(), undefined, 'no inserta nada');
});

test('una indicación principal sigue limitada a hoy o mañana', async () => {
	await assert.rejects(
		() => servicio.nuevaIndicacion({ ...base, NroAdicional: null, FechaCarga: '2020-01-01' }),
		(e) => e.statusCode === 400 && /hoy o para mañana/.test(e.message),
	);
	assert.equal(insertDe(), undefined);
});

test('el adicional incrementa HoraCarga según los adicionales ya existentes', async () => {
	await servicio.nuevaIndicacion({ ...base, NroAdicional: 4000 });
	// 1 adicional existente (stub) → +200 centésimas sobre la hora actual; debe ser un entero > 0
	assert.ok(Number.isInteger(insertDe().params[3].value));
	assert.ok(insertDe().params[3].value > 0);
});
