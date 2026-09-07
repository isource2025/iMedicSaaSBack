const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');
const { getTenantId } = require('../context/tenantContext');
const { sqlImPasswordSinMarcaBaja } = require('../utils/imPasswordActivo');

function _normSector(v) {
	return String(v || '').trim().toUpperCase();
}

function _addVp(seen, out, raw, excluir) {
	const vp = Number(raw);
	if (!Number.isFinite(vp) || vp <= 0 || vp === excluir || seen.has(vp)) return;
	seen.add(vp);
	out.push(vp);
}

async function obtenerValorPersonalPorMatricula(matricula) {
	const mat = Number(matricula);
	if (!Number.isFinite(mat) || mat <= 0) return null;
	const rows = await executeQuery(
		`
    SELECT TOP 1 pw.ValorPersonal
    FROM dbo.imPersonal per
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = per.Valor
    WHERE per.Matricula = @p0
      AND ${sqlImPasswordSinMarcaBaja('pw')}
    `,
		[{ value: mat, type: 'Int' }],
	);
	const vp = rows?.[0]?.ValorPersonal;
	return vp != null && Number(vp) > 0 ? Number(vp) : null;
}

async function _etiquetaServicio(codigo) {
	const id = String(codigo || '').trim();
	if (!id) return '';
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 RTRIM(LTRIM(ISNULL(Descripcion, ''))) AS descripcion
			 FROM dbo.imServicios
			 WHERE UPPER(LTRIM(RTRIM(CAST(Valor AS VARCHAR(50))))) = UPPER(LTRIM(RTRIM(@p0)))
			    OR LEFT(UPPER(LTRIM(RTRIM(CAST(Valor AS VARCHAR(50))))) + '    ', 4)
			       = LEFT(UPPER(LTRIM(RTRIM(@p0))) + '    ', 4)`,
			[{ value: id, type: 'VarChar' }],
		);
		const desc = String(rows?.[0]?.descripcion || '').trim();
		if (desc) return `${_normSector(id)} — ${desc}`;
	} catch {
		/* fallback sector */
	}
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 RTRIM(LTRIM(ISNULL(Descripcion, ''))) AS descripcion
			 FROM dbo.imSectores
			 WHERE UPPER(LTRIM(RTRIM(CAST(Valor AS VARCHAR(50))))) = UPPER(LTRIM(RTRIM(@p0)))`,
			[{ value: id, type: 'VarChar' }],
		);
		const desc = String(rows?.[0]?.descripcion || '').trim();
		return desc ? `${_normSector(id)} — ${desc}` : _normSector(id);
	} catch {
		return _normSector(id);
	}
}

async function _destinatariosSqlPorServicios(codigos, excluir) {
	const codes = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))];
	if (!codes.length) return [];
	const seen = new Set();
	const out = [];
	const params = [{ value: excluir, type: 'Int' }];
	const ors = [];
	codes.forEach((c, i) => {
		const a = i * 2 + 1;
		const b = a + 1;
		params.push({ value: c, type: 'VarChar', length: 50 });
		params.push({ value: `${c}    `.slice(0, 4), type: 'VarChar', length: 50 });
		ors.push(
			`(UPPER(LTRIM(RTRIM(ps.idServicio))) = UPPER(LTRIM(RTRIM(@p${a})))
			  OR LEFT(UPPER(LTRIM(RTRIM(ps.idServicio))) + '    ', 4) = LEFT(UPPER(LTRIM(RTRIM(@p${b}))) + '    ', 4)
			  OR UPPER(LTRIM(RTRIM(ps.idServicio))) = UPPER(LTRIM(RTRIM(@p${b}))))`,
		);
	});
	const rows = await executeQuery(
		`
    SELECT DISTINCT pw.ValorPersonal
    FROM dbo.imPersonalServicios ps
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
    WHERE (${ors.join(' OR ')})
      AND ${sqlImPasswordSinMarcaBaja('pw')}
      AND pw.ValorPersonal <> @p0
    `,
		params,
	).catch(() => []);
	for (const r of rows || []) _addVp(seen, out, r.ValorPersonal, excluir);
	return out;
}

async function _destinatariosSqlPorSectores(codigos, excluir) {
	const codes = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))];
	if (!codes.length) return [];
	const seen = new Set();
	const out = [];
	const params = [{ value: excluir, type: 'Int' }];
	const ors = [];
	codes.forEach((c, i) => {
		const a = i * 2 + 1;
		const b = a + 1;
		params.push({ value: c, type: 'VarChar', length: 50 });
		params.push({ value: `${c}    `.slice(0, 4), type: 'VarChar', length: 50 });
		ors.push(
			`(UPPER(LTRIM(RTRIM(ps.idSector))) = UPPER(LTRIM(RTRIM(@p${a})))
			  OR LEFT(UPPER(LTRIM(RTRIM(ps.idSector))) + '    ', 4) = LEFT(UPPER(LTRIM(RTRIM(@p${b}))) + '    ', 4)
			  OR UPPER(LTRIM(RTRIM(ps.idSector))) = UPPER(LTRIM(RTRIM(@p${b}))))`,
		);
	});
	const rows = await executeQuery(
		`
    SELECT DISTINCT pw.ValorPersonal
    FROM dbo.imPersonalSectores ps
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = ps.idPersonal
    WHERE (${ors.join(' OR ')})
      AND ${sqlImPasswordSinMarcaBaja('pw')}
      AND pw.ValorPersonal <> @p0
    `,
		params,
	).catch(() => []);
	for (const r of rows || []) _addVp(seen, out, r.ValorPersonal, excluir);
	return out;
}

