const { executeQuery, getRequestPool, sql } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	partesFechaHoraArgentina,
} = require('../utils/dateUtils');
const { sqlApplyNombrePersona } = require('../utils/sqlNombrePersona');

/**
 * IdOperador: la web graba el ValorPersonal de quien carga; el escritorio, su CodOperador
 * (el mismo que deja en imFacPracticas). Ambos números pueden ser de personas distintas.
 */
const SQL_APPLY_OPERADOR_PROTOCOLO = `
		 ${sqlApplyNombrePersona('p.IdOperador', 'opCod', ['operador', 'valor'])}
		 ${sqlApplyNombrePersona('p.IdOperador', 'opVal', ['valor', 'operador'])}
		 OUTER APPLY (
		   SELECT CASE WHEN EXISTS (
		       SELECT 1 FROM dbo.imFacPracticas fpo
		       WHERE fpo.IdProtocolo = p.IdProtocolo
		         AND fpo.NumeroVisita = p.NumeroVisita
		         AND fpo.CodOperador = p.IdOperador
		     ) THEN 1 ELSE 0 END AS EsEscritorio
		 ) origen
		 OUTER APPLY (
		   SELECT CASE WHEN origen.EsEscritorio = 1 THEN opCod.NombreCompleto ELSE opVal.NombreCompleto END AS NombreCompleto,
		          CASE WHEN origen.EsEscritorio = 1 THEN opCod.Matricula ELSE opVal.Matricula END AS Matricula
		 ) op`;

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
		throw _httpError('Rol de profesional inválido. Elegí un rol de la lista.');
	}
	return n > 255 ? Math.floor(n / 100) : n;
}

/**
 * Los DATETIME del HIS guardan hora de pared argentina sin zona; tedious serializa los
 * Date por sus campos UTC, así que la hora argentina va puesta ahí (igual que estudios).
 */
function _wallAhora() {
	const { fecha, hora } = partesFechaHoraArgentina(new Date());
	return new Date(`${fecha}T${hora}Z`);
}

/**
 * Acepta "YYYY-MM-DDTHH:mm[:ss]" / "YYYY-MM-DD HH:mm" (hora de pared argentina, lo que
 * manda un <input type="datetime-local">), "YYYY-MM-DD" o un ISO con zona.
 * Devuelve partes de pared + Clarion, o null si viene vacío.
 */
function _parseFechaHora(v, campo) {
	if (v == null || String(v).trim() === '') return null;
	const s = String(v).trim();
	let fecha;
	let hora;
	const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
	if (m && !m[4]) {
		fecha = m[1];
		hora = m[2] ? `${m[2]}:${m[3] || '00'}` : '00:00:00';
	} else {
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) throw _httpError(`${campo} inválida. Revisá día y hora.`);
		const p = partesFechaHoraArgentina(d);
		fecha = p.fecha;
		hora = p.hora;
	}
	const wall = new Date(`${fecha}T${hora}Z`);
	if (Number.isNaN(wall.getTime())) throw _httpError(`${campo} inválida. Revisá día y hora.`);
	return {
		fecha,
		hora,
		wall,
		clarionFecha: convertirFechaAClarion(fecha),
		clarionHora: convertirHoraAClarion(hora),
	};
}

/** Fecha/hora del procedimiento: fin obligatorio (es la fecha de la práctica), inicio opcional. */
function _resolverFechasProcedimiento({ fechaHoraInicio, fechaHoraFin }) {
	const fin = _parseFechaHora(fechaHoraFin, 'Fecha/hora de fin');
	if (!fin) {
		throw _httpError('Falta la fecha y hora de fin. Es la fecha con la que se facturan las prácticas.');
	}
	const inicio = _parseFechaHora(fechaHoraInicio, 'Fecha/hora de inicio');
	if (inicio && inicio.wall.getTime() > fin.wall.getTime()) {
		throw _httpError('El inicio es posterior al fin. Corregí alguna de las dos fechas.');
	}
	return {
		inicio,
		fin,
		// Lo que va a imFacPracticas: fecha de la práctica = fecha de fin.
		fechaPractica: fin.clarionFecha,
		horaInicio: (inicio || fin).clarionHora,
		horaFin: fin.clarionHora,
	};
}

const TIPOS_PRACTICA = new Set(['MO', 'NO']);

/**
 * Normaliza la lista de prácticas del body. Acepta el formato nuevo
 * (`practicas: [{ idPractica, tipoPractica, cantidad, profesionales }]`) y el anterior
 * de una sola práctica (`idPractica`, `tipoPractica`, `profesionales`).
 */
