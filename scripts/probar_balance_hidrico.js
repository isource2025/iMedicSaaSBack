/**
 * Pruebas de balance hídrico con payloads estilo front.
 * Solo borra IDs creados en esta corrida (nunca LIKE con corchetes).
 *
 * Uso: node scripts/probar_balance_hidrico.js
 */
require('dotenv').config();
const svc = require('../src/services/balanceHidrico.service');
const { executeQuery } = require('../src/models/db');

const TAG = '__TEST_BH__';
const createdIds = [];

function assert(cond, msg) {
	if (!cond) throw new Error(`ASSERT: ${msg}`);
}
function ok(msg) {
	console.log(`  ✓ ${msg}`);
}

function payloadFront(overrides = {}) {
	return {
		NumeroVisita: overrides.NumeroVisita,
		Fecha: overrides.Fecha || '2026-09-24',
		Hora: overrides.Hora || '10:30',
		Medicacion: overrides.Medicacion ?? `${TAG} PHP SF`,
		Via: overrides.Via ?? '',
		Ing_Par_Ingreso: overrides.Ing_Par_Ingreso ?? 500,
		Ing_Par_Paso: overrides.Ing_Par_Paso ?? 350,
		Ing_Aent_Alimento: overrides.Ing_Aent_Alimento ?? '',
		Ing_Aent_Ingreso: overrides.Ing_Aent_Ingreso ?? 0,
		Ing_Aent_Paso: overrides.Ing_Aent_Paso ?? 0,
		Ing_Apar_Solucion: overrides.Ing_Apar_Solucion ?? '',
		Ing_Apar_Ingreso: overrides.Ing_Apar_Ingreso ?? 0,
		Ing_Apar_paso: overrides.Ing_Apar_paso ?? 0,
		Ing_Tranf_Ingreso: overrides.Ing_Tranf_Ingreso ?? 0,
		Ing_Tranf_paso: overrides.Ing_Tranf_paso ?? 0,
		Egr_Diuresis: overrides.Egr_Diuresis ?? 0,
		Egr_Catarsis: overrides.Egr_Catarsis ?? 0,
		Egr_SNG_Vomito: overrides.Egr_SNG_Vomito ?? 0,
		Egr_Drenajes: overrides.Egr_Drenajes ?? 0,
		Sector: (overrides.Sector || 'UTI').slice(0, 4),
		Profesional: overrides.Profesional ?? 4440,
	};
}

async function pickVisitaActiva() {
	const rows = await executeQuery(`
    SELECT TOP 1 NumeroVisita, Sector
    FROM dbo.imBalanceHidrico
    WHERE Fecha >= DATEADD(day, -30, CAST(GETDATE() AS date))
    ORDER BY IdBalanceHidrico DESC
  `);
	return rows?.[0] || null;
}

