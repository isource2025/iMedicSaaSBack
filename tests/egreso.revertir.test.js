/**
 * Quitar (revertir) el egreso de una internación: qué se limpia y cómo se reasigna la cama.
 *
 * El egreso (actualizarUltimoMovimientoVisita) escribe en tres tablas:
 *  - imVisitaMovimiento (último): FechaEgreso, HoraEgreso, DisposicionEgreso, Diagnostico (= el de egreso), Operador
 *  - imHabitacionCamas: libera la cama (U, NumeroVisita 0, FechaEgreso, Observaciones 'Egreso')
 *  - imVisita: FechaEgreso, HoraEgreso, DisposicionEgreso, DiagnosticoEgreso, OperadorEgreso
 * Revertir tiene que deshacer todo eso sin romper el historial de camas. La base está simulada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const NV = 500;
let escenario;
let txLog;

function escenarioBase() {
	return {
		visita: {
			FechaEgreso: 82000,
			HoraEgreso: 7000000,
			Diagnostico: 'R10',
			DiagnosticoEgreso: 'D64',
			ValorHabitacionCama: '02',
			ValorSector: 'EME',
			IdPaciente: 9,
			PacienteNombre: 'PEREZ JUAN',
		},
		ultimo: {
			NumeroVisita: NV,
			FechaAdmision: 81990,
			HoraAdmision: 5000000,
			FechaEgreso: 82000,
			HoraEgreso: 7000000,
			DisposicionEgreso: 1,
			Diagnostico: 'D64',
			ValorHabitacionCama: '02',
			ValorSector: 'EME',
			bedId: '02',
		},
		cama: { ValorHabitacionCama: '02', ValorEstadoCama: 'U', NumeroVisita: 0, EstadoDescripcion: 'Libre' },
		otraInternacion: false,
		usoPosterior: null,
		ocupacionAfecta: 1,
	};
}

const dbPath = require.resolve(src('models/db.js'));

class FakeRequest {
	constructor(tx) {
		this.tx = tx;
		this.inputs = {};
	}
	input(nombre, _tipo, valor) {
		this.inputs[nombre] = valor;
		return this;
	}
	async query(sqlText) {
		const q = String(sqlText);
		txLog.queries.push({ sql: q, inputs: { ...this.inputs } });
		if (/UPDATE dbo\.imHabitacionCamas/.test(q)) return { rowsAffected: [escenario.ocupacionAfecta] };
		return { rowsAffected: [1] };
	}
}

class FakeTransaction {
	async begin() {
		txLog.begin += 1;
	}
	async commit() {
		txLog.commit += 1;
	}
	async rollback() {
		txLog.rollback += 1;
	}
}

const tipo = () => 'tipo';
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		getRequestPool: async () => ({}),
		sql: { Int: 'Int', VarChar: tipo, Transaction: FakeTransaction, Request: FakeRequest },
		executeQuery: async (sqlText, params = []) => {
			const q = String(sqlText);
			if (/AS DiagnosticoEgreso/.test(q)) return escenario.visita ? [escenario.visita] : [];
			if (/FROM imVisitaMovimiento\s+WHERE NumeroVisita = @p0\s+ORDER BY/.test(q)) {
				return escenario.ultimo ? [escenario.ultimo] : [];
			}
			if (/FROM dbo\.imSectores/.test(q)) return [{ Descripcion: 'EMERGENCIA GENERAL' }];
			if (/AND NumeroVisita <> @p1/.test(q)) return escenario.otraInternacion ? [{ NumeroVisita: 777 }] : [];
			if (/imHCEpicrisis/.test(q)) return [{ n: 0 }];
			if (/FROM dbo\.imHabitacionCamas hc/.test(q)) return escenario.cama ? [escenario.cama] : [];
			if (/FROM dbo\.imVisitaMovimiento m/.test(q)) {
				txLog.usoPosteriorParams = params.map((p) => p.value);
				return escenario.usoPosterior ? [escenario.usoPosterior] : [];
			}
			if (/AS Nombre/.test(q)) return [{ Nombre: 'GOMEZ ANA' }];
			return [];
		},
	},
};

const servicio = require(src('services/visitaMovimientos.service.js'));

const consultas = (re) => txLog.queries.filter((c) => re.test(c.sql));
const updateMovimiento = () => consultas(/UPDATE dbo\.imVisitaMovimiento/)[0];
const insertMovimiento = () => consultas(/INSERT INTO dbo\.imVisitaMovimiento/)[0];
const updateCama = () => consultas(/UPDATE dbo\.imHabitacionCamas/)[0];
const updateVisita = () => consultas(/UPDATE dbo\.imVisita\b(?!Movimiento)/)[0];

test.beforeEach(() => {
	escenario = escenarioBase();
	txLog = { queries: [], begin: 0, commit: 0, rollback: 0, usoPosteriorParams: null };
});

function assertCabeceraSinEgreso() {
	const v = updateVisita();
	assert.ok(v, 'actualiza imVisita');
	for (const campo of [
		'FechaEgreso = 0',
		'HoraEgreso = 0',
		'DisposicionEgreso = 0',
		"DiagnosticoEgreso = ''",
		'OperadorEgreso = 0',
	]) {
		assert.ok(v.sql.includes(campo), `imVisita limpia ${campo}`);
	}
}

test('cama libre: vuelve a la misma cama, reabre el mismo movimiento y limpia todo el egreso', async () => {
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'libre');
	assert.equal(estado.puedeRevertir, true);

	const res = await servicio.revertirEgresoVisita(NV, { codOperador: 33 });

	const cama = updateCama();
	assert.ok(cama, 'vuelve a ocupar la cama');
	assert.equal(cama.inputs.cama, '02');
	assert.equal(cama.inputs.sec, 'EME');
	assert.equal(cama.inputs.nv, NV);
	assert.equal(cama.inputs.fi, 81990, 'la cama recupera la fecha de ingreso del movimiento');
	assert.match(cama.sql, /ValorEstadoCama = 'O'/);
	assert.match(cama.sql, /FechaEgreso = 0/);

	const mov = updateMovimiento();
	assert.equal(mov.inputs.conservar, 0, 'el mismo movimiento se reabre');
	assert.equal(mov.inputs.limpiar, 0, 'conserva cama y sector en el movimiento');
	assert.equal(mov.inputs.fa, 81990);
	assert.equal(mov.inputs.ha, 5000000);
	assert.equal(insertMovimiento(), undefined, 'no crea movimientos nuevos');

	const vis = updateVisita();
	assertCabeceraSinEgreso();
	assert.equal(vis.inputs.reubicar, 1);
	assert.equal(vis.inputs.cama, '02');
	assert.equal(vis.inputs.sec, 'EME');

	assert.equal(txLog.commit, 1);
	assert.equal(txLog.rollback, 0);
	assert.equal(res.data.sinCama, false);
	assert.equal(res.data.cama, '02');
});

test('el movimiento vuelve al diagnóstico de la internación (el egreso lo había pisado con el de egreso)', async () => {
	await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	const mov = updateMovimiento();
	assert.equal(mov.inputs.diagEgreso, 'D64');
	assert.equal(mov.inputs.diagVisita, 'R10');
	assert.match(mov.sql, /DisposicionEgreso = 0/, 'quita la condición de egreso del movimiento');
	assert.match(
		mov.sql,
		/Diagnostico = CASE[\s\S]*= LTRIM\(RTRIM\(@diagEgreso\)\)\s*THEN @diagVisita/,
		'solo restaura si el diagnóstico del movimiento es el de egreso',
	);
});

test('cama ocupada por otro: la estadía anterior queda cerrada en el historial y se abre un movimiento sin cama', async () => {
	escenario.cama = { ...escenario.cama, ValorEstadoCama: 'O', NumeroVisita: 888 };

	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'ocupada');
	assert.ok(estado.avisos.some((a) => a.codigo === 'cama_ocupada' && a.mensaje.includes('GOMEZ ANA')));

	const res = await servicio.revertirEgresoVisita(NV, { codOperador: 33 });

	assert.equal(updateCama(), undefined, 'no toca la cama del otro paciente');

	const mov = updateMovimiento();
	assert.equal(mov.inputs.conservar, 1, 'el movimiento en la cama 02 sigue cerrado');
	assert.match(mov.sql, /FechaEgreso = CASE WHEN @conservar = 1 THEN FechaEgreso ELSE 0 END/);
	assert.match(mov.sql, /ValorHabitacionCama = CASE WHEN @limpiar = 1 AND @conservar = 0 THEN ''/);

	const nuevo = insertMovimiento();
	assert.ok(nuevo, 'abre un movimiento nuevo sin cama');
	assert.equal(nuevo.inputs.feg, 82000, 'arranca en el momento del egreso');
	assert.equal(nuevo.inputs.heg, 7000000);
	assert.equal(nuevo.inputs.fa, 81990, 'copia datos del movimiento anterior');
	assert.equal(nuevo.inputs.diagVisita, 'R10');
	assert.equal(nuevo.inputs.op, '33');
	assert.match(nuevo.sql, /@fc, @hc, '', '', ''/, 'sin sector, sin cama, sin estado de cama');
	assert.match(nuevo.sql, /WHILE EXISTS/, 'si ya hay un movimiento en ese instante corre la hora');

	const vis = updateVisita();
	assertCabeceraSinEgreso();
	assert.equal(vis.inputs.reubicar, 0);
	assert.equal(vis.inputs.limpiar, 1, 'la internación queda sin cama');

	assert.equal(res.data.sinCama, true);
	assert.equal(res.data.estadiaAnteriorConservada, true);
	assert.equal(txLog.commit, 1);
});

test('cama libre pero usada por otro paciente después del egreso: no se superponen historias, queda sin cama', async () => {
	escenario.usoPosterior = { NumeroVisita: 650, Nombre: 'LOPEZ MARIA' };

	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'usada_despues');
	assert.equal(estado.puedeRevertir, true);
	assert.ok(estado.avisos.some((a) => a.codigo === 'cama_usada_despues' && a.mensaje.includes('LOPEZ MARIA')));
	assert.match(estado.mensaje, /Quedará en internación sin cama/);
	assert.deepEqual(txLog.usoPosteriorParams, [NV, '02', 'EME', 82000, 7000000], 'busca desde el momento del egreso');

	const res = await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	assert.equal(updateCama(), undefined);
	assert.equal(updateMovimiento().inputs.conservar, 1);
	assert.ok(insertMovimiento());
	assert.equal(res.data.sinCama, true);
});

test('cama fuera de servicio / limpieza: queda sin cama conservando el historial', async () => {
	escenario.cama = { ...escenario.cama, ValorEstadoCama: 'L', EstadoDescripcion: 'Limpieza' };
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'no_disponible');
	await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	assert.equal(updateCama(), undefined);
	assert.ok(insertMovimiento());
});

test('la cama ya no existe: queda sin cama conservando el historial', async () => {
	escenario.cama = null;
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'inexistente');
	await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	assert.equal(updateMovimiento().inputs.conservar, 1);
	assert.ok(insertMovimiento());
	assert.equal(updateVisita().inputs.limpiar, 1);
});

test('la cama sigue figurando con este paciente: se deja esa ubicación sin abrir otro movimiento', async () => {
	escenario.cama = { ...escenario.cama, ValorEstadoCama: 'O', NumeroVisita: NV };
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'propia');
	const res = await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	assert.ok(updateCama());
	assert.equal(updateMovimiento().inputs.conservar, 0);
	assert.equal(insertMovimiento(), undefined);
	assert.equal(res.data.sinCama, false);
});

test('el último movimiento ya no tenía cama: se reabre ese mismo, sin duplicar', async () => {
	escenario.ultimo = { ...escenario.ultimo, ValorHabitacionCama: '', ValorSector: '', bedId: '' };
	escenario.visita = { ...escenario.visita, ValorHabitacionCama: '', ValorSector: '' };
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.camaEstado, 'sin_cama');
	await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	const mov = updateMovimiento();
	assert.equal(mov.inputs.conservar, 0);
	assert.equal(mov.inputs.limpiar, 1);
	assert.equal(insertMovimiento(), undefined);
});

test('sin ningún movimiento: solo limpia el egreso de la internación', async () => {
	escenario.ultimo = null;
	escenario.visita = { ...escenario.visita, ValorHabitacionCama: '', ValorSector: '' };
	await servicio.revertirEgresoVisita(NV, { codOperador: 33 });
	assert.equal(updateMovimiento(), undefined);
	assert.equal(insertMovimiento(), undefined);
	assertCabeceraSinEgreso();
	assert.equal(txLog.commit, 1);
});

test('si el paciente ya tiene otra internación abierta no se puede quitar el egreso (y no se toca nada)', async () => {
	escenario.otraInternacion = true;
	const estado = await servicio.consultarEstadoRevertirEgreso(NV);
	assert.equal(estado.puedeRevertir, false);
	await assert.rejects(servicio.revertirEgresoVisita(NV, { codOperador: 33 }), (err) => {
		assert.equal(err.statusCode, 409);
		assert.match(err.message, /otra internación abierta/);
		return true;
	});
	assert.equal(txLog.begin, 0);
	assert.equal(txLog.queries.length, 0);
});

test('una internación sin egreso no se puede revertir', async () => {
	escenario.visita = { ...escenario.visita, FechaEgreso: 0 };
	await assert.rejects(servicio.revertirEgresoVisita(NV, { codOperador: 33 }), (err) => err.statusCode === 409);
	assert.equal(txLog.begin, 0);
});

test('si justo otro ocupa la cama entre la consulta y la reversión, se deshace todo (rollback)', async () => {
	escenario.ocupacionAfecta = 0;
	await assert.rejects(servicio.revertirEgresoVisita(NV, { codOperador: 33 }), (err) => {
		assert.equal(err.statusCode, 409);
		assert.match(err.message, /ya no está libre/);
		return true;
	});
	assert.equal(txLog.commit, 0);
	assert.equal(txLog.rollback, 1);
	assert.equal(updateVisita(), undefined, 'no llegó a limpiar la internación');
});