function _normalizarPracticas(body) {
	let lista = Array.isArray(body.practicas) ? body.practicas : null;
	if (!lista && body.idPractica != null) {
		lista = [
			{
				idPractica: body.idPractica,
				tipoPractica: body.tipoPractica,
				profesionales: body.profesionales,
			},
		];
	}
	if (!lista) return null;
	if (!lista.length) throw _httpError('El protocolo necesita al menos una práctica. Agregá una.');

	return lista.map((p, i) => {
		const n = i + 1;
		const idPractica = Number(p?.idPractica);
		if (!Number.isFinite(idPractica) || idPractica <= 0) {
			throw _httpError(`Práctica ${n}: falta el código. Buscala y elegila de la lista.`);
		}
		const tipoPractica = String(p?.tipoPractica || 'NO').trim().toUpperCase().slice(0, 2) || 'NO';
		if (!TIPOS_PRACTICA.has(tipoPractica)) {
			throw _httpError(`Práctica ${n}: tipo inválido (debe ser MO o NO). Volvé a elegirla de la lista.`);
		}
		const cantidad = p?.cantidad == null || p.cantidad === '' ? 1 : Number(p.cantidad);
		if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
			throw _httpError(`Práctica ${n}: la cantidad debe ser un número entre 1 y 999.`);
		}
		const valorPractica =
			p?.valorPractica != null && Number(p.valorPractica) > 0 ? Number(p.valorPractica) : null;
		const profs = Array.isArray(p?.profesionales) ? p.profesionales : [];
		// Sin equipo solo se admite en una práctica ya existente (el escritorio deja algunas
		// sin profesionales); actualizarProtocolo lo rechaza si esa práctica no está facturada.
		if (!profs.length && !valorPractica) {
			throw _httpError(`Práctica ${n}: no tiene equipo. Asigná al menos un profesional.`);
		}
		const profesionales = profs.map((pr) => {
			const valorPersonal = Number(pr?.valorPersonal ?? pr?.matricula);
			if (!Number.isFinite(valorPersonal) || valorPersonal <= 0) {
				throw _httpError(`Práctica ${n}: hay un profesional sin identificar. Volvé a buscarlo y elegirlo.`);
			}
			return { valorPersonal, funcion: normalizarFuncion(pr?.funcion) };
		});
		return { valorPractica, idPractica, tipoPractica, cantidad, profesionales };
	});
}

const RUBROS_MED = { MEDICAMENTO: 'Medicamento', DESCARTABLE: 'Descartable' };

/** El escritorio graba el rubro como STRING(15): 'Medicamento    ' / 'Descartable    '. */
function _rubroMed(v) {
	const k = String(v || '').trim().toUpperCase();
	const base = RUBROS_MED[k] || (k.startsWith('DESC') ? RUBROS_MED.DESCARTABLE : RUBROS_MED.MEDICAMENTO);
	return base.padEnd(15, ' ');
}

function _normalizarMedicamentos(lista) {
	if (!Array.isArray(lista)) return null;
	return lista.map((m, i) => {
		const idProducto = Number(m?.idProducto);
		if (!Number.isFinite(idProducto) || idProducto <= 0) {
			throw _httpError(`Medicamento ${i + 1}: no está identificado. Quitalo y buscalo de nuevo en el vademécum.`);
		}
		const cantidad = m?.cantidad == null || m.cantidad === '' ? null : Number(m.cantidad);
		if (cantidad != null && (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 99999)) {
			throw _httpError(`Medicamento ${i + 1}: la cantidad debe ser un número entero (0 o más).`);
		}
		return {
			idProducto,
			rubro: _rubroMed(m?.rubro),
			cantidad,
			unidad: _s(m?.unidad, 20).trim(),
			descripcion: _s(m?.descripcion, 80).trim(),
			orden: Math.min((i + 1) * 10, 250),
		};
	});
}

/** Práctica bloqueada para edición: ya facturada o ya valorizada por facturación (Status 100). */
const SQL_PRACTICA_BLOQUEADA = `(ISNULL(fp.Factura, 0) <> 0 OR ISNULL(fp.Status, 0) = 100)`;

async function _insertarPractica(tx, ctx, prac) {
	const req = new sql.Request(tx);
	req.input('visita', sql.Int, ctx.numeroVisita);
	req.input('tipoP', sql.Char(2), prac.tipoPractica);
	req.input('prac', sql.Int, prac.idPractica);
	req.input('cant', sql.Int, prac.cantidad);
	req.input('fechaP', sql.Int, ctx.fechas.fechaPractica);
	req.input('horaIni', sql.Int, ctx.fechas.horaInicio);
	req.input('horaFin', sql.Int, ctx.fechas.horaFin);
	req.input('fechaC', sql.Int, ctx.fechaClarion);
	req.input('horaC', sql.Int, ctx.horaClarion);
	req.input('sector', sql.VarChar(4), ctx.sectorFac);
	req.input('codOp', sql.Int, ctx.codOp);
	req.input('pac', sql.Int, ctx.idPaciente);
	req.input('idProt', sql.Int, ctx.idProtocolo);
	const r = await req.query(`
		INSERT INTO dbo.imFacPracticas (
			Numero, NumeroVisita, TipoPractica, Practica,
			CantidadPractica, FechaPractica, HoraPracticaInicio, HoraPracticaFin,
			ValorSector, FechaPrograma, HoraPrograma, CodOperador,
			FechaGraba, HoraGraba, Factura, Estado, Autorizada, Status,
			NroInforme, NroAutorizacion, IdPaciente, IdProtocolo
		) VALUES (
			0, @visita, @tipoP, @prac,
			@cant, @fechaP, @horaIni, @horaFin,
			@sector, @fechaC, @horaC, @codOp,
			@fechaC, @horaC, 0, 2, 2, 0,
			0, '', @pac, @idProt
		);
		SELECT SCOPE_IDENTITY() AS Valor;
	`);
	const valor = Number(r.recordset?.[0]?.Valor) || 0;
	if (valor <= 0) throw _httpError('No se pudo registrar la práctica. Intentá de nuevo.', 500);
	return valor;
}

async function _reemplazarEquipo(tx, ctx, valorFac, profesionales) {
	const del = new sql.Request(tx);
	del.input('valor', sql.Int, valorFac);
	await del.query(`DELETE FROM dbo.imFacProfesionales WHERE Valor = @valor`);
	for (const prof of profesionales) {
		const req = new sql.Request(tx);
		req.input('valor', sql.Int, valorFac);
		req.input('mat', sql.Int, prof.valorPersonal);
		req.input('fn', sql.TinyInt, prof.funcion);
		req.input('codOp', sql.Int, ctx.codOp);
		req.input('fechaC', sql.Int, ctx.fechaClarion);
		req.input('horaC', sql.Int, ctx.horaClarion);
		await req.query(`
			INSERT INTO dbo.imFacProfesionales (
				Valor, Matricula, Funcion, CodOperador,
				FachaGraba, HoraGraba, Factura, Status
			) VALUES (
				@valor, @mat, @fn, @codOp,
				@fechaC, @horaC, 0, 0
			);
		`);
	}
}