async function revisarEsquema() {
	console.log('\n== 1) Esquema dbo.imBalanceHidrico ==');
	const cols = await executeQuery(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imBalanceHidrico'
    ORDER BY ORDINAL_POSITION
  `);
	const names = cols.map((c) => c.COLUMN_NAME);
	const expected = [
		'IdBalanceHidrico',
		'NumeroVisita',
		'Fecha',
		'Hora',
		'Medicacion',
		'Via',
		'Ing_Par_Ingreso',
		'Ing_Par_Paso',
		'Ing_Aent_Alimento',
		'Ing_Aent_Ingreso',
		'Ing_Aent_Paso',
		'Ing_Apar_Solucion',
		'Ing_Apar_Ingreso',
		'Ing_Apar_paso',
		'Ing_Tranf_Ingreso',
		'Ing_Tranf_paso',
		'Egr_Diuresis',
		'Egr_Catarsis',
		'Egr_SNG_Vomito',
		'Egr_Drenajes',
		'TotalIngresos',
		'TotalEgresos',
		'Total',
		'Profesional',
		'Sector',
	];
	for (const e of expected) assert(names.includes(e), `falta columna ${e}`);
	ok('25 columnas presentes');

	const computed = await executeQuery(`
    SELECT c.name, cc.definition
    FROM sys.columns c
    JOIN sys.computed_columns cc ON c.object_id = cc.object_id AND c.column_id = cc.column_id
    WHERE c.object_id = OBJECT_ID('dbo.imBalanceHidrico')
  `);
	const compNames = (computed || []).map((c) => c.name);
	assert(compNames.includes('TotalIngresos'), 'TotalIngresos computed');
	assert(compNames.includes('TotalEgresos'), 'TotalEgresos computed');
	assert(compNames.includes('Total'), 'Total computed');
	ok(`computed: ${compNames.join(', ')}`);
	for (const c of computed) {
		console.log(`     ${c.name} = ${c.definition}`);
	}

	assert(cols.find((c) => c.COLUMN_NAME === 'Fecha').DATA_TYPE === 'date', 'Fecha=date');
	assert(cols.find((c) => c.COLUMN_NAME === 'Hora').DATA_TYPE === 'int', 'Hora=int');
	ok('Fecha SQL date + Hora Clarion int');
}

async function revisarTotales() {
	console.log('\n== 2) calcularTotales (preview UI; DB lo calcula sola) ==');
	const t = svc.calcularTotales({
		Ing_Par_Paso: 350,
		Ing_Aent_Paso: 100,
		Ing_Apar_paso: 50,
		Ing_Tranf_paso: 0,
		Egr_Diuresis: 200,
		Egr_Catarsis: 50,
		Egr_SNG_Vomito: 0,
		Egr_Drenajes: 0,
	});
	assert(t.TotalIngresos === 500 && t.TotalEgresos === 250 && t.Total === 250, JSON.stringify(t));
	ok('preview 500 - 250 = 250');
}

async function probarErrores() {
	console.log('\n== 3) Errores esperados ==');
	try {
		await svc.crear(payloadFront({ NumeroVisita: null }));
		throw new Error('debía fallar sin visita');
	} catch (e) {
		ok(`sin visita: ${e.message}`);
	}
	try {
		await svc.crear(payloadFront({ NumeroVisita: 1, Fecha: '' }));
		throw new Error('debía fallar sin fecha');
	} catch (e) {
		ok(`sin fecha: ${e.message}`);
	}
	try {
		await svc.crear({ ...payloadFront({ NumeroVisita: 1 }), Profesional: null });
		throw new Error('debía fallar sin profesional');
	} catch (e) {
		ok(`sin profesional: ${e.message}`);
	}
	assert((await svc.obtenerPorId(-1)) === null, 'get -1');
	ok('GET inexistente → null');
	assert((await svc.actualizar(-99999, payloadFront({ NumeroVisita: 1 }))) === null, 'put -1');
	ok('PUT inexistente → null');
}

async function probarCrud(visita, sector) {
	console.log(`\n== 4) CRUD estilo front (visita ${visita}) ==`);
	const fecha = new Date();
	const fechaISO = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

	const creado = await svc.crear(
		payloadFront({
			NumeroVisita: visita,
			Fecha: fechaISO,
			Hora: '11:15',
			Medicacion: `${TAG} PHP`,
			Ing_Par_Ingreso: 500,
			Ing_Par_Paso: 350,
			Sector: sector || 'UTI',
		}),
	);
	createdIds.push(creado.IdBalanceHidrico);
	assert(Number(creado.TotalIngresos) === 350, `TotalIngresos=${creado.TotalIngresos}`);
	assert(Number(creado.Total) === 350, `Total=${creado.Total}`);
	assert(String(creado.Hora).startsWith('11:15'), `Hora=${creado.Hora}`);
	ok(`POST registro id=${creado.IdBalanceHidrico} TotalIngresos=350 (computed)`);

	const parcial = await svc.crear(
		payloadFront({
			NumeroVisita: visita,
			Fecha: fechaISO,
			Hora: '14:00',
			Medicacion: `${TAG} BALANCE PARCIAL`,
			Ing_Par_Ingreso: 0,
			Ing_Par_Paso: 1000,
			Ing_Aent_Alimento: 'GLUCERNA',
			Ing_Aent_Ingreso: 300,
			Ing_Aent_Paso: 300,
			Egr_Diuresis: 1200,
			Egr_Catarsis: 200,
			Sector: sector || 'UTI',
		}),
	);
	createdIds.push(parcial.IdBalanceHidrico);
	assert(Number(parcial.TotalIngresos) === 1300, `ing=${parcial.TotalIngresos}`);
	assert(Number(parcial.TotalEgresos) === 1400, `egr=${parcial.TotalEgresos}`);
	assert(Number(parcial.Total) === -100, `bal=${parcial.Total}`);
	ok(`POST parcial id=${parcial.IdBalanceHidrico} balance=-100`);

	const list = await svc.obtenerPorVisitaYFecha(visita, fechaISO);
	const mine = list.filter((r) => String(r.Medicacion || '').includes(TAG));
	assert(mine.length >= 2, `mine=${mine.length}`);
	const resumen = svc.resumirDia(list);
	ok(`GET byDate ${list.length} filas; resumen ok (${resumen.registros})`);

	const upd = await svc.actualizar(creado.IdBalanceHidrico, {
		...payloadFront({
			NumeroVisita: visita,
			Fecha: fechaISO,
			Hora: '11:20',
			Medicacion: `${TAG} PHP EDIT`,
			Ing_Par_Ingreso: 500,
			Ing_Par_Paso: 400,
			Sector: sector || 'UTI',
		}),
	});
	assert(Number(upd.TotalIngresos) === 400, `upd=${upd.TotalIngresos}`);
	ok(`PUT Paso 350→400 TotalIngresos=400`);

	const sec = await svc.crear(
		payloadFront({
			NumeroVisita: visita,
			Fecha: fechaISO,
			Hora: '15:00',
			Medicacion: `${TAG} SECTOR`,
			Ing_Par_Paso: 10,
			Sector: 'UTIIIIEXTRA',
		}),
	);
	createdIds.push(sec.IdBalanceHidrico);
	assert(String(sec.Sector).length <= 4, `Sector=${sec.Sector}`);
	ok(`Sector truncado: "${sec.Sector}"`);

	await svc.eliminar(sec.IdBalanceHidrico);
	createdIds.pop();
	assert((await svc.obtenerPorId(sec.IdBalanceHidrico)) === null, 'deleted');
	ok(`DELETE id=${sec.IdBalanceHidrico}`);
}

async function cleanup() {
	console.log('\n== 5) Cleanup solo IDs de esta corrida ==');
	for (const id of [...createdIds]) {
		await svc.eliminar(id);
		ok(`borrado ${id}`);
	}
	createdIds.length = 0;
}

(async () => {
	let exit = 0;
	try {
		await revisarEsquema();
		await revisarTotales();
		await probarErrores();
		const v = await pickVisitaActiva();
		assert(v?.NumeroVisita, 'sin visitas para probar');
		await probarCrud(Number(v.NumeroVisita), v.Sector);
		console.log('\nOK — todas las pruebas pasaron');
	} catch (e) {
		exit = 1;
		console.error('\nFALLO:', e.message || e);
	} finally {
		try {
			await cleanup();
		} catch (e) {
			console.error('cleanup error', e.message);
			exit = 1;
		}
	}
	process.exit(exit);
})();
