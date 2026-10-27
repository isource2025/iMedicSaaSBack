/**
 * Datos de una persona por DNI (RENAPER) para precargar altas de personal o
 * pacientes. Usa el mismo endpoint que el formulario de Personal.
 */
const httpInterno = require('./httpInterno');

const SEXO_PARAM = { F: 1, M: 2 };

async function consultar(ctx, documento, sexo) {
	return httpInterno.llamar({
		method: 'GET',
		path: `/api/renaper/buscar-persona/${documento}/${SEXO_PARAM[sexo]}`,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
}

function aCamposPersonal(p, documento) {
	const apellidoNombre = `${p.apellido || ''} ${p.nombres || ''}`.replace(/,/g, '').replace(/\s+/g, ' ').trim();
	return {
		NumeroDocumento: String(p.numeroDocumento || documento),
		TipoDocumento: 'DNI',
		ApellidoNombre: apellidoNombre,
		Domicilio: `${p.calle || ''} ${p.numero || ''}`.trim() || null,
		FechaNacimiento: p.fechaNacimiento || null,
		Sexo: p.sexo || null,
		ciudad: p.ciudad || null,
		provincia: p.provincia || null,
	};
}

async function buscarPersona(args, ctx) {
	const documento = String(args.documento || '').replace(/\D/g, '');
	if (documento.length < 6) return { error: 'Documento inválido' };
	const sexos = args.sexo && SEXO_PARAM[String(args.sexo).toUpperCase()] ? [String(args.sexo).toUpperCase()] : ['M', 'F'];
	const encontrados = [];
	for (const s of sexos) {
		const r = await consultar(ctx, documento, s);
		if (r.status < 400 && r.body?.persona) encontrados.push({ sexoConsultado: s, ...aCamposPersonal(r.body.persona, documento) });
		else if (r.status >= 500) return { error: r.body?.message || 'RENAPER no responde. Pedile los datos al usuario.' };
	}
	if (!encontrados.length) return { encontrado: false, aviso: 'RENAPER no devolvió datos. Pedí apellido y nombre al usuario.' };
	if (encontrados.length > 1) {
		return {
			encontrado: true,
			ambiguo: true,
			personas: encontrados,
			aviso: 'Hay datos con sexo M y F para ese DNI: preguntá cuál es.',
		};
	}
	return { encontrado: true, persona: encontrados[0] };
}

module.exports = { buscarPersona };
