const { executeQuery, getRequestPool, sql } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('../utils/dateUtils');

const FUNCION_FALLBACK = {
	1: 'Especialista',
	2: 'Ayudante 1',
	3: 'Ayudante 2',
	4: 'Anestesista',
	5: 'Instrumentista',
	6: 'Monitoreo',
	11: 'Ayudante 3',
};

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

function _s(v, max) {
	if (v == null) return '';
	const s = String(v);
	return max != null ? s.slice(0, max) : s;
}

function _padSector(v) {
	return String(v || '').trim().padEnd(4, ' ').slice(0, 4);
}

function normalizarFuncion(valor) {
	const n = Number(valor);
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
		throw _httpError('funcion inválida');
	}
	return n > 255 ? Math.floor(n / 100) : n;
}

async function listarTiposProtocolo() {
	const rows = await executeQuery(
		`SELECT LTRIM(RTRIM(TipoProtocolo)) AS tipoProtocolo,
		        LTRIM(RTRIM(Descripcion)) AS descripcion,
		        NumeroActual AS numeroActual,
		        LTRIM(RTRIM(ISNULL(IdSector, ''))) AS idSector,
		        CASE WHEN ProForma IS NULL THEN 0 ELSE 1 END AS tieneProForma
		 FROM dbo.HCTiposProtocolos
		 ORDER BY Descripcion`,
	);
	return (rows || []).map((r) => ({
		tipoProtocolo: String(r.tipoProtocolo || '').trim(),
		descripcion: String(r.descripcion || '').trim(),
		numeroActual: Number(r.numeroActual) || 0,
		idSector: String(r.idSector || '').trim() || null,
		tieneProForma: !!r.tieneProForma,
	}));
}

async function obtenerProForma(tipoProtocolo) {
	const tipo = String(tipoProtocolo || '').trim();
	const rows = await executeQuery(
		`SELECT TOP 1 CAST(ProForma AS nvarchar(max)) AS ProForma, Descripcion
		 FROM dbo.HCTiposProtocolos
		 WHERE LTRIM(RTRIM(TipoProtocolo)) = @p0`,
		[{ value: tipo, type: 'VarChar' }],
	);
	if (!rows?.length) return { proForma: '', descripcion: null };
	return {
		proForma: rows[0].ProForma != null ? String(rows[0].ProForma).trim() : '',
		descripcion: rows[0].Descripcion ? String(rows[0].Descripcion).trim() : null,
	};
}

/**
 * Busca prácticas en moduladas + nomenclador y calcula roles requeridos
 * según *Unidad > 0 (misma regla que ACLYSA).
 */
async function buscarPracticas({ q, limit = 30 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 30, 1), 80);
	if (term.length < 2) return [];
	const like = `%${term}%`;
	const rows = await executeQuery(
		`SELECT TOP ${lim} *
		 FROM (
		   SELECT
		     m.IDPractica AS idPractica,
		     'MO' AS tipoPractica,
		     LTRIM(RTRIM(ISNULL(m.Descripcion, ''))) AS descripcion,
		     ISNULL(m.EspUnidad, 0) AS espUnidad,
		     ISNULL(m.Adte1Unidad, 0) AS adte1Unidad,
		     ISNULL(m.Adte2Unidad, 0) AS adte2Unidad,
		     ISNULL(m.AstaUnidad, 0) AS astaUnidad
		   FROM dbo.imModuladas m
		   WHERE m.Descripcion LIKE @p0
		      OR CAST(m.IDPractica AS VARCHAR(20)) LIKE @p0
		   UNION ALL
		   SELECT
		     n.IDPractica,
		     'NO',
		     LTRIM(RTRIM(ISNULL(n.Descripcion, ''))),
		     ISNULL(n.EspUnidad, 0),
		     ISNULL(n.Adte1Unidad, 0),
		     ISNULL(n.Adte2Unidad, 0),
		     ISNULL(n.AstaUnidad, 0)
		   FROM dbo.imNomenclador n
		   WHERE n.Descripcion LIKE @p0
		      OR CAST(n.IDPractica AS VARCHAR(20)) LIKE @p0
		 ) x
		 ORDER BY x.descripcion`,
		[{ value: like, type: 'VarChar' }],
	);
	return (rows || []).map((r) => ({
		idPractica: Number(r.idPractica),
		tipoPractica: String(r.tipoPractica || 'NO').trim() || 'NO',
		descripcion: String(r.descripcion || '').trim(),
		funcionesRequeridas: _funcionesDesdeUnidades(r),
	}));
}