async function _reemplazarMedicamentos(tx, idProtocolo, medicamentos) {
	const del = new sql.Request(tx);
	del.input('id', sql.Int, idProtocolo);
	await del.query(`DELETE FROM dbo.HCProtocolosMedicamentos WHERE IdProtocolo = @id`);
	for (const m of medicamentos) {
		const req = new sql.Request(tx);
		req.input('id', sql.Int, idProtocolo);
		req.input('rubro', sql.VarChar(20), m.rubro);
		req.input('prod', sql.Int, m.idProducto);
		req.input('cant', sql.Int, m.cantidad);
		req.input('unidad', sql.VarChar(20), m.unidad);
		req.input('orden', sql.TinyInt, m.orden);
		req.input('desc', sql.VarChar(80), m.descripcion);
		await req.query(`
			INSERT INTO dbo.HCProtocolosMedicamentos (
				IdProtocolo, Rubro, IdProducto, Cantidad, Unidad, OrdenEnProtocolo, Descripcion
			) VALUES (
				@id, @rubro, @prod, @cant, @unidad, @orden,
				ISNULL(NULLIF(@desc, ''), (SELECT TOP 1 LEFT(LTRIM(RTRIM(Nombre)), 80) FROM dbo.imVademecum WHERE Troquel = @prod))
			)
		`);
	}
}

/** Catálogo de productos (imVademecum) para medicamentos/descartables del protocolo. */
async function buscarMedicamentos({ q, limit = 30 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 30, 1), 80);
	if (term.length < 2) return [];
	const like = `%${term}%`;
	const likeStart = `${term}%`;
	const exact = /^\d+$/.test(term) ? Number(term) : null;
	const rows = await executeQuery(
		`SELECT TOP ${lim}
		        v.Troquel AS idProducto,
		        LTRIM(RTRIM(ISNULL(v.Nombre, ''))) AS nombre,
		        LTRIM(RTRIM(ISNULL(v.Presentacion, ''))) AS presentacion,
		        LTRIM(RTRIM(ISNULL(v.TipoMedicamento, ''))) AS tipoMedicamento,
		        LTRIM(RTRIM(ISNULL(v.UNIDAD, ''))) AS unidad
		 FROM dbo.imVademecum v
		 WHERE v.Troquel > 0
		   AND ISNULL(v.Baja, '') <> '1'
		   AND (v.Nombre LIKE @p0 OR v.Alias LIKE @p0 OR v.Componentes LIKE @p0
		        OR (@p1 IS NOT NULL AND v.Troquel = @p1))
		 ORDER BY
		   CASE WHEN @p1 IS NOT NULL AND v.Troquel = @p1 THEN 0
		        WHEN v.Nombre LIKE @p2 THEN 1
		        WHEN v.Nombre LIKE @p0 THEN 2
		        ELSE 3 END,
		   v.Nombre`,
		[
			{ value: like, type: 'VarChar' },
			{ value: exact, type: 'Int' },
			{ value: likeStart, type: 'VarChar' },
		],
	);
	return (rows || []).map((r) => ({
		idProducto: Number(r.idProducto),
		nombre: String(r.nombre || '').trim(),
		presentacion: String(r.presentacion || '').trim() || null,
		rubro: String(r.tipoMedicamento || '').trim().toUpperCase().startsWith('DESC')
			? RUBROS_MED.DESCARTABLE
			: RUBROS_MED.MEDICAMENTO,
		unidad: String(r.unidad || '').trim() || null,
	}));
}

