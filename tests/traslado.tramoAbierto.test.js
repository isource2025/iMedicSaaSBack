/**
 * Si el último tramo quedó cerrado pero el paciente sigue en cama (sin egreso
 * hospitalario), el traslado debe reabrir ese tramo en lugar de devolver 409.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

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
			if (respuestas.length) return respuestas.shift();
			return [];
		},
		getRequestPool: async () => {
			throw new Error('no debería usarse');
		},
		sql: {},
	},
};

const svc = require(src('services/visitaMovimientos.service.js'));

const movimientoCerrado = {
	NumeroVisita: 3395,
	FechaAdmision: 82000,
	HoraAdmision: 1000,
	FechaEgreso: 82010,
	HoraEgreso: 2000,
	DisposicionEgreso: 0,
	Diagnostico: 'J18',
	ValorHabitacionCama: '411B',
	ValorSector: '4P',
	bedId: '411B',
	EstadoAmbulatorio: 'I',
	ServicioHospital: '',
};

const movimientoAbierto = { ...movimientoCerrado, FechaEgreso: 0, HoraEgreso: 0 };

test.beforeEach(() => {
	llamadas.length = 0;
	respuestas = [];
});

test('traslado reabre tramo cerrado si sigue en cama y sin egreso hospitalario', async () => {
	// asegurarMovimientoDeIngreso → obtenerUltimoMovimientoVisita
	respuestas.push([movimientoCerrado]);
	// obtenerMovimientoAbierto → vacío
	respuestas.push([]);
	// obtenerCabeceraVisita → sin egreso hospitalario
	respuestas.push([{ IDPaciente: 1, FechaEgreso: 0, EstadoAmbulatorio: 'I', Diagnostico: 'J18', ServicioHospital: '' }]);
	// camasOcupadasPorVisita
	respuestas.push([{ ValorHabitacionCama: '411B', ValorSector: '4P' }]);
	// UPDATE reabrir
	respuestas.push([]);
	// obtenerMovimientoAbierto tras reopen
	respuestas.push([movimientoAbierto]);
	// obtenerCabeceraVisita (segunda lectura en moverPaciente)
	respuestas.push([{ IDPaciente: 1, FechaEgreso: 0, EstadoAmbulatorio: 'I', Diagnostico: 'J18', ServicioHospital: '' }]);
	// cama actual
	respuestas.push([{ ValorHabitacionCama: '411B', ValorSector: '4P' }]);
	// cama destino libre
	respuestas.push([{ ValorHabitacionCama: '413B', ValorSector: '4P', ValorEstadoCama: 'U', EstadoDescripcion: 'Libre' }]);
	// transacción traslado
	respuestas.push([]);
	// nuevo último movimiento
	respuestas.push([{ ...movimientoAbierto, ValorHabitacionCama: '413B', bedId: '413B' }]);

	const out = await svc.moverPacienteACamaVacia(3395, {
		FechaAdmision: 82011,
		HoraAdmision: 3000,
		FechaEgreso: 82011,
		HoraEgreso: 3000,
		EstadoAmbulatorio: 'I',
		Diagnostico: 'J18',
		bedId: '413B',
		ValorSector: '4P',
		Operador: '7',
		FechaCarga: 82011,
		HoraCarga: 3000,
	});

	assert.equal(out.success, true);
	const reopen = llamadas.find((l) => /FechaEgreso = 0/.test(l.sql) && /imVisitaMovimiento/.test(l.sql) && /UPDATE/.test(l.sql));
	assert.ok(reopen, 'debe reabrir el tramo cerrado');
});

test('traslado sigue bloqueando si hay egreso hospitalario real', async () => {
	respuestas.push([movimientoCerrado]);
	respuestas.push([]); // sin abierto
	respuestas.push([{ IDPaciente: 1, FechaEgreso: 82010, EstadoAmbulatorio: 'I', Diagnostico: 'J18', ServicioHospital: '' }]);

	await assert.rejects(
		() =>
			svc.moverPacienteACamaVacia(3395, {
				FechaAdmision: 82011,
				HoraAdmision: 3000,
				FechaEgreso: 82011,
				HoraEgreso: 3000,
				EstadoAmbulatorio: 'I',
				Diagnostico: 'J18',
				bedId: '413B',
				ValorSector: '4P',
				Operador: '7',
				FechaCarga: 82011,
				HoraCarga: 3000,
			}),
		/egreso hospitalario/,
	);
});

test('si el último cerrado es de OTRA cama, abre tramo nuevo sin pisar el historial', async () => {
	const quirofanoCerrado = {
		...movimientoCerrado,
		ValorHabitacionCama: '03',
		ValorSector: 'QUI',
		bedId: '03',
		FechaAdmision: 82000,
		HoraAdmision: 5000,
		FechaEgreso: 82001,
		HoraEgreso: 1000,
	};
	const abiertoEnCama = {
		...movimientoCerrado,
		FechaAdmision: 82001,
		HoraAdmision: 1000,
		FechaEgreso: 0,
		HoraEgreso: 0,
	};

	respuestas.push([quirofanoCerrado]); // ultimo
	respuestas.push([]); // sin abierto
	respuestas.push([{ IDPaciente: 1, FechaEgreso: 0, EstadoAmbulatorio: 'I', Diagnostico: 'J18', ServicioHospital: '' }]);
	respuestas.push([{ ValorHabitacionCama: '411B', ValorSector: '4P' }]); // cama actual ≠ quirófano
	respuestas.push([]); // INSERT tramo nuevo
	respuestas.push([abiertoEnCama]); // abierto tras insert
	respuestas.push([{ IDPaciente: 1, FechaEgreso: 0, EstadoAmbulatorio: 'I', Diagnostico: 'J18', ServicioHospital: '' }]);
	respuestas.push([{ ValorHabitacionCama: '411B', ValorSector: '4P' }]);
	respuestas.push([{ ValorHabitacionCama: '413B', ValorSector: '4P', ValorEstadoCama: 'U', EstadoDescripcion: 'Libre' }]);
	respuestas.push([]); // tx
	respuestas.push([{ ...abiertoEnCama, ValorHabitacionCama: '413B', bedId: '413B' }]);

	const out = await svc.moverPacienteACamaVacia(3395, {
		FechaAdmision: 82011,
		HoraAdmision: 3000,
		FechaEgreso: 82011,
		HoraEgreso: 3000,
		EstadoAmbulatorio: 'I',
		Diagnostico: 'J18',
		bedId: '413B',
		ValorSector: '4P',
		Operador: '7',
		FechaCarga: 82011,
		HoraCarga: 3000,
	});

	assert.equal(out.success, true);
	const insert = llamadas.find((l) => /INSERT INTO dbo\.imVisitaMovimiento/.test(l.sql));
	assert.ok(insert, 'debe insertar tramo nuevo en la cama actual');
	const reopenOverwrite = llamadas.find(
		(l) =>
			/UPDATE dbo\.imVisitaMovimiento/.test(l.sql) &&
			/ValorHabitacionCama = CASE/.test(l.sql),
	);
	assert.equal(reopenOverwrite, undefined, 'no debe pisar el quirófano con la cama actual');
});
