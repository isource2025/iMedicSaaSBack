const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');
const personalServicios = require('./personalServicios.service');

function _normSector(v) {
	return String(v || '').trim().toUpperCase();
}

/**
 * ValorPersonal del solicitante (para no auto-notificarlo).
 */
async function obtenerValorPersonalPorMatricula(matricula) {
	const mat = Number(matricula);
	if (!Number.isFinite(mat) || mat <= 0) return null;
	const rows = await executeQuery(
		`
    SELECT TOP 1 pw.ValorPersonal
    FROM dbo.imPersonal per
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = per.Valor
    WHERE per.Matricula = @p0
      AND ISNULL(CAST(pw.MarcadeBaja AS VARCHAR(10)), '0') IN ('0', '', 'false')
    `,
		[{ value: mat, type: 'Int' }],
	);
	const vp = rows?.[0]?.ValorPersonal;
	return vp != null && Number(vp) > 0 ? Number(vp) : null;
}

/**
 * Profesionales con el servicio receptor asignado (imPersonalServicios).
 */
async function obtenerDestinatariosSectorReceptor(idSectorReceptor, excluirValorPersonal) {
	const sector = String(idSectorReceptor || '').trim();
	if (!sector) return [];
	const excluir = Number(excluirValorPersonal) || 0;

	await personalServicios.ensureTable();
	const sectorPad = sector.slice(0, 4).padEnd(4, ' ');
	const rows = await executeQuery(
		`
    SELECT DISTINCT pw.ValorPersonal
    FROM dbo.imPersonalServicios ps
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
    WHERE (
        UPPER(LTRIM(RTRIM(ps.idServicio))) = UPPER(LTRIM(RTRIM(@p1)))
        OR LEFT(UPPER(LTRIM(RTRIM(ps.idServicio))) + '    ', 4) = LEFT(UPPER(LTRIM(RTRIM(@p1))) + '    ', 4)
        OR UPPER(LTRIM(RTRIM(ps.idServicio))) = UPPER(LTRIM(RTRIM(@p2)))
      )
      AND ISNULL(CAST(pw.MarcadeBaja AS VARCHAR(10)), '0') IN ('0', '', 'false')
      AND pw.ValorPersonal <> @p0
    `,
		[
			{ value: excluir, type: 'Int' },
			{ value: sector, type: 'VarChar', length: 50 },
			{ value: sectorPad, type: 'VarChar', length: 50 },
		],
	).catch(() => []);

	const seen = new Set();
	const out = [];
	for (const r of rows || []) {
		const vp = Number(r.ValorPersonal);
		if (!Number.isFinite(vp) || vp <= 0 || seen.has(vp)) continue;
		seen.add(vp);
		out.push(vp);
	}
	return out;
}

/**
 * Notifica en campanita a quienes tienen asignado el sector receptor del pedido.
 * No bloquea el alta del pedido si falla.
 */
async function notificarPedidoSectorReceptor({
	idPedido,
	idVisita,
	idTipoPedido,
	idSectorReceptor,
	descripcionPractica,
	estadoUrgencia,
	matriculaSolicitante,
}) {
	try {
		const id = Number(idPedido);
		if (!Number.isFinite(id) || id <= 0) return;

		const excluir = await obtenerValorPersonalPorMatricula(matriculaSolicitante);
		const destinatarios = await obtenerDestinatariosSectorReceptor(idSectorReceptor, excluir);
		if (!destinatarios.length) {
			console.log(
				`[notif pedidos] Sin destinatarios en sector "${_normSector(idSectorReceptor)}" (pedido ${id})`,
			);
			return;
		}

		const esInterconsulta = Number(idTipoPedido) === 33;
		const tipo = esInterconsulta ? 'INTERCONSULTA' : 'PEDIDO_ESTUDIO';
		const urg = String(estadoUrgencia || 'Normal').trim();
		const practica = String(descripcionPractica || (esInterconsulta ? 'Interconsulta' : 'Estudio')).trim();
		const sector = _normSector(idSectorReceptor);
		const prefijo = esInterconsulta ? 'Nueva interconsulta' : 'Nuevo pedido de estudio';
		const urgTxt = urg && urg !== 'Normal' ? ` [${urg}]` : '';
		const descripcion = `${prefijo}${urgTxt}: ${practica} → ${sector} (visita ${idVisita || '—'})`.substring(
			0,
			250,
		);

		const datos = {
			idPedido: id,
			idVisita: Number(idVisita) || 0,
			idTipoPedido: Number(idTipoPedido) || null,
			idSectorReceptor: sector,
			estadoUrgencia: urg,
			categoria: esInterconsulta ? 'INTERCONSULTA' : 'ESTUDIO',
		};

		for (const vp of destinatarios) {
			await notificacionesService.crear({
				valorPersonal: vp,
				tipo,
				descripcion,
				entidadTipo: esInterconsulta ? 'INTERCONSULTA' : 'PEDIDO_ESTUDIO',
				entidadId: id,
				datos,
			});
		}
		console.log(
			`[notif pedidos] ${destinatarios.length} aviso(s) pedido ${id} sector ${sector} (${tipo})`,
		);
	} catch (err) {
		console.warn('[notif pedidos] No se pudo notificar:', err.message || err);
	}
}

module.exports = {
	notificarPedidoSectorReceptor,
	obtenerDestinatariosSectorReceptor,
	obtenerValorPersonalPorMatricula,
};