/** Medicamentos por defecto de un tipo de protocolo (HCTiposProtocolosMeds). */
async function medicamentosPorDefecto(tipoProtocolo) {
	const tipo = String(tipoProtocolo || '').trim();
	const rows = await executeQuery(
		`SELECT d.IdProducto, LTRIM(RTRIM(d.Rubro)) AS Rubro, d.CantidadPorDefecto,
		        LTRIM(RTRIM(ISNULL(d.Unidad, ''))) AS Unidad, d.OrdenEnProtocolo,
		        LTRIM(RTRIM(ISNULL(NULLIF(d.Descripcion, ''), v.Nombre))) AS Descripcion,
		        LTRIM(RTRIM(ISNULL(v.Presentacion, ''))) AS Presentacion
		 FROM dbo.HCTiposProtocolosMeds d
		 LEFT JOIN dbo.imVademecum v ON v.Troquel = d.IdProducto
		 WHERE LTRIM(RTRIM(d.TipoProtocolo)) = @p0
		 ORDER BY d.OrdenEnProtocolo, d.IdProducto`,
		[{ value: tipo, type: 'VarChar' }],
	);
	return (rows || []).map((r) => ({
		idProducto: Number(r.IdProducto),
		rubro: _rubroMed(r.Rubro).trim(),
		cantidad: r.CantidadPorDefecto != null ? Number(r.CantidadPorDefecto) : null,
		unidad: String(r.Unidad || '').trim() || null,
		descripcion: String(r.Descripcion || '').trim(),
		presentacion: String(r.Presentacion || '').trim() || null,
	}));
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
	const exactId = /^\d+$/.test(term) ? term : null;
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
		 ORDER BY
		   CASE WHEN @p1 IS NOT NULL AND CAST(x.idPractica AS VARCHAR(20)) = @p1 THEN 0 ELSE 1 END,
		   x.descripcion`,
		[
			{ value: like, type: 'VarChar' },
			{ value: exactId, type: 'VarChar' },
		],
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
	if (!Number.isFinite(id) || id <= 0) throw _httpError('Código de práctica inválido.');
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
	if (!row) throw _httpError('La práctica no existe en nomenclador ni en moduladas.', 404);
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
	const likeAny = `%${term}%`;
	const likeWord = `% ${term}%`;
	const likeStart = `${term}%`;
	const rows = await executeQuery(
		`SELECT TOP ${lim}
		        p.Valor AS valorPersonal,
		        p.Matricula AS matricula,
		        LTRIM(RTRIM(p.ApellidoNombre)) AS apellidoNombre
		 FROM dbo.imPersonal p
		 WHERE LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))) LIKE @p0
		    OR LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))) LIKE @p1
		    OR CAST(ISNULL(p.Matricula, 0) AS VARCHAR(20)) LIKE @p2
		    OR CAST(ISNULL(p.Matricula, 0) AS VARCHAR(20)) LIKE @p0
		    OR CAST(p.Valor AS VARCHAR(20)) LIKE @p2
		 ORDER BY
		   CASE
		     WHEN CAST(ISNULL(p.Matricula, 0) AS VARCHAR(20)) = @p3 THEN 0
		     WHEN CAST(ISNULL(p.Matricula, 0) AS VARCHAR(20)) LIKE @p2 THEN 1
		     WHEN LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))) LIKE @p2 THEN 2
		     ELSE 3
		   END,
		   p.ApellidoNombre`,
		[
			{ value: likeAny, type: 'VarChar' },
			{ value: likeWord, type: 'VarChar' },
			{ value: likeStart, type: 'VarChar' },
			{ value: term, type: 'VarChar' },
		],
	);
	return (rows || []).map((r) => ({
		valorPersonal: Number(r.valorPersonal),
		matricula: r.matricula != null ? Number(r.matricula) : null,
		apellidoNombre: String(r.apellidoNombre || '').trim(),
	}));
}

/** DATETIME de pared → "YYYY-MM-DDTHH:mm:ss" sin zona (el front lo muestra tal cual). */
function _isoPared(v) {
	if (v == null) return null;
	const s = String(v).trim();
	return s ? s.replace(' ', 'T').slice(0, 19) : null;
}

async function listarPorVisita(numeroVisita) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) throw _httpError('Visita inválida. Volvé a abrir la internación.');

	const protocolos = await executeQuery(
		`SELECT
		   p.IdProtocolo,
		   p.NumeroProtocolo,
		   p.NumeroVisita,
		   p.IDPaciente,
		   CONVERT(varchar(19), p.Fecha, 126) AS Fecha,
		   LTRIM(RTRIM(ISNULL(p.TipoProtocolo, ''))) AS TipoProtocolo,
		   tp.Descripcion AS TipoDescripcion,
		   CONVERT(varchar(19), p.FechaHoraInicio, 126) AS FechaHoraInicio,
		   CONVERT(varchar(19), p.FechaHoraFin, 126) AS FechaHoraFin,
		   LTRIM(RTRIM(ISNULL(p.DiagnosticoPreProcedimiento, ''))) AS DiagnosticoPre,
		   LTRIM(RTRIM(ISNULL(p.DiagnosticoPosProcedimiento, ''))) AS DiagnosticoPos,
		   LTRIM(RTRIM(ISNULL(p.Tecnica, ''))) AS Tecnica,
		   p.Texto,
		   LTRIM(RTRIM(ISNULL(p.Estado, ''))) AS Estado,
		   p.IdOperador,
		   op.NombreCompleto AS OperadorNombre,
		   op.Matricula AS OperadorMatricula
		 FROM dbo.HCProtocolosPtes p
		 LEFT JOIN dbo.HCTiposProtocolos tp
		   ON LTRIM(RTRIM(tp.TipoProtocolo)) = LTRIM(RTRIM(p.TipoProtocolo))
		 ${SQL_APPLY_OPERADOR_PROTOCOLO}
		 WHERE p.NumeroVisita = @p0
		 ORDER BY p.Fecha DESC, p.IdProtocolo DESC`,
		[{ value: nv, type: 'Int' }],
	);

	if (!protocolos?.length) return [];

	const ids = protocolos.map((p) => Number(p.IdProtocolo)).filter((x) => x > 0);
	const idList = ids.join(',');

	// Siempre acotado a la visita: IdProtocolo es un contador propio de HCProtocolosPtes.
	const practicas = await executeQuery(
		`SELECT
		   fp.Valor AS valorPractica,
		   fp.IdProtocolo,
		   fp.Practica AS codigoPractica,
		   LTRIM(RTRIM(ISNULL(fp.TipoPractica, ''))) AS tipoPractica,
		   fp.CantidadPractica,
		   fp.FechaPractica,
		   fp.HoraPracticaInicio,
		   fp.HoraPracticaFin,
		   fp.CodOperador,
		   CASE WHEN ${SQL_PRACTICA_BLOQUEADA} THEN 1 ELSE 0 END AS bloqueada,
		   ISNULL(fp.Status, 0) AS Status,
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
		   AND fp.NumeroVisita = @p0
		 ORDER BY fp.Valor`,
		[{ value: nv, type: 'Int' }],
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
			   pers.NombreCompleto AS apellidoNombre,
			   pers.Matricula AS matricula
			 FROM dbo.imFacProfesionales fprof
			 LEFT JOIN dbo.imFunciones fn ON fn.Valor = fprof.Funcion
			 ${sqlApplyNombrePersona('fprof.Matricula', 'pers', ['valor', 'matricula'])}
			 WHERE fprof.Valor IN (${valores.join(',')})
			 ORDER BY fprof.Funcion, fprof.IDFacProfesional`,
		);
	}

	const medicamentos = await executeQuery(
		`SELECT m.IdProtocoloMedicamento, m.IdProtocolo, m.IdProducto,
		        LTRIM(RTRIM(ISNULL(m.Rubro, ''))) AS Rubro, m.Cantidad,
		        LTRIM(RTRIM(ISNULL(m.Unidad, ''))) AS Unidad, m.OrdenEnProtocolo,
		        LTRIM(RTRIM(ISNULL(NULLIF(m.Descripcion, ''), v.Nombre))) AS Descripcion,
		        LTRIM(RTRIM(ISNULL(v.Presentacion, ''))) AS Presentacion
		 FROM dbo.HCProtocolosMedicamentos m
		 LEFT JOIN dbo.imVademecum v ON v.Troquel = m.IdProducto
		 WHERE m.IdProtocolo IN (${idList})
		 ORDER BY m.IdProtocolo, m.OrdenEnProtocolo, m.IdProtocoloMedicamento`,
	).catch(() => []);

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
			facturada: Number(fp.bloqueada) === 1,
			status: Number(fp.Status) || 0,
			profesionales: profByFac[valor] || [],
		});
	}

	const medsByProt = {};
	for (const m of medicamentos || []) {
		const idP = Number(m.IdProtocolo);
		if (!medsByProt[idP]) medsByProt[idP] = [];
		medsByProt[idP].push({
			idProtocoloMedicamento: Number(m.IdProtocoloMedicamento),
			idProducto: Number(m.IdProducto),
			rubro: String(m.Rubro || '').trim(),
			cantidad: m.Cantidad != null ? Number(m.Cantidad) : null,
			unidad: String(m.Unidad || '').trim() || null,
			orden: Number(m.OrdenEnProtocolo) || 0,
			descripcion: String(m.Descripcion || '').trim(),
			presentacion: String(m.Presentacion || '').trim() || null,
		});
	}

	return protocolos.map((p) => {
		const practicasProt = facByProt[Number(p.IdProtocolo)] || [];
		return {
			idProtocolo: Number(p.IdProtocolo),
			numeroProtocolo: Number(p.NumeroProtocolo) || 0,
			numeroVisita: Number(p.NumeroVisita),
			idPaciente: Number(p.IDPaciente),
			fecha: _isoPared(p.Fecha),
			tipoProtocolo: String(p.TipoProtocolo || '').trim(),
			tipoDescripcion: p.TipoDescripcion ? String(p.TipoDescripcion).trim() : null,
			fechaHoraInicio: _isoPared(p.FechaHoraInicio),
			fechaHoraFin: _isoPared(p.FechaHoraFin),
			diagnosticoPre: String(p.DiagnosticoPre || '').trim() || null,
			diagnosticoPos: String(p.DiagnosticoPos || '').trim() || null,
			tecnica: String(p.Tecnica || '').trim() || null,
			texto: p.Texto != null ? String(p.Texto) : '',
			estado: String(p.Estado || '').trim() || null,
			idOperador: p.IdOperador != null ? Number(p.IdOperador) : null,
			operadorNombre: p.OperadorNombre ? String(p.OperadorNombre).trim() : null,
			operadorMatricula: p.OperadorMatricula != null ? Number(p.OperadorMatricula) : null,
			practicas: practicasProt,
			tieneFacturadas: practicasProt.some((x) => x.facturada),
			medicamentos: medsByProt[Number(p.IdProtocolo)] || [],
		};
	});
}