async function _sectoresPorValorServicio(codigo) {
	const id = String(codigo || '').trim();
	if (!id) return [];
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor
		 FROM dbo.imSectores
		 WHERE UPPER(LTRIM(RTRIM(CAST(ValorServicio AS VARCHAR(50))))) = UPPER(LTRIM(RTRIM(@p0)))
		    OR LEFT(UPPER(LTRIM(RTRIM(CAST(ValorServicio AS VARCHAR(50))))) + '    ', 4)
		       = LEFT(UPPER(LTRIM(RTRIM(@p0))) + '    ', 4)`,
		[{ value: id, type: 'VarChar' }],
	).catch(() => []);
	return (rows || []).map((r) => String(r.valor || '').trim()).filter(Boolean);
}

/**
 * Destinatarios = personal con ese servicio en imPersonalServicios (SQL y nube).
 * Fallback: sectores ligados por ValorServicio / imPersonalSectores (legado).
 */
async function obtenerDestinatariosSectorReceptor(idSectorReceptor, excluirValorPersonal) {
	const servicio = String(idSectorReceptor || '').trim();
	if (!servicio) return [];
	const excluir = Number(excluirValorPersonal) || 0;
	const seen = new Set();
	const out = [];

	for (const vp of await _destinatariosSqlPorServicios([servicio], excluir)) {
		_addVp(seen, out, vp, excluir);
	}

	const sectores = await _sectoresPorValorServicio(servicio);
	if (!out.length || sectores.length) {
		for (const vp of await _destinatariosSqlPorSectores([servicio, ...sectores], excluir)) {
			_addVp(seen, out, vp, excluir);
		}
	}

	const idEmpresa = Number(getTenantId());
	if (Number.isFinite(idEmpresa) && idEmpresa > 0) {
		try {
			const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
			if (isAuthCentralEnabled()) {
				const pool = await getAuthCentralPool();
				const pushNubeServicios = async (codes) => {
					const list = [...new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean))];
					if (!list.length) return;
					for (const code of list) {
						const [srvNube] = await pool.query(
							`SELECT DISTINCT idPersonal
							 FROM \`imPersonalServicios\`
							 WHERE IdEmpresa = ?
							   AND (
							     UPPER(TRIM(idServicio)) = UPPER(?)
							     OR LEFT(CONCAT(UPPER(TRIM(idServicio)), '    '), 4) = LEFT(CONCAT(UPPER(?), '    '), 4)
							   )
							   AND idPersonal <> ?`,
							[idEmpresa, code, code, excluir],
						);
						for (const r of srvNube || []) _addVp(seen, out, r.idPersonal, excluir);
					}
				};
				const pushNubeSectores = async (codes) => {
					const list = [...new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean))];
					if (!list.length) return;
					for (const code of list) {
						const [secNube] = await pool.query(
							`SELECT DISTINCT idPersonal
							 FROM \`imPersonalSectores\`
							 WHERE IdEmpresa = ?
							   AND (
							     UPPER(TRIM(idSector)) = UPPER(?)
							     OR LEFT(CONCAT(UPPER(TRIM(idSector)), '    '), 4) = LEFT(CONCAT(UPPER(?), '    '), 4)
							   )
							   AND idPersonal <> ?`,
							[idEmpresa, code, code, excluir],
						);
						for (const r of secNube || []) _addVp(seen, out, r.idPersonal, excluir);
					}
				};

				await pushNubeServicios([servicio]);
				await pushNubeSectores([servicio, ...sectores]);
			}
		} catch (e) {
			console.warn('[notif pedidos] destinatarios nube:', e.message);
		}
	}

	return out;
}

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
				`[notif pedidos] Sin destinatarios en servicio "${_normSector(idSectorReceptor)}" (pedido ${id})`,
			);
			return;
		}

		const esInterconsulta = Number(idTipoPedido) === 33;
		const tipo = esInterconsulta ? 'INTERCONSULTA' : 'PEDIDO_ESTUDIO';
		const urg = String(estadoUrgencia || 'Normal').trim();
		const practica = String(descripcionPractica || (esInterconsulta ? 'Interconsulta' : 'Estudio')).trim();
		const servicioLabel = await _etiquetaServicio(idSectorReceptor);
		const prefijo = esInterconsulta ? 'Nueva interconsulta' : 'Nuevo pedido de estudio';
		const urgTxt = urg && urg !== 'Normal' ? ` [${urg}]` : '';
		const descripcion = `${prefijo}${urgTxt}: ${practica} → ${servicioLabel} (visita ${idVisita || '—'})`.substring(
			0,
			250,
		);

		const datos = {
			idPedido: id,
			idVisita: Number(idVisita) || 0,
			idTipoPedido: Number(idTipoPedido) || null,
			idSectorReceptor: _normSector(idSectorReceptor),
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
			`[notif pedidos] ${destinatarios.length} aviso(s) pedido ${id} servicio ${_normSector(idSectorReceptor)} (${tipo})`,
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
