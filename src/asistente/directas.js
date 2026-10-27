/**
 * Cuándo el resultado de una tool ya es la respuesta y no hace falta que el modelo la redacte
 * (ver respuestaDirecta en loop.js). Solo con pedidos simples: si el mensaje trae otra pregunta,
 * el modelo sigue y responde todo junto.
 */
const ficha = require('./ficha');

/** Medicación no se indica desde el chat: el modelo tiene que explicarlo, no alcanza la tarjeta. */
const MENCIONA_MEDICACION = /\b(medicaci|medicament|\d+\s*mg\b|ampolla|comprimid|antibi[oó]t|analg[eé]s|paracetamol|ibuprofeno|dipirona|insulina)/i;

function fichaParaUsuario(i) {
	const f = ficha.deInternacion(i);
	return ficha.textoDe({ ...f, tipo: undefined });
}

/**
 * @param {string} nombre tool
 * @param {object} r resultado de ejecutar
 * @param {{ intencion?: object, mensaje?: string }} ctx
 */
function aplicar(nombre, r, ctx) {
	if (!r || typeof r !== 'object' || typeof r.respuestaDirecta === 'string') return r;
	if (r.error || r.pedir || r.opciones) return r;
	const it = ctx?.intencion || {};

	if (r.requiereConfirmacion && it.cargaSimple && !MENCIONA_MEDICACION.test(ctx.mensaje || '')) {
		return { ...r, respuestaDirecta: `Te dejé lista la tarjeta: **${r.resumen}**. Revisala y tocá «Confirmar».` };
	}

	if (nombre === 'buscar_internado' && it.soloUbicar) {
		const activos = r.internaciones || [];
		if (activos.length === 1) {
			const cuerpo = fichaParaUsuario(activos[0]);
			return { ...r, respuestaDirecta: r.aproximado ? `${r.aviso}\n\n${cuerpo}` : cuerpo };
		}
	}

	if (nombre === 'navegar' && it.soloNavegar && r.ok) {
		return { ...r, respuestaDirecta: `Listo: tocá el botón de abajo para abrir ${r.motivo ? `**${r.motivo}**` : 'la pantalla'}.` };
	}
	return r;
}

module.exports = { aplicar, MENCIONA_MEDICACION };
