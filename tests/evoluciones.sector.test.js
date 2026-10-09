/**
 * Ticket: al guardar una evolución se grababa el sector donde está el paciente y no el del
 * profesional que evoluciona. El sector sale de imPersonalSectores de quien está logueado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const llamadas = [];
let sectoresProfesional = [];
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => {
			llamadas.push({ sql: String(sql), params });
			if (/imPersonalSectores/i.test(sql)) return sectoresProfesional.map((idSector) => ({ idSector }));
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

const crear = async ({ valorPersonal, idSectorSesion, IdSector }) => {
	const req = {
		valorPersonal,
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
	sectoresProfesional = [];
});

test('cirujano (CIRA) evolucionando a un paciente de QUR4 graba CIRA', async () => {
	sectoresProfesional = ['CIRA'];
	const { res, sectorGrabado } = await crear({ valorPersonal: 8625, idSectorSesion: 'QUR4', IdSector: 'QUR4' });
	assert.equal(res.statusCode, 201);
	assert.equal(sectorGrabado, 'CIRA');
});

test('con varios sectores asignados respeta el elegido en el login', async () => {
	sectoresProfesional = ['EME', 'ONCP'];
	const { sectorGrabado } = await crear({ valorPersonal: 6601, idSectorSesion: 'oncp', IdSector: 'CM2' });
	assert.equal(sectorGrabado, 'ONCP');
});

test('sin sectores asignados en la clínica usa el de la sesión', async () => {
	const { sectorGrabado } = await crear({ valorPersonal: 1332, idSectorSesion: 'CM1', IdSector: 'CM2' });
	assert.equal(sectorGrabado, 'CM1');
});

test('sin sector asignado ni en sesión ni en el pedido devuelve 400', async () => {
	const { res, sectorGrabado } = await crear({ valorPersonal: 1332, idSectorSesion: null, IdSector: '' });
	assert.equal(res.statusCode, 400);
	assert.equal(sectorGrabado, undefined);
});
