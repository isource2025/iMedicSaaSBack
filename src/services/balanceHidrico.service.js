const { executeQuery } = require('../models/db');
const { convertirHoraAClarion: horaAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi: toAnsi } = require('../utils/clarionText');
const { normalizarFilas } = require('../utils/codigoSector');
const { sqlApplyFicha } = require('../utils/sqlNombrePersona');
const { createTenantOnce } = require('../context/tenantCache');

function num(v, fallback = 0) {
	if (v == null || v === '') return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v, max) {
	const s = toAnsi(v == null ? '' : String(v));
	return max ? s.slice(0, max) : s;
}

function sector4(v) {
	return str(v, 4).toUpperCase();
}

const TIPOS_TRANSFUSION = new Set(['GR', 'PLAQUETA', 'PLASMA']);

function tipoTransfusion(v) {
	const s = str(v, 40)
		.trim()
		.toUpperCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, '_');
	if (!s) return '';
	if (['GR', 'GLOBULO_ROJO', 'GLOBULOS_ROJOS', 'GLOBULO', 'GLOBULOS'].includes(s)) return 'GR';
	if (['PLAQUETA', 'PLAQUETAS'].includes(s)) return 'PLAQUETA';
	if (s === 'PLASMA') return 'PLASMA';
	return TIPOS_TRANSFUSION.has(s) ? s : '';
}

