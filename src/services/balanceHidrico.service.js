const { executeQuery } = require('../models/db');
const { convertirHoraAClarion: horaAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi: toAnsi } = require('../utils/clarionText');
const { normalizarFilas } = require('../utils/codigoSector');

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

/** Totales clínicos: cuentan los "Paso" (volumen efectivo) + egresos. */
function calcularTotales(d) {
	const totalIngresos =
		num(d.Ing_Par_Paso) +
		num(d.Ing_Aent_Paso) +
		num(d.Ing_Apar_paso) +
		num(d.Ing_Tranf_paso);
	const totalEgresos =
		num(d.Egr_Diuresis) +
		num(d.Egr_Catarsis) +
		num(d.Egr_SNG_Vomito) +
		num(d.Egr_Drenajes);
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
    b.Egr_Diuresis,
    b.Egr_Catarsis,
    b.Egr_SNG_Vomito,
    b.Egr_Drenajes,
    b.TotalIngresos,
    b.TotalEgresos,
    b.Total,
    b.Profesional,
    b.Sector,
    COALESCE(
      NULLIF(LTRIM(RTRIM(pw.Apellido)), ''),
      NULLIF(LTRIM(RTRIM(per.ApellidoNombre)), '')
    ) AS ProfesionalApellido,
    NULLIF(LTRIM(RTRIM(pw.Nombres)), '') AS ProfesionalNombres,
    per.Matricula AS Matricula
  FROM dbo.imBalanceHidrico AS b
  LEFT JOIN dbo.imPassword AS pw
    ON pw.CodOperador = b.Profesional
    OR pw.ValorPersonal = b.Profesional
  OUTER APPLY (
    SELECT TOP 1 p.Matricula, p.ApellidoNombre
    FROM dbo.imPersonal p
    WHERE p.Valor = b.Profesional
       OR p.Matricula = b.Profesional
       OR p.Valor = pw.ValorPersonal
    ORDER BY CASE
      WHEN p.Valor = b.Profesional THEN 0
      WHEN p.Matricula = b.Profesional THEN 1
      ELSE 2
    END
  ) per
`;

/**
 * Listado por visita + fecha (SQL date nativo).
 * @param {number} numeroVisita
 * @param {string} fecha YYYY-MM-DD
 */
async function obtenerPorVisitaYFecha(numeroVisita, fecha) {
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

async function obtenerPorId(id) {
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
		Egr_Diuresis: num(data.Egr_Diuresis ?? data.egrDiuresis),
		Egr_Catarsis: num(data.Egr_Catarsis ?? data.egrCatarsis),
		Egr_SNG_Vomito: num(data.Egr_SNG_Vomito ?? data.egrSngVomito),
		Egr_Drenajes: num(data.Egr_Drenajes ?? data.egrDrenajes),
		Profesional: num(data.Profesional ?? data.profesional, null),
		Sector: sector4(data.Sector ?? data.sector ?? data.idSector),
	};
	const totales = calcularTotales(campos);
	return { ...campos, ...totales };
}

async function crear(data) {
	const p = mapPayload(data);
	if (!p.NumeroVisita) throw new Error('NumeroVisita es requerido');
	if (!p.Fecha) throw new Error('Fecha es requerida');
	if (p.Profesional == null || !Number.isFinite(p.Profesional)) {
		throw new Error('Profesional es requerido');
	}

	const sql = `
    INSERT INTO dbo.imBalanceHidrico (
      NumeroVisita, Fecha, Hora, Medicacion, Via,
      Ing_Par_Ingreso, Ing_Par_Paso,
      Ing_Aent_Alimento, Ing_Aent_Ingreso, Ing_Aent_Paso,
      Ing_Apar_Solucion, Ing_Apar_Ingreso, Ing_Apar_paso,
      Ing_Tranf_Ingreso, Ing_Tranf_paso,
      Egr_Diuresis, Egr_Catarsis, Egr_SNG_Vomito, Egr_Drenajes,
      TotalIngresos, TotalEgresos, Total,
      Profesional, Sector
    )
    OUTPUT INSERTED.IdBalanceHidrico
    VALUES (
      @param0, @param1, @param2, @param3, @param4,
      @param5, @param6,
      @param7, @param8, @param9,
      @param10, @param11, @param12,
      @param13, @param14,
      @param15, @param16, @param17, @param18,
      @param19, @param20, @param21,
      @param22, @param23
    )
  `;

	const params = [
		{ value: p.NumeroVisita },
		{ value: p.Fecha },
		{ value: p.Hora },
		{ value: p.Medicacion },
		{ value: p.Via },
		{ value: p.Ing_Par_Ingreso },
		{ value: p.Ing_Par_Paso },
		{ value: p.Ing_Aent_Alimento },
		{ value: p.Ing_Aent_Ingreso },
		{ value: p.Ing_Aent_Paso },
		{ value: p.Ing_Apar_Solucion },
		{ value: p.Ing_Apar_Ingreso },
		{ value: p.Ing_Apar_paso },
		{ value: p.Ing_Tranf_Ingreso },
		{ value: p.Ing_Tranf_paso },
		{ value: p.Egr_Diuresis },
		{ value: p.Egr_Catarsis },
		{ value: p.Egr_SNG_Vomito },
		{ value: p.Egr_Drenajes },
		{ value: p.TotalIngresos },
		{ value: p.TotalEgresos },
		{ value: p.Total },
		{ value: p.Profesional },
		{ value: p.Sector },
	];

	const result = await executeQuery(sql, params);
	const id = result?.[0]?.IdBalanceHidrico;
	return id ? obtenerPorId(id) : null;
}

async function actualizar(id, data) {
	const existing = await obtenerPorId(id);
	if (!existing) return null;

	const merged = {
		NumeroVisita: existing.NumeroVisita,
		Fecha: data.Fecha ?? data.fecha ?? existing.Fecha,
		Hora: data.Hora ?? data.hora ?? existing.Hora,
		Medicacion: data.Medicacion ?? data.medicacion ?? existing.Medicacion,
		Via: data.Via ?? data.via ?? existing.Via,
		Ing_Par_Ingreso: data.Ing_Par_Ingreso ?? data.ingParIngreso ?? existing.Ing_Par_Ingreso,
		Ing_Par_Paso: data.Ing_Par_Paso ?? data.ingParPaso ?? existing.Ing_Par_Paso,
		Ing_Aent_Alimento:
			data.Ing_Aent_Alimento ?? data.ingAentAlimento ?? existing.Ing_Aent_Alimento,
		Ing_Aent_Ingreso:
			data.Ing_Aent_Ingreso ?? data.ingAentIngreso ?? existing.Ing_Aent_Ingreso,
		Ing_Aent_Paso: data.Ing_Aent_Paso ?? data.ingAentPaso ?? existing.Ing_Aent_Paso,
		Ing_Apar_Solucion:
			data.Ing_Apar_Solucion ?? data.ingAparSolucion ?? existing.Ing_Apar_Solucion,
		Ing_Apar_Ingreso:
			data.Ing_Apar_Ingreso ?? data.ingAparIngreso ?? existing.Ing_Apar_Ingreso,
		Ing_Apar_paso:
			data.Ing_Apar_paso ?? data.Ing_Apar_Paso ?? data.ingAparPaso ?? existing.Ing_Apar_paso,
		Ing_Tranf_Ingreso:
			data.Ing_Tranf_Ingreso ?? data.ingTranfIngreso ?? existing.Ing_Tranf_Ingreso,
		Ing_Tranf_paso:
			data.Ing_Tranf_paso ??
			data.Ing_Tranf_Paso ??
			data.ingTranfPaso ??
			existing.Ing_Tranf_paso,
		Egr_Diuresis: data.Egr_Diuresis ?? data.egrDiuresis ?? existing.Egr_Diuresis,
		Egr_Catarsis: data.Egr_Catarsis ?? data.egrCatarsis ?? existing.Egr_Catarsis,
		Egr_SNG_Vomito: data.Egr_SNG_Vomito ?? data.egrSngVomito ?? existing.Egr_SNG_Vomito,
		Egr_Drenajes: data.Egr_Drenajes ?? data.egrDrenajes ?? existing.Egr_Drenajes,
		Profesional: existing.Profesional,
		Sector: data.Sector ?? data.sector ?? data.idSector ?? existing.Sector,
	};

	const p = mapPayload(merged);

	const sql = `
    UPDATE dbo.imBalanceHidrico SET
      Fecha = @param1,
      Hora = @param2,
      Medicacion = @param3,
      Via = @param4,
      Ing_Par_Ingreso = @param5,
      Ing_Par_Paso = @param6,
      Ing_Aent_Alimento = @param7,
      Ing_Aent_Ingreso = @param8,
      Ing_Aent_Paso = @param9,
      Ing_Apar_Solucion = @param10,
      Ing_Apar_Ingreso = @param11,
      Ing_Apar_paso = @param12,
      Ing_Tranf_Ingreso = @param13,
      Ing_Tranf_paso = @param14,
      Egr_Diuresis = @param15,
      Egr_Catarsis = @param16,
      Egr_SNG_Vomito = @param17,
      Egr_Drenajes = @param18,
      TotalIngresos = @param19,
      TotalEgresos = @param20,
      Total = @param21,
      Sector = @param22
    WHERE IdBalanceHidrico = @param0
  `;

	await executeQuery(sql, [
		{ value: Number(id) },
		{ value: p.Fecha },
		{ value: p.Hora },
		{ value: p.Medicacion },
		{ value: p.Via },
		{ value: p.Ing_Par_Ingreso },
		{ value: p.Ing_Par_Paso },
		{ value: p.Ing_Aent_Alimento },
		{ value: p.Ing_Aent_Ingreso },
		{ value: p.Ing_Aent_Paso },
		{ value: p.Ing_Apar_Solucion },
		{ value: p.Ing_Apar_Ingreso },
		{ value: p.Ing_Apar_paso },
		{ value: p.Ing_Tranf_Ingreso },
		{ value: p.Ing_Tranf_paso },
		{ value: p.Egr_Diuresis },
		{ value: p.Egr_Catarsis },
		{ value: p.Egr_SNG_Vomito },
		{ value: p.Egr_Drenajes },
		{ value: p.TotalIngresos },
		{ value: p.TotalEgresos },
		{ value: p.Total },
		{ value: p.Sector },
	]);

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
			num(r.Egr_SNG_Vomito) +
			num(r.Egr_Drenajes);
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
	obtenerPorId,
	crear,
	actualizar,
	eliminar,
	resumirDia,
	calcularTotales,
};
