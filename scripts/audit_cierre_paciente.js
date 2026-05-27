/**
 * Revisa registros de cierre de turno para un paciente (por DNI).
 * Uso: node scripts/audit_cierre_paciente.js [numeroDocumento]
 */
const db = require('../src/models/db');

const ARG = process.argv[2];
const ID_TURNO_ARG = ARG && String(ARG).startsWith('t') ? Number(String(ARG).slice(1)) : null;
const DNI = ID_TURNO_ARG ? null : Number(ARG || 39863295);

async function q(label, sql, params = []) {
	console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);
	try {
		const rows = await db.executeQuery(sql, params);
		console.log(`(${rows.length} fila(s))`);
		console.log(JSON.stringify(rows, null, 2));
		return rows;
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
		return [];
	}
}

(async () => {
	try {
		if (ID_TURNO_ARG) {
			const turnoDirect = await q(
				'Turno por IdTurno',
				`SELECT t.IdTurno, t.IDPaciente, t.Sector, t.Profesional, t.Status,
				        t.FechaAsignada, t.HoraAsignada, t.HoraSalida, t.NumeroVisita, t.Observaciones,
				        p.ApellidoyNombre, p.NumeroDocumento, c.RazonSocial AS Cobertura
				 FROM dbo.imTurnos t
				 LEFT JOIN dbo.imPacientes p ON p.IDPaciente = t.IDPaciente
				 LEFT JOIN dbo.imClientes c ON c.Valor = p.NumeroCuenta
				 WHERE t.IdTurno = @p0`,
				[{ value: ID_TURNO_ARG, type: 'Int' }],
			);
			if (!turnoDirect[0]) {
				console.log('Turno no encontrado:', ID_TURNO_ARG);
				process.exit(1);
			}
			await auditCierre(turnoDirect[0].IdTurno, turnoDirect[0].NumeroVisita);
			process.exit(0);
		}

		const pac = await q(
			'Paciente',
			`SELECT TOP 5 IDPaciente, ApellidoyNombre, NumeroDocumento, NumeroCuenta, FechaNacimiento, Sexo
			 FROM dbo.imPacientes WHERE NumeroDocumento = @p0 ORDER BY IDPaciente DESC`,
			[{ value: DNI, type: 'Int' }],
		);
		const idPaciente = pac[0]?.IDPaciente;
		if (!idPaciente) {
			console.log('\nNo se encontró paciente con DNI', DNI);
			process.exit(1);
		}

		const turnos = await q(
			'Turnos recientes (imTurnos) — sector CMA, atendidos',
			`SELECT TOP 5
				t.IdTurno, t.IDPaciente, t.Sector, t.Profesional, t.Status,
				t.FechaAsignada, t.HoraAsignada, t.HoraSalida, t.Horallegada, t.HoraIngreso,
				t.NumeroVisita, t.Observaciones, t.NumeroDocumento,
				p.ApellidoyNombre, c.RazonSocial AS Cobertura, c.Valor AS ContratoValor
			 FROM dbo.imTurnos t
			 INNER JOIN dbo.imPacientes p ON p.IDPaciente = t.IDPaciente
			 LEFT JOIN dbo.imClientes c ON c.Valor = p.NumeroCuenta
			 WHERE t.IDPaciente = @p0
			   AND LTRIM(RTRIM(t.Sector)) = 'CMA'
			   AND (t.Status = 2 OR t.HoraSalida > 0)
			 ORDER BY t.IdTurno DESC`,
			[{ value: idPaciente, type: 'Int' }],
		);

		const idTurno = turnos[0]?.IdTurno;
		const numeroVisita = turnos[0]?.NumeroVisita;
		if (!idTurno) {
			console.log('\nNo hay turno atendido reciente para este paciente en CMA.');
			process.exit(0);
		}

		await auditCierre(idTurno, numeroVisita);
		process.exit(0);
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
})();

async function auditCierre(idTurno, numeroVisita) {
	console.log(`\n>>> IdTurno=${idTurno}  NumeroVisita=${numeroVisita ?? '(sin visita)'}`);

	if (!numeroVisita || Number(numeroVisita) <= 0) {
		console.log('\n[!] El turno no tiene NumeroVisita asignado — el cierre puede haber fallado a medias.');
		await q('imTurnos (detalle)', `SELECT * FROM dbo.imTurnos WHERE IdTurno = @p0`, [
			{ value: idTurno, type: 'Int' },
		]);
		return;
	}

	await q(
			'imVisita',
			`SELECT TOP 1 *
			 FROM dbo.imVisita
			 WHERE NUMEROVISITA = @p0`,
			[{ value: numeroVisita, type: 'Int' }],
		);

		await q(
			'imHCI (por NumeroVisita)',
			`SELECT TOP 3
				IdHCIngreso, NumeroVisita, Fecha, IdSector, IdProfecional,
				MotivoConsulta, EnfermedadActual, Semiologia,
				SV_PA, SV_FC, SV_FR, SV_TAX, SV_GLUCEMIA,
				SV_TALLA, SV_PESOACTUAL, SV_IMPRESIONGENERAL
			 FROM dbo.imHCI
			 WHERE NumeroVisita = @p0
			 ORDER BY IdHCIngreso DESC`,
			[{ value: numeroVisita, type: 'Int' }],
		);

		await q(
			'imFacPracticas (consulta)',
			`SELECT TOP 5
				Valor, NumeroVisita, TipoPractica, Practica, CantidadPractica,
				FechaPractica, HoraPracticaInicio, ValorSector, CodOperador, IdPaciente, Estado
			 FROM dbo.imFacPracticas
			 WHERE NumeroVisita = @p0
			 ORDER BY Valor DESC`,
			[{ value: numeroVisita, type: 'Int' }],
		);

		const practicas = await db.executeQuery(
			`SELECT TOP 1 Valor FROM dbo.imFacPracticas WHERE NumeroVisita = @p0 ORDER BY Valor DESC`,
			[{ value: numeroVisita, type: 'Int' }],
		);
		const valorPractica = practicas[0]?.Valor;
		if (valorPractica) {
			await q(
				'imFacProfesionales',
				`SELECT * FROM dbo.imFacProfesionales WHERE Valor = @p0`,
				[{ value: valorPractica, type: 'Int' }],
			);
		}

		await q(
			'imInterCtrlFrecuente (RAC)',
			`SELECT IdTurno, NumeroVisita, IdControl, Valor, Fecha, Hora
			 FROM dbo.imInterCtrlFrecuente
			 WHERE IdTurno = @p0 OR NumeroVisita = @p1`,
			[
				{ value: idTurno, type: 'Int' },
				{ value: numeroVisita, type: 'Int' },
			],
		);

	await q(
		'imInterCtrlMedicamento (RAC)',
		`SELECT IdTurno, NumeroVisita, IdMedicamento, Cantidad, Fecha, Hora
		 FROM dbo.imInterCtrlMedicamento
		 WHERE IdTurno = @p0 OR NumeroVisita = @p1`,
		[
			{ value: idTurno, type: 'Int' },
			{ value: numeroVisita, type: 'Int' },
		],
	);
}