async function detallePractica(idPractica, tipoPractica = 'NO') {
	const id = Number(idPractica);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPractica inválido');
	const tipo = String(tipoPractica || 'NO').trim().toUpperCase().slice(0, 2) || 'NO';

	const preferMo = tipo === 'MO';
	const tables = preferMo
		? [
				{ name: 'imModuladas', tipo: 'MO' },
				{ name: 'imNomenclador', tipo: 'NO' },
			]
		: [
				{ name: 'imNomenclador', tipo: 'NO' },
				{ name: 'imModuladas', tipo: 'MO' },
			];

	let row = null;
	let tipoFound = tipo;
	for (const t of tables) {
		const rows = await executeQuery(
			`SELECT TOP 1
			        IDPractica AS idPractica,
			        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS descripcion,
			        ISNULL(EspUnidad, 0) AS espUnidad,
			        ISNULL(Adte1Unidad, 0) AS adte1Unidad,
			        ISNULL(Adte2Unidad, 0) AS adte2Unidad,
			        ISNULL(AstaUnidad, 0) AS astaUnidad
			 FROM dbo.${t.name}
			 WHERE IDPractica = @p0
			 ORDER BY CASE
			   WHEN ISNULL(EspUnidad,0) > 0 OR ISNULL(Adte1Unidad,0) > 0
			     OR ISNULL(Adte2Unidad,0) > 0 OR ISNULL(AstaUnidad,0) > 0 THEN 0
			   ELSE 1 END`,
			[{ value: id, type: 'Int' }],
		);
		if (rows?.[0]) {
			row = rows[0];
			tipoFound = t.tipo;
			break;
		}
	}
	if (!row) throw _httpError('Práctica no encontrada', 404);
	return {
		idPractica: Number(row.idPractica),
		tipoPractica: tipoFound,
		descripcion: String(row.descripcion || '').trim(),
		funcionesRequeridas: _funcionesDesdeUnidades(row),
	};
}

function _funcionesDesdeUnidades(r) {
	const out = [];
	if (Number(r.espUnidad) > 0) {
		out.push({ codigo: 1, nombre: 'Especialista', unidad: Number(r.espUnidad) });
	}
	if (Number(r.adte1Unidad) > 0) {
		out.push({ codigo: 2, nombre: 'Ayudante 1', unidad: Number(r.adte1Unidad) });
	}
	if (Number(r.adte2Unidad) > 0) {
		out.push({ codigo: 3, nombre: 'Ayudante 2', unidad: Number(r.adte2Unidad) });
	}
	if (Number(r.astaUnidad) > 0) {
		out.push({ codigo: 4, nombre: 'Anestesista', unidad: Number(r.astaUnidad) });
	}
	return out;
}

async function buscarProfesionales({ q, limit = 25 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 25, 1), 50);
	if (term.length < 2) return [];
	const like = `%${term}%`;
	const rows = await executeQuery(
		`SELECT TOP ${lim}
		        p.Valor AS valorPersonal,
		        p.Matricula AS matricula,
		        LTRIM(RTRIM(p.ApellidoNombre)) AS apellidoNombre
		 FROM dbo.imPersonal p
		 WHERE p.ApellidoNombre LIKE @p0
		    OR CAST(ISNULL(p.Matricula, 0) AS VARCHAR(20)) LIKE @p0
		    OR CAST(p.Valor AS VARCHAR(20)) LIKE @p0
		 ORDER BY p.ApellidoNombre`,
		[{ value: like, type: 'VarChar' }],
	);
	return (rows || []).map((r) => ({
		valorPersonal: Number(r.valorPersonal),
		matricula: r.matricula != null ? Number(r.matricula) : null,
		apellidoNombre: String(r.apellidoNombre || '').trim(),
	}));
}