/**
 * Crea la cabecera (HCProtocolosPtes) + N prácticas facturables (imFacPracticas por
 * IdProtocolo), cada una con su equipo (imFacProfesionales por Valor), + medicamentos
 * (HCProtocolosMedicamentos). Mismo modelo que el escritorio.
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
	practicas,
	medicamentos,
	// compat: una sola práctica
	idPractica,
	tipoPractica,
	profesionales,
}) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) throw _httpError('Visita inválida. Volvé a abrir la internación.');

	const op = Number(idOperador);
	if (!Number.isFinite(op) || op <= 0) {
		throw _httpError('No se pudo identificar quién carga el protocolo. Cerrá sesión y volvé a ingresar.');
	}

	const textoFinal = String(texto || '').trim();
	if (!textoFinal) throw _httpError('Falta la descripción del protocolo. Escribí el texto clínico.');

	const listaPrac = _normalizarPracticas({ practicas, idPractica, tipoPractica, profesionales });
	if (!listaPrac) throw _httpError('El protocolo necesita al menos una práctica. Agregá una.');
	const listaMeds = _normalizarMedicamentos(medicamentos) || [];
	const fechas = _resolverFechasProcedimiento({ fechaHoraInicio, fechaHoraFin });

	const visita = await executeQuery(
		`SELECT TOP 1 NUMEROVISITA, IDPACIENTE, LTRIM(RTRIM(ISNULL(VALORSECTOR, ''))) AS Sector
		 FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: nv, type: 'Int' }],
	);
	if (!visita?.length) throw _httpError('La visita no existe. Volvé a abrir la internación.', 404);
	const idPaciente = Number(visita[0].IDPACIENTE) || 0;
	if (idPaciente <= 0) throw _httpError('La visita no tiene paciente asociado. Revisala en admisión.');

	const tipo = String(tipoProtocolo || '').trim().slice(0, 10);
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

	const ahora = partesFechaHoraArgentina(new Date());
	const ctx = {
		numeroVisita: nv,
		idPaciente,
		sectorFac,
		codOp,
		fechas,
		fechaClarion: convertirFechaAClarion(ahora.fecha),
		horaClarion: convertirHoraAClarion(ahora.hora),
		idProtocolo: 0,
	};

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqProt = new sql.Request(tx);
		reqProt.input('fecha', sql.DateTime, _wallAhora());
		reqProt.input('visita', sql.Int, nv);
		reqProt.input('pac', sql.Int, idPaciente);
		reqProt.input('tipo', sql.VarChar(10), tipo);
		reqProt.input('nro', sql.Int, numeroProtocolo);
		reqProt.input('ini', sql.DateTime, fechas.inicio ? fechas.inicio.wall : null);
		reqProt.input('fin', sql.DateTime, fechas.fin.wall);
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
		if (idProtocolo <= 0) throw _httpError('No se pudo crear el protocolo. Intentá de nuevo.', 500);
		ctx.idProtocolo = idProtocolo;

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

		for (const prac of listaPrac) {
			const valorFac = await _insertarPractica(tx, ctx, prac);
			await _reemplazarEquipo(tx, ctx, valorFac, prac.profesionales);
		}

		if (listaMeds.length) await _reemplazarMedicamentos(tx, idProtocolo, listaMeds);

		await tx.commit();

		const lista = await listarPorVisita(nv);
		return lista.find((x) => x.idProtocolo === idProtocolo) || { idProtocolo };
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		if (err.statusCode) throw err;
		console.error('[protocolos] crear:', err.message);
		throw _httpError('No se pudo guardar el protocolo. No se grabó nada; intentá de nuevo.', 500);
	}
}

async function _protocoloConPracticas(idProtocolo) {
	const id = Number(idProtocolo);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('Protocolo inválido. Actualizá la lista.');
	const rows = await executeQuery(
		`SELECT TOP 1 IdProtocolo, NumeroVisita, IDPaciente, IdOperador,
		        LTRIM(RTRIM(ISNULL(TipoProtocolo, ''))) AS TipoProtocolo,
		        CONVERT(varchar(19), FechaHoraInicio, 126) AS FechaHoraInicio,
		        CONVERT(varchar(19), FechaHoraFin, 126) AS FechaHoraFin
		 FROM dbo.HCProtocolosPtes WHERE IdProtocolo = @p0`,
		[{ value: id, type: 'Int' }],
	);
	if (!rows?.length) throw _httpError('El protocolo ya no existe. Actualizá la lista.', 404);
	const numeroVisita = Number(rows[0].NumeroVisita);
	const practicas = await executeQuery(
		`SELECT fp.Valor, fp.Practica, LTRIM(RTRIM(ISNULL(fp.TipoPractica, ''))) AS TipoPractica,
		        fp.CantidadPractica, LTRIM(RTRIM(ISNULL(fp.ValorSector, ''))) AS ValorSector,
		        CASE WHEN ${SQL_PRACTICA_BLOQUEADA} THEN 1 ELSE 0 END AS bloqueada
		 FROM dbo.imFacPracticas fp WHERE fp.IdProtocolo = @p0 AND fp.NumeroVisita = @p1
		 ORDER BY fp.Valor`,
		[
			{ value: id, type: 'Int' },
			{ value: numeroVisita, type: 'Int' },
		],
	);
	return {
		idProtocolo: id,
		numeroVisita,
		idPaciente: Number(rows[0].IDPaciente) || 0,
		idOperador: rows[0].IdOperador != null ? Number(rows[0].IdOperador) : null,
		tipoProtocolo: String(rows[0].TipoProtocolo || '').trim(),
		fechaHoraInicio: _isoPared(rows[0].FechaHoraInicio),
		fechaHoraFin: _isoPared(rows[0].FechaHoraFin),
		practicas: (practicas || []).map((p) => ({
			valor: Number(p.Valor),
			codigo: Number(p.Practica) || 0,
			tipo: String(p.TipoPractica || '').trim(),
			cantidad: Number(p.CantidadPractica) || 1,
			sector: String(p.ValorSector || '').trim(),
			facturada: Number(p.bloqueada) === 1,
		})),
	};
}

async function _equipoDePractica(valorFac) {
	const rows = await executeQuery(
		`SELECT Matricula, Funcion FROM dbo.imFacProfesionales WHERE Valor = @p0 ORDER BY Funcion, Matricula`,
		[{ value: valorFac, type: 'Int' }],
	);
	return (rows || []).map((r) => `${Number(r.Funcion) || 0}:${Number(r.Matricula) || 0}`).sort();
}

/**
 * Edita cabecera, prácticas (alta / modificación / baja), equipos y medicamentos.
 * Las prácticas ya facturadas o valorizadas (Status 100) quedan bloqueadas: no se pueden
 * quitar ni cambiar (código, cantidad, equipo); el resto se puede editar libremente y
 * siempre se pueden agregar prácticas nuevas.
 *
 * - `practicas` ausente → no se tocan (compat: `profesionales` reemplaza el equipo de la
 *   primera práctica, como la versión anterior).
 * - `medicamentos` ausente → no se tocan; array → se reemplazan.
 */
