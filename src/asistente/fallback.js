/**
 * Respuesta sin modelo (API key ausente o error). Usa el manual local.
 */
const manual = require('./manual');

function responderSinModelo({ texto, permisos, rutaActual }) {
	const q = String(texto || '').trim();
	const hits = manual.buscar(q, 3, { ruta: rutaActual, permisos });
	const pantallas = manual.pantallasDesdePermisos(permisos);
	const relacionadas = q
		? pantallas.filter((p) => {
				const blob = `${p.pantalla} ${p.modulo} ${p.path}`.toLowerCase();
				return q
					.toLowerCase()
					.split(/\s+/)
					.filter((w) => w.length > 3)
					.some((w) => blob.includes(w));
			})
		: [];

	const lineas = [];
	lineas.push('El asistente está en modo local (sin modelo de IA configurado).');
	if (rutaActual) lineas.push(`Estás en ${rutaActual}.`);
	if (hits.length) {
		lineas.push('');
		lineas.push('Según el manual:');
		for (const h of hits) {
			lineas.push(`• ${h.titulo} (${h.path}): ${h.texto}`);
		}
	} else {
		lineas.push('No encontré un artículo exacto. Pedime “listá pantallas” o el nombre de un módulo.');
	}
	if (relacionadas.length) {
		lineas.push('');
		lineas.push('Pantallas relacionadas:');
		for (const p of relacionadas.slice(0, 5)) {
			lineas.push(`• ${p.modulo} → ${p.pantalla}: ${p.path}`);
		}
	}

	return {
		texto: lineas.join('\n'),
		navegaciones: hits[0] ? [{ path: hits[0].path, href: hits[0].path, motivo: hits[0].titulo }] : [],
		modo: 'local',
	};
}

module.exports = { responderSinModelo };
