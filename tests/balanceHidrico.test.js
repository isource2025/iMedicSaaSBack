const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: { executeQuery: async () => [], getRequestPool: async () => ({}), sql: {} },
};
const cachePath = require.resolve(src('context/tenantCache.js'));
require.cache[cachePath] = {
	id: cachePath,
	filename: cachePath,
	loaded: true,
	exports: { createTenantOnce: (fn) => fn },
};

const svc = require(src('services/balanceHidrico.service.js'));

test('totales incluyen sonda, vómito, colostomía, ileostomía y drenajes', () => {
	const t = svc.calcularTotales({
		Ing_Par_Paso: 500,
		Ing_Aent_Paso: 0,
		Ing_Apar_paso: 0,
		Ing_Tranf_paso: 250,
		Egr_Diuresis: 200,
		Egr_Catarsis: 50,
		Egr_Colostomia: 30,
		Egr_Ileostomia: 20,
		Egr_SNG: 40,
		Egr_Vomito: 10,
		Egr_Drenaje1: 15,
		Egr_Drenaje2: 5,
	});
	assert.equal(t.TotalIngresos, 750);
	assert.equal(t.TotalEgresos, 370);
	assert.equal(t.Total, 380);
});

test('legacy SNG/Vómito combinado y drenaje único entran al total', () => {
	const t = svc.calcularTotales({
		Ing_Par_Paso: 100,
		Egr_SNG_Vomito: 80,
		Egr_Drenajes: 25,
	});
	assert.equal(t.TotalEgresos, 105);
});

test('tipo de transfusión normaliza glóbulo rojo / plaqueta / plasma', () => {
	assert.equal(svc.tipoTransfusion('glóbulo rojo'), 'GR');
	assert.equal(svc.tipoTransfusion('Plaquetas'), 'PLAQUETA');
	assert.equal(svc.tipoTransfusion('plasma'), 'PLASMA');
	assert.equal(svc.tipoTransfusion(''), '');
});