async function actualizarProtocolo(
	idProtocolo,
	{
		texto,
		tecnica,
		diagnosticoPre,
		diagnosticoPos,
		estado,
		fechaHoraInicio,
		fechaHoraFin,
		practicas,
		medicamentos,
		profesionales,
		codOperador,
		sector,
		tipoProtocolo,
	},
) {
	const actual = await _protocoloConPracticas(idProtocolo);

	// El tipo define la numeración (HCTiposProtocolos.NumeroActual): no se reasigna.
	if (tipoProtocolo !== undefined && String(tipoProtocolo || '').trim() !== actual.tipoProtocolo) {
		throw _httpError(
			'El tipo de protocolo no se puede cambiar. Borrá el protocolo y crealo de nuevo con el tipo correcto.',
			409,
		);
	}

	const textoFinal = String(texto || '').trim();
	if (!textoFinal) throw _httpError('Falta la descripción del protocolo. Escribí el texto clínico.');

	let listaPrac = _normalizarPracticas({ practicas });
	if (!listaPrac && Array.isArray(profesionales) && actual.practicas.length) {
		// Compat (payload anterior): `profesionales` reemplaza el equipo de la primera
		// práctica; las demás se mandan tal cual están para que no se interpreten como baja.
		const entrada = [];
		for (let i = 0; i < actual.practicas.length; i++) {
			const p = actual.practicas[i];
			let equipo = profesionales;
			if (i > 0) {
				const eq = await executeQuery(
					`SELECT Matricula AS valorPersonal, Funcion AS funcion
					 FROM dbo.imFacProfesionales WHERE Valor = @p0`,
					[{ value: p.valor, type: 'Int' }],
				);
				equipo = (eq || []).map((e) => ({
					valorPersonal: Number(e.valorPersonal),
					funcion: Number(e.funcion) || 0,
				}));
			}
			entrada.push({
				valorPractica: p.valor,
				idPractica: p.codigo,
				tipoPractica: p.tipo || 'NO',
				cantidad: p.cantidad,
				profesionales: equipo,
			});
		}
		listaPrac = _normalizarPracticas({ practicas: entrada });
	}
	const listaMeds = _normalizarMedicamentos(medicamentos);

	// Fechas: si no se mandan se conservan las actuales; fin sigue siendo obligatorio.
	const fechas = _resolverFechasProcedimiento({
		fechaHoraInicio: fechaHoraInicio !== undefined ? fechaHoraInicio : actual.fechaHoraInicio,
		fechaHoraFin: fechaHoraFin !== undefined ? fechaHoraFin : actual.fechaHoraFin,
	});
	const cambiaFechas =
		fechaHoraInicio !== undefined || fechaHoraFin !== undefined;

	// Plan de prácticas.
	const porValor = new Map(actual.practicas.map((p) => [p.valor, p]));
	const plan = { insertar: [], actualizar: [], eliminar: [] };
	if (listaPrac) {
		const vistos = new Set();
		for (const prac of listaPrac) {
			if (prac.valorPractica) {
				const existente = porValor.get(prac.valorPractica);
				if (!existente) {
					throw _httpError('Una práctica no pertenece a este protocolo. Cerrá y volvé a abrir la edición.', 409);
				}
				vistos.add(prac.valorPractica);
				if (existente.facturada) {
					const equipoActual = await _equipoDePractica(existente.valor);
					const equipoNuevo = prac.profesionales
						.map((p) => `${p.funcion}:${p.valorPersonal}`)
						.sort();
					const cambia =
						existente.codigo !== prac.idPractica ||
						existente.cantidad !== prac.cantidad ||
						equipoActual.join('|') !== equipoNuevo.join('|');
					if (cambia) {
						throw _httpError(
							`La práctica ${existente.codigo} ya pasó a facturación: no se puede modificar. Pedí a facturación que la libere.`,
							409,
						);
					}
					continue;
				}
				if (!prac.profesionales.length) {
					throw _httpError(`La práctica ${existente.codigo} no tiene equipo. Asigná al menos un profesional.`);
				}
				plan.actualizar.push({ ...prac, existente });
			} else {
				plan.insertar.push(prac);
			}
		}
		for (const p of actual.practicas) {
			if (vistos.has(p.valor)) continue;
			if (p.facturada) {
				throw _httpError(
					`La práctica ${p.codigo} ya pasó a facturación: no se puede quitar. Pedí a facturación que la libere.`,
					409,
				);
			}
			plan.eliminar.push(p);
		}
		if (!plan.insertar.length && !plan.actualizar.length && !vistos.size) {
			throw _httpError(
				'El protocolo debe tener al menos una práctica. Para descartarlo entero, borrá el protocolo.',
			);
		}
	}

	const ahora = partesFechaHoraArgentina(new Date());
	const sectorBase = sector || actual.practicas[0]?.sector || '';
	const ctx = {
		numeroVisita: actual.numeroVisita,
		idPaciente: actual.idPaciente,
		sectorFac: _padSector(sectorBase),
		codOp: Number(codOperador) || actual.idOperador || 0,
		fechas,
		fechaClarion: convertirFechaAClarion(ahora.fecha),
		horaClarion: convertirHoraAClarion(ahora.hora),
		idProtocolo: actual.idProtocolo,
	};
	if (!ctx.sectorFac.trim()) {
		const v = await executeQuery(
			`SELECT TOP 1 LTRIM(RTRIM(ISNULL(VALORSECTOR, ''))) AS Sector FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
			[{ value: actual.numeroVisita, type: 'Int' }],
		);
		ctx.sectorFac = _padSector(v?.[0]?.Sector || '');
	}

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const reqProt = new sql.Request(tx);
		reqProt.input('id', sql.Int, actual.idProtocolo);
		reqProt.input('dxPre', sql.VarChar(10), _s(diagnosticoPre, 10) || null);
		reqProt.input('tec', sql.VarChar(120), _s(tecnica, 120) || null);
		reqProt.input('dxPos', sql.VarChar(10), _s(diagnosticoPos, 10) || null);
		reqProt.input('texto', sql.VarChar(sql.MAX), textoFinal);
		reqProt.input('estado', sql.Char(1), _s(estado, 1) || null);
		reqProt.input('ini', sql.DateTime, fechas.inicio ? fechas.inicio.wall : null);
		reqProt.input('fin', sql.DateTime, fechas.fin.wall);
		await reqProt.query(`
			UPDATE dbo.HCProtocolosPtes SET
				DiagnosticoPreProcedimiento = @dxPre,
				Tecnica = @tec,
				DiagnosticoPosProcedimiento = @dxPos,
				Texto = @texto,
				Estado = COALESCE(@estado, Estado),
				FechaHoraInicio = @ini,
				FechaHoraFin = @fin
			WHERE IdProtocolo = @id
		`);

		for (const p of plan.eliminar) {
			const req = new sql.Request(tx);
			req.input('valor', sql.Int, p.valor);
			await req.query(`
				DELETE FROM dbo.imFacProfesionales WHERE Valor = @valor;
				DELETE FROM dbo.imFacPracticas
				WHERE Valor = @valor AND NOT (ISNULL(Factura, 0) <> 0 OR ISNULL(Status, 0) = 100);
			`);
		}

		for (const prac of plan.actualizar) {
			const req = new sql.Request(tx);
			req.input('valor', sql.Int, prac.existente.valor);
			req.input('tipoP', sql.Char(2), prac.tipoPractica);
			req.input('prac', sql.Int, prac.idPractica);
			req.input('cant', sql.Int, prac.cantidad);
			req.input('fechaP', sql.Int, fechas.fechaPractica);
			req.input('horaIni', sql.Int, fechas.horaInicio);
			req.input('horaFin', sql.Int, fechas.horaFin);
			await req.query(`
				UPDATE dbo.imFacPracticas SET
					TipoPractica = @tipoP,
					Practica = @prac,
					CantidadPractica = @cant,
					FechaPractica = @fechaP,
					HoraPracticaInicio = @horaIni,
					HoraPracticaFin = @horaFin
				WHERE Valor = @valor
				  AND NOT (ISNULL(Factura, 0) <> 0 OR ISNULL(Status, 0) = 100)
			`);
			await _reemplazarEquipo(tx, ctx, prac.existente.valor, prac.profesionales);
		}

		for (const prac of plan.insertar) {
			const valorFac = await _insertarPractica(tx, ctx, prac);
			await _reemplazarEquipo(tx, ctx, valorFac, prac.profesionales);
		}

		// Sin lista de prácticas pero con fechas nuevas: se propagan a las no facturadas.
		if (!listaPrac && cambiaFechas) {
			const req = new sql.Request(tx);
			req.input('id', sql.Int, actual.idProtocolo);
			req.input('visita', sql.Int, actual.numeroVisita);
			req.input('fechaP', sql.Int, fechas.fechaPractica);
			req.input('horaIni', sql.Int, fechas.horaInicio);
			req.input('horaFin', sql.Int, fechas.horaFin);
			await req.query(`
				UPDATE dbo.imFacPracticas SET
					FechaPractica = @fechaP, HoraPracticaInicio = @horaIni, HoraPracticaFin = @horaFin
				WHERE IdProtocolo = @id AND NumeroVisita = @visita
				  AND NOT (ISNULL(Factura, 0) <> 0 OR ISNULL(Status, 0) = 100)
			`);
		}

		if (listaMeds) await _reemplazarMedicamentos(tx, actual.idProtocolo, listaMeds);

		await tx.commit();
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		if (err.statusCode) throw err;
		console.error('[protocolos] actualizar:', err.message);
		throw _httpError('No se pudieron guardar los cambios. El protocolo quedó como estaba; intentá de nuevo.', 500);
	}

	const lista = await listarPorVisita(actual.numeroVisita);
	return lista.find((x) => x.idProtocolo === actual.idProtocolo) || null;
}

/** Borra protocolo + prácticas + equipos + medicamentos. Bloqueado si alguna práctica se facturó. */
async function eliminarProtocolo(idProtocolo) {
	const actual = await _protocoloConPracticas(idProtocolo);
	if (actual.practicas.some((p) => p.facturada)) {
		throw _httpError(
			'No se puede borrar: tiene prácticas que ya pasaron a facturación. Pedí a facturación que las libere.',
			409,
		);
	}

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const req = new sql.Request(tx);
		req.input('id', sql.Int, actual.idProtocolo);
		req.input('visita', sql.Int, actual.numeroVisita);
		await req.query(`
			DELETE FROM dbo.imFacProfesionales
			WHERE Valor IN (
				SELECT Valor FROM dbo.imFacPracticas WHERE IdProtocolo = @id AND NumeroVisita = @visita
			);
			DELETE FROM dbo.imFacPracticas WHERE IdProtocolo = @id AND NumeroVisita = @visita;
			DELETE FROM dbo.HCProtocolosMedicamentos WHERE IdProtocolo = @id;
			DELETE FROM dbo.HCProtocolosPtes WHERE IdProtocolo = @id AND NumeroVisita = @visita;
		`);
		await tx.commit();
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		console.error('[protocolos] eliminar:', err.message);
		throw _httpError('No se pudo borrar el protocolo. Sigue igual; intentá de nuevo.', 500);
	}
	return true;
}

module.exports = {
	actualizarProtocolo,
	eliminarProtocolo,
	listarTiposProtocolo,
	obtenerProForma,
	buscarPracticas,
	detallePractica,
	buscarProfesionales,
	buscarMedicamentos,
	medicamentosPorDefecto,
	listarPorVisita,
	crearProtocolo,
	// hooks de test (sin SQL propio o ejecutables dentro de una transacción externa)
	_parseFechaHora,
	_resolverFechasProcedimiento,
	_normalizarPracticas,
	_normalizarMedicamentos,
	_insertarPractica,
	_reemplazarEquipo,
	_reemplazarMedicamentos,
};

