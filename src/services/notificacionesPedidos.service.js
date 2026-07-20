const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');

function _normSector(v) {
	return String(v || '')
		.trim()
		.toUpperCase()
		.slice(0, 4);
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
 * Profesionales con el sector receptor asignado (imPersonalSectores).
 * IdSectorReceptor suele coincidir con imSectores.Valor / imServicios.Valor (char 3-4).
 */
async function obtenerDestinatariosSectorReceptor(idSectorReceptor, excluirValorPersonal) {
	const sector = _normSector(idSectorReceptor);
	if (!sector) return [];

	const excluir = Number(excluirValorPersonal) || 0;
	const rows = await executeQuery(
		`
    SELECT DISTINCT pw.ValorPersonal
    FROM dbo.imPersonalSectores ps
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
    WHERE UPPER(LTRIM(RTRIM(ps.idSector))) = @p0
      AND ISNULL(CAST(pw.MarcadeBaja AS VARCHAR(10)), '0') IN ('0', '', 'false')
      AND pw.ValorPersonal <> @p1
    `,
		[
			{ value: sector, type: 'VarChar' },
			{ value: excluir, type: 'Int' },
		],
	);
	return (rows || [])
		.map((r) => Number(r.ValorPersonal))
		.filter((n) => Number.isFinite(n) && n > 0);
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
