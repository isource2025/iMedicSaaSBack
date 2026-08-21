const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');
const personalServicios = require('./personalServicios.service');
const { getTenantId } = require('../context/tenantContext');
const { sectorUsuarioCoincideServicio } = require('../utils/sectorServicioMatch');

function _normSector(v) {
	return String(v || '').trim().toUpperCase();
}

function _addVp(seen, out, raw, excluir) {
	const vp = Number(raw);
	if (!Number.isFinite(vp) || vp <= 0 || vp === excluir || seen.has(vp)) return;
	seen.add(vp);
	out.push(vp);
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
 * Profesionales del servicio/sector receptor: imPersonalServicios, imPersonalSectores
 * (SQL físico) y el espejo de Railway si la clínica gestiona usuarios en la nube.
 */
async function obtenerDestinatariosSectorReceptor(idSectorReceptor, excluirValorPersonal) {
	const sector = String(idSectorReceptor || '').trim();
	if (!sector) return [];
	const excluir = Number(excluirValorPersonal) || 0;
	const seen = new Set();
	const out = [];
	const sectorPad = sector.slice(0, 4).padEnd(4, ' ');

	await personalServicios.ensureTable();
	const byServicio = await executeQuery(
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
	for (const r of byServicio || []) _addVp(seen, out, r.ValorPersonal, excluir);

	const bySector = await executeQuery(
		`
    SELECT DISTINCT pw.ValorPersonal
    FROM dbo.imPersonalSectores ps
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
    WHERE (
        UPPER(LTRIM(RTRIM(ps.idSector))) = UPPER(LTRIM(RTRIM(@p1)))
        OR LEFT(UPPER(LTRIM(RTRIM(ps.idSector))) + '    ', 4) = LEFT(UPPER(LTRIM(RTRIM(@p1))) + '    ', 4)
        OR UPPER(LTRIM(RTRIM(ps.idSector))) = UPPER(LTRIM(RTRIM(@p2)))
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
	for (const r of bySector || []) _addVp(seen, out, r.ValorPersonal, excluir);

	if (!out.length) {
		const srvRows = await executeQuery(
			`SELECT TOP 1 RTRIM(LTRIM(Valor)) AS valor, RTRIM(LTRIM(ISNULL(Descripcion, ''))) AS descripcion
			 FROM dbo.imServicios
			 WHERE UPPER(LTRIM(RTRIM(Valor))) = UPPER(LTRIM(RTRIM(@p0)))
			    OR LEFT(UPPER(LTRIM(RTRIM(Valor))) + '    ', 4) = LEFT(UPPER(LTRIM(RTRIM(@p0))) + '    ', 4)`,
			[{ value: sector, type: 'VarChar', length: 50 }],
		).catch(() => []);
		const srv = {
			valor: String(srvRows?.[0]?.valor || sector).trim(),
			descripcion: String(srvRows?.[0]?.descripcion || '').trim(),
		};
		const userSecs = await executeQuery(
			`
      SELECT DISTINCT pw.ValorPersonal, RTRIM(LTRIM(ps.idSector)) AS idSector,
             RTRIM(LTRIM(ISNULL(s.Descripcion, ''))) AS descripcion
      FROM dbo.imPersonalSectores ps
      INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
      LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ps.idSector))
      WHERE ISNULL(CAST(pw.MarcadeBaja AS VARCHAR(10)), '0') IN ('0', '', 'false')
        AND pw.ValorPersonal <> @p0
      `,
			[{ value: excluir, type: 'Int' }],
		).catch(() => []);
		for (const r of userSecs || []) {
			if (
				sectorUsuarioCoincideServicio(
					{ idSector: r.idSector, descripcion: r.descripcion },
					srv,
				)
			) {
				_addVp(seen, out, r.ValorPersonal, excluir);
			}
		}
	}

	const idEmpresa = Number(getTenantId());
	if (Number.isFinite(idEmpresa) && idEmpresa > 0) {
		try {
			const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
			if (isAuthCentralEnabled()) {
				const pool = await getAuthCentralPool();
				const [srvNube] = await pool.query(
					`SELECT DISTINCT idPersonal
					 FROM \`imPersonalServicios\`
					 WHERE IdEmpresa = ?
					   AND (
					     UPPER(TRIM(idServicio)) = UPPER(?)
					     OR LEFT(CONCAT(UPPER(TRIM(idServicio)), '    '), 4) = LEFT(CONCAT(UPPER(?), '    '), 4)
					   )
					   AND idPersonal <> ?`,
					[idEmpresa, sector, sector, excluir],
				);
				for (const r of srvNube || []) _addVp(seen, out, r.idPersonal, excluir);
				const [secNube] = await pool.query(
					`SELECT DISTINCT idPersonal
					 FROM \`imPersonalSectores\`
					 WHERE IdEmpresa = ?
					   AND (
					     UPPER(TRIM(idSector)) = UPPER(?)
					     OR LEFT(CONCAT(UPPER(TRIM(idSector)), '    '), 4) = LEFT(CONCAT(UPPER(?), '    '), 4)
					   )
					   AND idPersonal <> ?`,
					[idEmpresa, sector, sector, excluir],
				);
				for (const r of secNube || []) _addVp(seen, out, r.idPersonal, excluir);
			}
		} catch (e) {
			console.warn('[notif pedidos] destinatarios nube:', e.message);
		}
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
