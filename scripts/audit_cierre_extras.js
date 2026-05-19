/**
 * Auditoría adicional para Cierre de Turno:
 *  - imClientes (para buscar cobertura → CONTRATO)
 *  - imVisita.CONTRATO + columnas similares
 *  - CIE-10 / Diagnósticos (buscar tabla)
 *  - imHCI campos clave (motivo consulta, enfermedad actual, signos vitales)
 */
const db = require('../src/models/db');

async function q(label, sql, params = []) {
	console.log(`\n--- ${label} ---`);
	try {
		const rows = await db.executeQuery(sql, params);
		console.log(`(${rows.length} filas)`);
		console.log(JSON.stringify(rows.slice(0, 20), null, 2));
		if (rows.length > 20) console.log(`... +${rows.length - 20} filas adicionales`);
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
	}
}

(async () => {
	try {
		// ───── imClientes ─────
		await q(
			'imClientes: columnas',
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
			 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='imClientes' ORDER BY ORDINAL_POSITION`,
		);
		await q('imClientes: TOP 5', `SELECT TOP 5 * FROM dbo.imClientes`);
		await q('imClientes: COUNT', `SELECT COUNT(*) AS total FROM dbo.imClientes`);

		// ───── imVisita campos contrato/cobertura/cliente ─────
		await q(
			'imVisita: columnas relacionadas con cliente/contrato/cobertura/financ',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imVisita' AND (
			   COLUMN_NAME LIKE '%CLIENTE%' OR COLUMN_NAME LIKE '%CONTRAT%' OR
			   COLUMN_NAME LIKE '%COBERT%' OR COLUMN_NAME LIKE '%FINANC%' OR
			   COLUMN_NAME LIKE '%OBRASOC%' OR COLUMN_NAME LIKE '%ESTADO%' OR
			   COLUMN_NAME LIKE '%TIPOADMI%' OR COLUMN_NAME LIKE '%ORIGEN%' OR
			   COLUMN_NAME LIKE '%FECHA%' OR COLUMN_NAME LIKE '%HORA%' OR
			   COLUMN_NAME LIKE '%OPERADO%' OR COLUMN_NAME LIKE '%DOCTOR%'
			 ) ORDER BY ORDINAL_POSITION`,
		);

		// ───── imPacientes Cobertura ─────
		await q(
			'imPacientes: columnas relacionadas con cobertura/nAfiliado/Cliente',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imPacientes' AND (
			   COLUMN_NAME LIKE '%obert%' OR COLUMN_NAME LIKE '%filiad%' OR
			   COLUMN_NAME LIKE '%liente%' OR COLUMN_NAME LIKE '%bra%' OR
			   COLUMN_NAME LIKE '%ontrat%'
			 ) ORDER BY ORDINAL_POSITION`,
		);

		// ───── Tabla CIE-10 / diagnósticos ─────
		await q(
			'Tablas que contengan "diagn" o "cie" o "patolog" o "morbilid"',
			`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_NAME LIKE '%iagn%' OR TABLE_NAME LIKE '%cie%' OR TABLE_NAME LIKE '%cie10%'
			    OR TABLE_NAME LIKE '%atolog%' OR TABLE_NAME LIKE '%orbilid%'
			    OR TABLE_NAME LIKE '%nfermed%'
			 ORDER BY TABLE_NAME`,
		);

		// ───── imHCI signos vitales / antecedentes (campos básicos para form) ─────
		await q(
			'imHCI: campos del form básico (motivo, enf actual, signos vitales, antec)',
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imHCI' AND (
			   COLUMN_NAME LIKE 'Motivo%' OR COLUMN_NAME LIKE 'Enfermedad%' OR
			   COLUMN_NAME LIKE 'SV_%' OR COLUMN_NAME LIKE 'AP_%' OR
			   COLUMN_NAME LIKE 'AHF_%' OR COLUMN_NAME LIKE 'EVA%' OR
			   COLUMN_NAME LIKE '%Alerg%' OR COLUMN_NAME LIKE '%edicac%' OR
			   COLUMN_NAME LIKE '%Semiol%' OR COLUMN_NAME LIKE 'MotivoConsulta'
			 ) ORDER BY ORDINAL_POSITION`,
		);

		// ───── imPassword (operador logueado) ─────
		await q(
			'imPassword: columnas CodOperador / Apellido / Nombres / Matricula',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imPassword' AND (
			   COLUMN_NAME LIKE 'CodOpe%' OR COLUMN_NAME LIKE 'Apellid%' OR
			   COLUMN_NAME LIKE 'Nombr%' OR COLUMN_NAME LIKE 'atricul%' OR
			   COLUMN_NAME LIKE 'Login%' OR COLUMN_NAME LIKE 'User%'
			 ) ORDER BY ORDINAL_POSITION`,
		);

		// ───── imFacPracticas: muestra de PracticaTipo NO con Practica=420101 ─────
		await q(
			'imFacPracticas: ejemplos con Practica=420101 (CODPRACTICACONSULTA)',
			`SELECT TOP 5 Valor, NumeroVisita, TipoPractica, Practica, CantidadPractica,
			        FechaPractica, HoraPracticaInicio, ValorSector, CodOperador, Estado, Status, Autorizada
			 FROM dbo.imFacPracticas WHERE Practica = 420101 ORDER BY Valor DESC`,
		);

		// ───── imFacProfesionales: ejemplos con Funcion=1 ligados a Valor de imFacPracticas ─────
		await q(
			'imFacProfesionales: ejemplos recientes Funcion=1',
			`SELECT TOP 5 IDFacProfesional, Valor, Matricula, Funcion, CodOperador, FachaGraba, HoraGraba, Status
			 FROM dbo.imFacProfesionales WHERE Funcion=1 ORDER BY IDFacProfesional DESC`,
		);

		// ───── Última visita real (para entender flujo) ─────
		await q(
			'imVisita: última real (TIPOADMISION/CLASEPACIENTE/Diagnóstico/Operador)',
			`SELECT TOP 5 NUMEROVISITA, IDPACIENTE, FECHAADMISIONS, TIPOADMISION, CLASEPACIENTE,
			        VALORSECTOR, DOCTORASISTIENDO, DOCTORADMISOR, FECHAEGRESO, HORAEGRESO,
			        DIAGNOSTICO, CLIENTE, CONTRATO, CLASEFINANCIERA, ESTADO, ESTADOAMBULATORIO,
			        OPERADOR, OperadorEgreso
			 FROM dbo.imVisita ORDER BY NUMEROVISITA DESC`,
		);

		// ───── Catálogo CIE-10 si existe (probar nombres comunes) ─────
		for (const t of ['imDiagnosticos', 'imCie10', 'CIE10', 'imCIE10', 'Diagnosticos', 'imEnfermedades']) {
			await q(`muestra ${t}`, `SELECT TOP 2 * FROM dbo.${t}`);
		}

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