async function listarPorVisita(numeroVisita) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) throw _httpError('numeroVisita inválido');

	const protocolos = await executeQuery(
		`SELECT
		   p.IdProtocolo,
		   p.NumeroProtocolo,
		   p.NumeroVisita,
		   p.IDPaciente,
		   p.Fecha,
		   LTRIM(RTRIM(ISNULL(p.TipoProtocolo, ''))) AS TipoProtocolo,
		   tp.Descripcion AS TipoDescripcion,
		   p.FechaHoraInicio,
		   p.FechaHoraFin,
		   LTRIM(RTRIM(ISNULL(p.DiagnosticoPreProcedimiento, ''))) AS DiagnosticoPre,
		   LTRIM(RTRIM(ISNULL(p.DiagnosticoPosProcedimiento, ''))) AS DiagnosticoPos,
		   LTRIM(RTRIM(ISNULL(p.Tecnica, ''))) AS Tecnica,
		   p.Texto,
		   LTRIM(RTRIM(ISNULL(p.Estado, ''))) AS Estado,
		   p.IdOperador,
		   pers.ApellidoNombre AS OperadorNombre,
		   pers.Matricula AS OperadorMatricula
		 FROM dbo.HCProtocolosPtes p
		 LEFT JOIN dbo.HCTiposProtocolos tp
		   ON LTRIM(RTRIM(tp.TipoProtocolo)) = LTRIM(RTRIM(p.TipoProtocolo))
		 LEFT JOIN dbo.imPersonal pers ON pers.Valor = p.IdOperador
		 WHERE p.NumeroVisita = @p0
		 ORDER BY p.Fecha DESC, p.IdProtocolo DESC`,
		[{ value: nv, type: 'Int' }],
	);

	if (!protocolos?.length) return [];

	const ids = protocolos.map((p) => Number(p.IdProtocolo)).filter((x) => x > 0);
	const idList = ids.join(',');

	const practicas = await executeQuery(
		`SELECT
		   fp.Valor AS valorPractica,
		   fp.IdProtocolo,
		   fp.Practica AS codigoPractica,
		   LTRIM(RTRIM(ISNULL(fp.TipoPractica, ''))) AS tipoPractica,
		   fp.CantidadPractica,
		   fp.CodOperador,
		   LTRIM(RTRIM(ISNULL(COALESCE(mo.Descripcion, no.Descripcion), ''))) AS practicaDescripcion
		 FROM dbo.imFacPracticas fp
		 OUTER APPLY (
		   SELECT TOP 1 Descripcion FROM dbo.imModuladas
		   WHERE IDPractica = fp.Practica
		 ) mo
		 OUTER APPLY (
		   SELECT TOP 1 Descripcion FROM dbo.imNomenclador
		   WHERE IDPractica = fp.Practica
		 ) no
		 WHERE fp.IdProtocolo IN (${idList})
		 ORDER BY fp.Valor`,
	);

	const valores = (practicas || []).map((p) => Number(p.valorPractica)).filter((x) => x > 0);
	let profesionales = [];
	if (valores.length) {
		profesionales = await executeQuery(
			`SELECT
			   fprof.Valor AS valorPractica,
			   fprof.Matricula AS valorPersonal,
			   fprof.Funcion,
			   LTRIM(RTRIM(ISNULL(fn.Descripcion, ''))) AS funcionNombre,
			   pers.ApellidoNombre AS apellidoNombre,
			   pers.Matricula AS matricula
			 FROM dbo.imFacProfesionales fprof
			 LEFT JOIN dbo.imFunciones fn ON fn.Valor = fprof.Funcion
			 LEFT JOIN dbo.imPersonal pers ON pers.Valor = fprof.Matricula
			 WHERE fprof.Valor IN (${valores.join(',')})
			 ORDER BY fprof.Funcion, fprof.IDFacProfesional`,
		);
	}

	const profByFac = {};
	for (const pr of profesionales || []) {
		const v = Number(pr.valorPractica);
		if (!profByFac[v]) profByFac[v] = [];
		const fn = Number(pr.Funcion) || 0;
		profByFac[v].push({
			valorPersonal: Number(pr.valorPersonal) || 0,
			matricula: pr.matricula != null ? Number(pr.matricula) : null,
			apellidoNombre: pr.apellidoNombre ? String(pr.apellidoNombre).trim() : null,
			funcion: fn,
			funcionNombre:
				(pr.funcionNombre && String(pr.funcionNombre).trim()) ||
				FUNCION_FALLBACK[fn] ||
				`Función ${fn}`,
		});
	}

	const facByProt = {};
	for (const fp of practicas || []) {
		const idP = Number(fp.IdProtocolo);
		if (!facByProt[idP]) facByProt[idP] = [];
		const valor = Number(fp.valorPractica);
		facByProt[idP].push({
			valorPractica: valor,
			codigoPractica: Number(fp.codigoPractica) || 0,
			tipoPractica: String(fp.tipoPractica || '').trim(),
			descripcion: String(fp.practicaDescripcion || '').trim() || `Práctica ${fp.codigoPractica}`,
			cantidad: Number(fp.CantidadPractica) || 1,
			profesionales: profByFac[valor] || [],
		});
	}

	return protocolos.map((p) => ({
		idProtocolo: Number(p.IdProtocolo),
		numeroProtocolo: Number(p.NumeroProtocolo) || 0,
		numeroVisita: Number(p.NumeroVisita),
		idPaciente: Number(p.IDPaciente),
		fecha: p.Fecha,
		tipoProtocolo: String(p.TipoProtocolo || '').trim(),
		tipoDescripcion: p.TipoDescripcion ? String(p.TipoDescripcion).trim() : null,
		fechaHoraInicio: p.FechaHoraInicio || null,
		fechaHoraFin: p.FechaHoraFin || null,
		diagnosticoPre: String(p.DiagnosticoPre || '').trim() || null,
		diagnosticoPos: String(p.DiagnosticoPos || '').trim() || null,
		tecnica: String(p.Tecnica || '').trim() || null,
		texto: p.Texto != null ? String(p.Texto) : '',
		estado: String(p.Estado || '').trim() || null,
		idOperador: p.IdOperador != null ? Number(p.IdOperador) : null,
		operadorNombre: p.OperadorNombre ? String(p.OperadorNombre).trim() : null,
		operadorMatricula: p.OperadorMatricula != null ? Number(p.OperadorMatricula) : null,
		practicas: facByProt[Number(p.IdProtocolo)] || [],
	}));
}

