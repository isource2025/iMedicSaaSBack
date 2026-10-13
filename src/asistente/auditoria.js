const auditoria = require('../services/auditoria.service');
const costos = require('./costos');

const HEADER_ORIGEN = 'x-imedic-asistente';

async function registrarUso({
	idEmpresa,
	actor,
	accion,
	idConversacion,
	herramienta,
	detalle,
	ip,
}) {
	if (idEmpresa == null) return false;
	return auditoria.registrarSeguro({
		idEmpresa,
		modulo: 'ASISTENTE',
		entidad: herramienta ? 'HERRAMIENTA' : 'MENSAJE',
		idEntidad: idConversacion || null,
		accion: accion || 'USAR',
		actor,
		ip: ip || null,
		detalle: {
			herramienta: herramienta || null,
			...(detalle && typeof detalle === 'object' ? detalle : {}),
		},
	});
}

/** ¿El request lo hizo el asistente por la API interna? */
function origenDe(req) {
	return req?.headers?.[HEADER_ORIGEN] === '1' ? 'asistente' : 'pantalla';
}

/**
 * Consumo de OpenAI de funciones IA fuera del chat (ej. epicrisis). Si lo disparó el
 * asistente, ese costo ya va dentro del MENSAJE y el reporte no lo suma dos veces.
 */
async function registrarConsumoIa({ req, accion, idEntidad, modelo, usage, extra }) {
	if (!usage || req?.idEmpresa == null) return false;
	const c = costos.costoDe(usage, modelo);
	return auditoria.registrarSeguro({
		idEmpresa: req.idEmpresa,
		modulo: 'ASISTENTE',
		entidad: 'CONSUMO_IA',
		idEntidad: idEntidad == null ? null : String(idEntidad),
		accion,
		actor: req.valorPersonal,
		ip: String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null,
		detalle: {
			origen: origenDe(req),
			consumo: {
				modelo: c.precio.modelo,
				llamadas: 1,
				tokens: { entrada: c.entrada, cacheadas: c.cacheadas, salida: c.salida, total: c.total },
				costoUsd: costos.redondear(c.usd),
			},
			...(extra && typeof extra === 'object' ? extra : {}),
		},
	});
}

module.exports = { registrarUso, registrarConsumoIa, origenDe, HEADER_ORIGEN };