const COLS_EXTRA = [
	{ name: 'Ing_Tranf_Tipo', ddl: 'VARCHAR(20) NULL' },
	{ name: 'Egr_SNG', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Vomito', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Colostomia', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Ileostomia', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje1', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje1Tipo', ddl: 'VARCHAR(40) NULL' },
	{ name: 'Egr_Drenaje2', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje2Tipo', ddl: 'VARCHAR(40) NULL' },
	{ name: 'Egr_Drenaje3', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje3Tipo', ddl: 'VARCHAR(40) NULL' },
	{ name: 'Egr_Drenaje4', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje4Tipo', ddl: 'VARCHAR(40) NULL' },
	{ name: 'Egr_Drenaje5', ddl: 'FLOAT NULL' },
	{ name: 'Egr_Drenaje5Tipo', ddl: 'VARCHAR(40) NULL' },
];

const ensureSchema = createTenantOnce(async () => {
	const faltan = [];
	for (const col of COLS_EXTRA) {
		faltan.push(
			`IF COL_LENGTH(N'dbo.imBalanceHidrico', N'${col.name}') IS NULL ALTER TABLE dbo.imBalanceHidrico ADD ${col.name} ${col.ddl}`,
		);
	}
	for (const sql of faltan) await executeQuery(sql);
});

function sumaDrenajes(d) {
	let s = 0;
	for (let i = 1; i <= 5; i++) s += num(d[`Egr_Drenaje${i}`]);
	return s || num(d.Egr_Drenajes);
}

function sumaSngVomito(d) {
	const sng = num(d.Egr_SNG);
	const vom = num(d.Egr_Vomito);
	if (sng || vom) return sng + vom;
	return num(d.Egr_SNG_Vomito);
}

/** Totales clínicos: "Paso" (volumen efectivo) + egresos desglosados. */
function calcularTotales(d) {
	const totalIngresos =
		num(d.Ing_Par_Paso) +
		num(d.Ing_Aent_Paso) +
		num(d.Ing_Apar_paso) +
		num(d.Ing_Tranf_paso);
	const totalEgresos =
		num(d.Egr_Diuresis) +
		num(d.Egr_Catarsis) +
		num(d.Egr_Colostomia) +
		num(d.Egr_Ileostomia) +
		sumaSngVomito(d) +
		sumaDrenajes(d);
	return {
		TotalIngresos: totalIngresos,
		TotalEgresos: totalEgresos,
		Total: totalIngresos - totalEgresos,
	};
}

const SELECT_BALANCE = `
  SELECT
    b.IdBalanceHidrico,
    b.NumeroVisita,
    CONVERT(varchar(10), b.Fecha, 23) AS Fecha,
    b.Hora AS HoraClarion,
    CASE
      WHEN b.Hora IS NULL OR b.Hora = 0 THEN NULL
      ELSE CONVERT(varchar(8), DATEADD(ms, (NULLIF(b.Hora,0) - 1) * 10, 0), 108)
    END AS Hora,
    b.Medicacion,
    b.Via,
    b.Ing_Par_Ingreso,
    b.Ing_Par_Paso,
    b.Ing_Aent_Alimento,
    b.Ing_Aent_Ingreso,
    b.Ing_Aent_Paso,
    b.Ing_Apar_Solucion,
    b.Ing_Apar_Ingreso,
    b.Ing_Apar_paso,
    b.Ing_Tranf_Ingreso,
    b.Ing_Tranf_paso,
    b.Ing_Tranf_Tipo,
    b.Egr_Diuresis,
    b.Egr_Catarsis,
    b.Egr_Colostomia,
    b.Egr_Ileostomia,
    ISNULL(b.Egr_SNG, CASE WHEN b.Egr_Vomito IS NULL THEN b.Egr_SNG_Vomito ELSE 0 END) AS Egr_SNG,
    ISNULL(b.Egr_Vomito, 0) AS Egr_Vomito,
    b.Egr_SNG_Vomito,
    b.Egr_Drenaje1,
    b.Egr_Drenaje1Tipo,
    b.Egr_Drenaje2,
    b.Egr_Drenaje2Tipo,
    b.Egr_Drenaje3,
    b.Egr_Drenaje3Tipo,
    b.Egr_Drenaje4,
    b.Egr_Drenaje4Tipo,
    b.Egr_Drenaje5,
    b.Egr_Drenaje5Tipo,
    b.Egr_Drenajes,
    b.TotalIngresos,
    (ISNULL(b.TotalEgresos, 0) + ISNULL(b.Egr_Colostomia, 0) + ISNULL(b.Egr_Ileostomia, 0)) AS TotalEgresos,
    (ISNULL(b.TotalIngresos, 0) - (ISNULL(b.TotalEgresos, 0) + ISNULL(b.Egr_Colostomia, 0) + ISNULL(b.Egr_Ileostomia, 0))) AS Total,
    b.Profesional,
    b.Sector,
    prof.NombreCompleto AS ProfesionalApellido,
    CAST(NULL AS VARCHAR(150)) AS ProfesionalNombres,
    prof.Matricula AS Matricula,
    prof.ValorPersonal AS ValorPersonalProfesional
  FROM dbo.imBalanceHidrico AS b
  ${sqlApplyFicha('b.Profesional', 'prof')}
`;

/**
 * Listado por visita + fecha (SQL date nativo).
 * @param {number} numeroVisita
 * @param {string} fecha YYYY-MM-DD
 */
async function obtenerPorVisitaYFecha(numeroVisita, fecha) {
	await ensureSchema();
	const consulta = `
    ${SELECT_BALANCE}
    WHERE b.NumeroVisita = @param0
      AND CAST(b.Fecha AS date) = CAST(@param1 AS date)
    ORDER BY b.Hora ASC, b.IdBalanceHidrico ASC
  `;
	const rows = normalizarFilas(
		await executeQuery(consulta, [{ value: numeroVisita }, { value: fecha }]),
	);
	return rows;
}

/**
 * Listado de toda la internación (Clarion: "Mostrar sólo el día seleccionado" destildado).
 * Rango opcional desde/hasta en YYYY-MM-DD.
 * @param {number} numeroVisita
 * @param {{desde?: string, hasta?: string}} [rango]
 */
async function obtenerPorVisita(numeroVisita, rango = {}) {
	await ensureSchema();
	const params = [{ value: numeroVisita }];
	let where = 'WHERE b.NumeroVisita = @param0';
	if (rango.desde) {
		params.push({ value: String(rango.desde).slice(0, 10) });
		where += ` AND CAST(b.Fecha AS date) >= CAST(@param${params.length - 1} AS date)`;
	}
	if (rango.hasta) {
		params.push({ value: String(rango.hasta).slice(0, 10) });
		where += ` AND CAST(b.Fecha AS date) <= CAST(@param${params.length - 1} AS date)`;
	}
	const consulta = `
    ${SELECT_BALANCE}
    ${where}
    ORDER BY b.Fecha ASC, b.Hora ASC, b.IdBalanceHidrico ASC
  `;
	return normalizarFilas(await executeQuery(consulta, params));
}

async function obtenerPorId(id) {
	await ensureSchema();
	const consulta = `
    ${SELECT_BALANCE}
    WHERE b.IdBalanceHidrico = @param0
  `;
	const rows = normalizarFilas(await executeQuery(consulta, [{ value: id }]));
	return rows[0] || null;
}

function mapPayload(data) {
	const horaStr =
		data.Hora || data.hora || data.horaControl || data.HoraControl || '00:00';
	const horaNorm = String(horaStr).length === 5 ? `${horaStr}:00` : String(horaStr);
	const campos = {
		NumeroVisita: num(data.NumeroVisita ?? data.numeroVisita),
		Fecha: String(data.Fecha || data.fecha || data.fechaControl).slice(0, 10),
		Hora: horaAClarion(horaNorm),
		Medicacion: str(data.Medicacion ?? data.medicacion, 500),
		Via: str(data.Via ?? data.via, 10),
		Ing_Par_Ingreso: num(data.Ing_Par_Ingreso ?? data.ingParIngreso),
		Ing_Par_Paso: num(data.Ing_Par_Paso ?? data.ingParPaso),
		Ing_Aent_Alimento: str(data.Ing_Aent_Alimento ?? data.ingAentAlimento, 120),
		Ing_Aent_Ingreso: num(data.Ing_Aent_Ingreso ?? data.ingAentIngreso),
		Ing_Aent_Paso: num(data.Ing_Aent_Paso ?? data.ingAentPaso),
		Ing_Apar_Solucion: str(data.Ing_Apar_Solucion ?? data.ingAparSolucion, 120),
		Ing_Apar_Ingreso: num(data.Ing_Apar_Ingreso ?? data.ingAparIngreso),
		Ing_Apar_paso: num(data.Ing_Apar_paso ?? data.Ing_Apar_Paso ?? data.ingAparPaso),
		Ing_Tranf_Ingreso: num(data.Ing_Tranf_Ingreso ?? data.ingTranfIngreso),
		Ing_Tranf_paso: num(data.Ing_Tranf_paso ?? data.Ing_Tranf_Paso ?? data.ingTranfPaso),
		Ing_Tranf_Tipo: tipoTransfusion(data.Ing_Tranf_Tipo ?? data.ingTranfTipo),
		Egr_Diuresis: num(data.Egr_Diuresis ?? data.egrDiuresis),
		Egr_Catarsis: num(data.Egr_Catarsis ?? data.egrCatarsis),
		Egr_Colostomia: num(data.Egr_Colostomia ?? data.egrColostomia),
		Egr_Ileostomia: num(data.Egr_Ileostomia ?? data.egrIleostomia),
		Egr_SNG: num(data.Egr_SNG ?? data.egrSng),
		Egr_Vomito: num(data.Egr_Vomito ?? data.egrVomito),
		Egr_SNG_Vomito: 0,
		Egr_Drenajes: 0,
		Profesional: num(data.Profesional ?? data.profesional, null),
		Sector: sector4(data.Sector ?? data.sector ?? data.idSector),
	};
	for (let i = 1; i <= 5; i++) {
		campos[`Egr_Drenaje${i}`] = num(data[`Egr_Drenaje${i}`] ?? data[`egrDrenaje${i}`]);
		campos[`Egr_Drenaje${i}Tipo`] = str(
			data[`Egr_Drenaje${i}Tipo`] ?? data[`egrDrenaje${i}Tipo`],
			40,
		);
	}
	const mandoSngVomito =
		data.Egr_SNG != null ||
		data.egrSng != null ||
		data.Egr_Vomito != null ||
		data.egrVomito != null;
	if (!mandoSngVomito && !campos.Egr_SNG && !campos.Egr_Vomito) {
		campos.Egr_SNG = num(data.Egr_SNG_Vomito ?? data.egrSngVomito);
	}
	campos.Egr_SNG_Vomito = campos.Egr_SNG + campos.Egr_Vomito;
	const mandoDrenajes = [1, 2, 3, 4, 5].some(
		(i) => data[`Egr_Drenaje${i}`] != null || data[`egrDrenaje${i}`] != null,
	);
	campos.Egr_Drenajes = sumaDrenajes(campos);
	if (!mandoDrenajes && !campos.Egr_Drenajes) {
		campos.Egr_Drenajes = num(data.Egr_Drenajes ?? data.egrDrenajes);
		if (campos.Egr_Drenajes && !campos.Egr_Drenaje1) campos.Egr_Drenaje1 = campos.Egr_Drenajes;
	}
	const totales = calcularTotales(campos);
	return { ...campos, ...totales };
}

const COLS_GRABAR = [
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
	'Ing_Tranf_Tipo',
	'Egr_Diuresis',
	'Egr_Catarsis',
	'Egr_Colostomia',
	'Egr_Ileostomia',
	'Egr_SNG',
	'Egr_Vomito',
	'Egr_SNG_Vomito',
	'Egr_Drenaje1',
	'Egr_Drenaje1Tipo',
	'Egr_Drenaje2',
	'Egr_Drenaje2Tipo',
	'Egr_Drenaje3',
	'Egr_Drenaje3Tipo',
	'Egr_Drenaje4',
	'Egr_Drenaje4Tipo',
	'Egr_Drenaje5',
	'Egr_Drenaje5Tipo',
	'Egr_Drenajes',
	'Profesional',
	'Sector',
];

async function crear(data) {
	await ensureSchema();
	const p = mapPayload(data);
	if (!p.NumeroVisita) throw new Error('NumeroVisita es requerido');
	if (!p.Fecha) throw new Error('Fecha es requerida');
	if (p.Profesional == null || !Number.isFinite(p.Profesional)) {
		throw new Error('Profesional es requerido');
	}

	const cols = COLS_GRABAR;
	const sql = `
    INSERT INTO dbo.imBalanceHidrico (${cols.join(', ')})
    OUTPUT INSERTED.IdBalanceHidrico
    VALUES (${cols.map((_, i) => `@param${i}`).join(', ')})
  `;
	const result = await executeQuery(
		sql,
		cols.map((c) => ({ value: p[c] })),
	);
	const id = result?.[0]?.IdBalanceHidrico;
	return id ? obtenerPorId(id) : null;
}

async function actualizar(id, data) {
	const existing = await obtenerPorId(id);
	if (!existing) return null;

	const pick = (camel, pascal, extra) =>
		data[pascal] ?? data[camel] ?? extra ?? existing[pascal];
	const merged = {
		NumeroVisita: existing.NumeroVisita,
		Fecha: pick('fecha', 'Fecha'),
		Hora: pick('hora', 'Hora'),
		Medicacion: pick('medicacion', 'Medicacion'),
		Via: pick('via', 'Via'),
		Ing_Par_Ingreso: pick('ingParIngreso', 'Ing_Par_Ingreso'),
		Ing_Par_Paso: pick('ingParPaso', 'Ing_Par_Paso'),
		Ing_Aent_Alimento: pick('ingAentAlimento', 'Ing_Aent_Alimento'),
		Ing_Aent_Ingreso: pick('ingAentIngreso', 'Ing_Aent_Ingreso'),
		Ing_Aent_Paso: pick('ingAentPaso', 'Ing_Aent_Paso'),
		Ing_Apar_Solucion: pick('ingAparSolucion', 'Ing_Apar_Solucion'),
		Ing_Apar_Ingreso: pick('ingAparIngreso', 'Ing_Apar_Ingreso'),
		Ing_Apar_paso: data.Ing_Apar_paso ?? data.Ing_Apar_Paso ?? data.ingAparPaso ?? existing.Ing_Apar_paso,
		Ing_Tranf_Ingreso: pick('ingTranfIngreso', 'Ing_Tranf_Ingreso'),
		Ing_Tranf_paso: data.Ing_Tranf_paso ?? data.Ing_Tranf_Paso ?? data.ingTranfPaso ?? existing.Ing_Tranf_paso,
		Ing_Tranf_Tipo: pick('ingTranfTipo', 'Ing_Tranf_Tipo'),
		Egr_Diuresis: pick('egrDiuresis', 'Egr_Diuresis'),
		Egr_Catarsis: pick('egrCatarsis', 'Egr_Catarsis'),
		Egr_Colostomia: pick('egrColostomia', 'Egr_Colostomia'),
		Egr_Ileostomia: pick('egrIleostomia', 'Egr_Ileostomia'),
		Egr_SNG: pick('egrSng', 'Egr_SNG'),
		Egr_Vomito: pick('egrVomito', 'Egr_Vomito'),
		Egr_SNG_Vomito: pick('egrSngVomito', 'Egr_SNG_Vomito'),
		Egr_Drenajes: pick('egrDrenajes', 'Egr_Drenajes'),
		Profesional: existing.Profesional,
		Sector: data.Sector ?? data.sector ?? data.idSector ?? existing.Sector,
	};
	for (let i = 1; i <= 5; i++) {
		merged[`Egr_Drenaje${i}`] = pick(`egrDrenaje${i}`, `Egr_Drenaje${i}`);
		merged[`Egr_Drenaje${i}Tipo`] = pick(`egrDrenaje${i}Tipo`, `Egr_Drenaje${i}Tipo`);
	}

	const p = mapPayload(merged);
	const cols = COLS_GRABAR.filter((c) => c !== 'NumeroVisita' && c !== 'Profesional');
	const sql = `
    UPDATE dbo.imBalanceHidrico SET
      ${cols.map((c, i) => `${c} = @param${i + 1}`).join(',\n      ')}
    WHERE IdBalanceHidrico = @param0
  `;
	await executeQuery(sql, [{ value: Number(id) }, ...cols.map((c) => ({ value: p[c] }))]);

	return obtenerPorId(id);
}

async function eliminar(id) {
	await executeQuery(`DELETE FROM dbo.imBalanceHidrico WHERE IdBalanceHidrico = @param0`, [
		{ value: Number(id) },
	]);
	return true;
}

/**
 * Resumen del día: último balance parcial/total si existe; si no, suma de pasos.
 */
function resumirDia(rows) {
	const list = Array.isArray(rows) ? rows : [];
	const isBalance = (m) => /^balance/i.test(String(m || '').trim());

	let sumIng = 0;
	let sumEgr = 0;
	for (const r of list) {
		if (isBalance(r.Medicacion)) continue;
		sumIng +=
			num(r.Ing_Par_Paso) +
			num(r.Ing_Aent_Paso) +
			num(r.Ing_Apar_paso) +
			num(r.Ing_Tranf_paso);
		sumEgr +=
			num(r.Egr_Diuresis) +
			num(r.Egr_Catarsis) +
			num(r.Egr_Colostomia) +
			num(r.Egr_Ileostomia) +
			sumaSngVomito(r) +
			sumaDrenajes(r);
	}

	const balances = list.filter((r) => isBalance(r.Medicacion));
	const ultimo = balances.length ? balances[balances.length - 1] : null;

	return {
		registros: list.length,
		acumuladoIngresos: sumIng,
		acumuladoEgresos: sumEgr,
		acumuladoBalance: sumIng - sumEgr,
		ultimoBalance: ultimo
			? {
					id: ultimo.IdBalanceHidrico,
					medicacion: ultimo.Medicacion,
					hora: ultimo.Hora,
					totalIngresos: num(ultimo.TotalIngresos),
					totalEgresos: num(ultimo.TotalEgresos),
					total: num(ultimo.Total),
			  }
			: null,
	};
}

module.exports = {
	obtenerPorVisitaYFecha,
	obtenerPorVisita,
	obtenerPorId,
	crear,
	actualizar,
	eliminar,
	resumirDia,
	calcularTotales,
	tipoTransfusion,
};
