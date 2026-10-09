/**
 * Al guardar una evolución se graba el sector donde está actualmente la internación
 * (cama ocupada por la visita / imVisita), no el del profesional logueado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const llamadas = [];
let sectorInternacion = '';
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => {
			llamadas.push({ sql: String(sql), params });
			if (/imHabitacionCamas/i.test(sql)) return sectorInternacion ? [{ sector: sectorInternacion }] : [];
			if (/INSERT INTO dbo\.imHCEvolucion/i.test(sql)) return [{ IdHCEvolucion: 99 }];
			return [];
		},
	},
};

const controller = require(src('controllers/evoluciones.controller.js'));

const respuesta = () => {
	const res = { statusCode: 200, body: null };
	res.status = (c) => ((res.statusCode = c), res);
	res.json = (b) => ((res.body = b), res);
	return res;
};

const crear = async ({ idSectorSesion, IdSector }) => {
	const req = {
		valorPersonal: 8625,
		idSector: idSectorSesion,
		body: {
			IdVisita: 479176,
			FechaEv: '2026-10-08',
			HoraEv: '17:11',
			IdSector,
			Evolucion: 'Paciente estable',
			NumeroDocumento: '39387619',
			Profecional: 8625,
		},
	};
	const res = respuesta();
	await controller.crearEvolucion(req, res);
	const insert = llamadas.find((l) => /INSERT INTO dbo\.imHCEvolucion/i.test(l.sql));
	return { res, sectorGrabado: insert ? insert.params[3].value : undefined };
};

test.beforeEach(() => {
	llamadas.length = 0;
	sectorInternacion = '';
});

test('profesional logueado en CIRA evolucionando a un paciente internado en QUR4 graba QUR4', async () => {
	sectorInternacion = 'QUR4';
	const { res, sectorGrabado } = await crear({ idSectorSesion: 'CIRA', IdSector: 'CIRA' });
	assert.equal(res.statusCode, 201);
	assert.equal(sectorGrabado, 'QUR4');
});

test('la ubicación actual manda aunque el pedido traiga otro sector', async () => {
	sectorInternacion = 'CM2';
	const { sectorGrabado } = await crear({ idSectorSesion: 'EME', IdSector: 'EME' });
	assert.equal(sectorGrabado, 'CM2');
});

test('si no se encuentra la ubicación usa el sector enviado', async () => {
	const { sectorGrabado } = await crear({ idSectorSesion: 'CM1', IdSector: 'CM2' });
	assert.equal(sectorGrabado, 'CM2');
});

test('sin ubicación ni sector enviado devuelve 400', async () => {
	const { res, sectorGrabado } = await crear({ idSectorSesion: 'CM1', IdSector: '' });
	assert.equal(res.statusCode, 400);
	assert.equal(sectorGrabado, undefined);
});