/**
 * Crea protocolo clínico + práctica facturable + equipo (imFacProfesionales).
 */
async function crearProtocolo({
	numeroVisita,
	tipoProtocolo,
	texto,
	tecnica,
	diagnosticoPre,
	diagnosticoPos,
	fechaHoraInicio,
	fechaHoraFin,
	estado,
	idOperador,
	codOperador,
	sector,
	idPractica,
	tipoPractica,
	profesionales,
}) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) throw _httpError('numeroVisita inválido');

	const op = Number(idOperador);
	if (!Number.isFinite(op) || op <= 0) {
		throw _httpError('idOperador (médico que carga) es obligatorio');
	}

	const codPractica = Number(idPractica);
	if (!Number.isFinite(codPractica) || codPractica <= 0) {
		throw _httpError('idPractica es obligatorio');
	}

	const textoFinal = String(texto || '').trim();
	if (!textoFinal) throw _httpError('La descripción del protocolo es obligatoria');

	const listaProf = Array.isArray(profesionales) ? profesionales : [];
	if (!listaProf.length) {
		throw _httpError('Debe indicar al menos un profesional del procedimiento');
	}

	const visita = await executeQuery(
		`SELECT TOP 1 NUMEROVISITA, IDPACIENTE, LTRIM(RTRIM(ISNULL(VALORSECTOR, ''))) AS Sector
		 FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: nv, type: 'Int' }],
	);
	if (!visita?.length) throw _httpError('Visita no encontrada', 404);
	const idPaciente = Number(visita[0].IDPACIENTE) || 0;
	if (idPaciente <= 0) throw _httpError('La visita no tiene paciente');

	const tipo = String(tipoProtocolo || '').trim().slice(0, 10);
	const tipoPrac = String(tipoPractica || 'NO').trim().toUpperCase().slice(0, 2) || 'NO';
	const sectorFac = _padSector(sector || visita[0].Sector || '');
	const codOp = Number(codOperador) || op;

	let numeroProtocolo = 1;
	if (tipo) {
		const tipRows = await executeQuery(
			`SELECT TOP 1 NumeroActual FROM dbo.HCTiposProtocolos
			 WHERE LTRIM(RTRIM(TipoProtocolo)) = @p0`,
			[{ value: tipo, type: 'VarChar' }],
		);
		if (tipRows?.length) {
			numeroProtocolo = (Number(tipRows[0].NumeroActual) || 0) + 1;
		}
	} else {
		const maxKit = await executeQuery(
			`SELECT ISNULL(MAX(NumeroProtocolo), 0) + 1 AS n
			 FROM dbo.HCProtocolosPtes
			 WHERE LTRIM(RTRIM(ISNULL(TipoProtocolo, ''))) = ''`,
		);
		numeroProtocolo = Number(maxKit?.[0]?.n) || 1;
	}

	const now = new Date();
	const fechaClarion = convertirFechaAClarion(fechaCalendarioArgentina(now));
	const horaClarion = convertirHoraAClarion(horaWallArgentina(true, now));

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqProt = new sql.Request(tx);
		reqProt.input('fecha', sql.DateTime, now);
		reqProt.input('visita', sql.Int, nv);
		reqProt.input('pac', sql.Int, idPaciente);
		reqProt.input('tipo', sql.VarChar(10), tipo);
		reqProt.input('nro', sql.Int, numeroProtocolo);
		reqProt.input('ini', sql.DateTime, fechaHoraInicio ? new Date(fechaHoraInicio) : null);
		reqProt.input('fin', sql.DateTime, fechaHoraFin ? new Date(fechaHoraFin) : null);
		reqProt.input('dxPre', sql.VarChar(10), _s(diagnosticoPre, 10) || null);
		reqProt.input('tec', sql.VarChar(120), _s(tecnica, 120) || null);
		reqProt.input('dxPos', sql.VarChar(10), _s(diagnosticoPos, 10) || null);
		reqProt.input('texto', sql.VarChar(sql.MAX), textoFinal);
		reqProt.input('estado', sql.Char(1), _s(estado || 'P', 1) || 'P');
		reqProt.input('op', sql.Int, op);

		const insProt = await reqProt.query(`
			INSERT INTO dbo.HCProtocolosPtes (
				Fecha, NumeroVisita, IDPaciente, TipoProtocolo, NumeroProtocolo,
				FechaHoraInicio, FechaHoraFin,
				DiagnosticoPreProcedimiento, Tecnica, DiagnosticoPosProcedimiento,
				Texto, Estado, IdOperador
			) VALUES (
				@fecha, @visita, @pac, @tipo, @nro,
				@ini, @fin,
				@dxPre, @tec, @dxPos,
				@texto, @estado, @op
			);
			SELECT SCOPE_IDENTITY() AS IdProtocolo;
		`);
		const idProtocolo = Number(insProt.recordset?.[0]?.IdProtocolo) || 0;
		if (idProtocolo <= 0) throw _httpError('No se pudo crear el protocolo', 500);

		if (tipo) {
			const reqTip = new sql.Request(tx);
			reqTip.input('tipo', sql.VarChar(10), tipo);
			reqTip.input('nro', sql.Int, numeroProtocolo);
			await reqTip.query(`
				UPDATE dbo.HCTiposProtocolos
				SET NumeroActual = @nro
				WHERE LTRIM(RTRIM(TipoProtocolo)) = @tipo
				  AND NumeroActual < @nro
			`);
		}

		const reqFac = new sql.Request(tx);
		reqFac.input('visita', sql.Int, nv);
		reqFac.input('tipoP', sql.Char(2), tipoPrac);
		reqFac.input('prac', sql.Int, codPractica);
		reqFac.input('fechaC', sql.Int, fechaClarion);
		reqFac.input('horaC', sql.Int, horaClarion);
		reqFac.input('sector', sql.VarChar(4), sectorFac);
		reqFac.input('codOp', sql.Int, codOp);
		reqFac.input('pac', sql.Int, idPaciente);
		reqFac.input('idProt', sql.Int, idProtocolo);

		const insFac = await reqFac.query(`
			INSERT INTO dbo.imFacPracticas (
				Numero, NumeroVisita, TipoPractica, Practica,
				CantidadPractica, FechaPractica, HoraPracticaInicio, HoraPracticaFin,
				ValorSector, FechaPrograma, HoraPrograma, CodOperador,
				FechaGraba, HoraGraba, Factura, Estado, Autorizada, Status,
				NroInforme, NroAutorizacion, IdPaciente, IdProtocolo
			) VALUES (
				0, @visita, @tipoP, @prac,
				1, @fechaC, @horaC, 0,
				@sector, @fechaC, @horaC, @codOp,
				@fechaC, @horaC, 0, 2, 2, 0,
				0, '', @pac, @idProt
			);
			SELECT SCOPE_IDENTITY() AS Valor;
		`);
		const valorFac = Number(insFac.recordset?.[0]?.Valor) || 0;
		if (valorFac <= 0) throw _httpError('No se pudo registrar la práctica', 500);

		for (const prof of listaProf) {
			const valorPersonal = Number(prof.valorPersonal ?? prof.matricula);
			const funcion = normalizarFuncion(prof.funcion);
			if (!Number.isFinite(valorPersonal) || valorPersonal <= 0) {
				throw _httpError('Cada profesional requiere valorPersonal válido');
			}
			const reqP = new sql.Request(tx);
			reqP.input('valor', sql.Int, valorFac);
			reqP.input('mat', sql.Int, valorPersonal);
			reqP.input('fn', sql.TinyInt, funcion);
			reqP.input('codOp', sql.Int, codOp);
			reqP.input('fechaC', sql.Int, fechaClarion);
			reqP.input('horaC', sql.Int, horaClarion);
			await reqP.query(`
				INSERT INTO dbo.imFacProfesionales (
					Valor, Matricula, Funcion, CodOperador,
					FachaGraba, HoraGraba, Factura, Status
				) VALUES (
					@valor, @mat, @fn, @codOp,
					@fechaC, @horaC, 0, 0
				);
			`);
		}

		await tx.commit();

		const lista = await listarPorVisita(nv);
		return lista.find((x) => x.idProtocolo === idProtocolo) || { idProtocolo, valorPractica: valorFac };
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		if (err.statusCode) throw err;
		throw _httpError(err.message || 'Error al crear protocolo', 500);
	}
}

module.exports = {
	listarTiposProtocolo,
	obtenerProForma,
	buscarPracticas,
	detallePractica,
	buscarProfesionales,
	listarPorVisita,
	crearProtocolo,
};
