/**
 * Ficha de contexto: un registro real de iMedic, completo, para no reconsultar
 * campo por campo. Sirve para cualquier módulo (visita, paciente, personal, cama…).
 */

const CLAVES_OCULTAS = new Set([
	'password',
	'contrasena',
	'secreto',
	'token',
	'link',
	'http',
	'raw',
]);

function vacio(v) {
	return v == null || v === '' || v === false;
}

function tituloDe(ficha) {
	return (
		ficha.paciente ||
		ficha.nombre ||
		ficha.ApellidoYNombre ||
		ficha.ApellidoNombre ||
		ficha.descripcion ||
		ficha.numero ||
		(ficha.tipo && ficha.id != null ? `${ficha.tipo} ${ficha.id}` : null) ||
		'Registro'
	);
}

function lineaSector(ficha) {
	const codigo = ficha.sector || ficha.ValorSector || null;
	const desc = ficha.sectorDescripcion || ficha.DescripcionSector || null;
	if (desc && codigo && desc !== codigo) return `${desc} (${codigo})`;
	return desc || codigo || null;
}

/** Texto ordenado para el chat: todos los datos útiles, no un campo suelto. */
function textoDe(ficha) {
	if (!ficha || typeof ficha !== 'object') return null;
	const titulo = tituloDe(ficha);
	const lineas = [`**${titulo}**`];
	const filas = [
		['Tipo', ficha.tipo],
		['DNI / documento', ficha.documento || ficha.NumeroDocumento],
		['HC', ficha.hc || ficha.NumeroHC],
		['Visita', ficha.numeroVisita || ficha.NumeroVisita],
		['Sector', lineaSector(ficha)],
		['Cama', ficha.cama || ficha.numeroCama || ficha.ValorHabitacionCama],
		['Ingreso', ficha.ingreso || ficha.fechaIngreso],
		['Diagnóstico', ficha.diagnostico || ficha.DiagnosticoDescripcion],
		['Cobertura', ficha.cobertura || ficha.RazonSocialCliente],
		['Matrícula', ficha.matricula || ficha.Matricula],
		['Estado', ficha.estado || ficha.Estado],
		['Egreso', ficha.egresada ? 'Ya egresado' : null],
	];
	for (const [et, val] of filas) {
		if (!vacio(val)) lineas.push(`- ${et}: ${val}`);
	}
	return lineas.length > 1 ? lineas.join('\n') : titulo;
}

function textoLista(fichas, termino) {
	const lista = (fichas || []).filter(Boolean);
	if (!lista.length) {
		return termino
			? `No encontré un registro en iMedic para «${termino}».`
			: 'No encontré un registro en iMedic.';
	}
	if (lista.length === 1) return textoDe(lista[0]);
	return [
		`Hay ${lista.length} coincidencias con «${termino}». ¿Cuál es?`,
		'',
		...lista.map((f, i) => `${i + 1}. ${textoDe(f).replace(/\n/g, ' · ')}`),
	].join('\n');
}

function deInternacion(i) {
	if (!i) return null;
	return {
		tipo: i.egresada ? 'visita_egresada' : 'internacion',
		paciente: i.paciente || null,
		documento: i.documento || null,
		hc: i.hc || null,
		idPaciente: i.idPaciente || i.IdPaciente || null,
		numeroVisita: i.numeroVisita || null,
		sector: i.sector || null,
		sectorDescripcion: i.sectorDescripcion || null,
		cama: i.cama || null,
		ingreso: i.ingreso || null,
		diagnostico: i.diagnostico || null,
		egresada: Boolean(i.egresada),
	};
}

function deApi(item, tipo) {
	if (!item || typeof item !== 'object') return null;
	const f = { tipo: tipo || 'registro', raw: undefined };
	const map = [
		['paciente', ['ApellidoYNombre', 'ApellidoNombre', 'NombrePaciente', 'paciente', 'nombre']],
		['documento', ['NumeroDocumento', 'documentoPaciente', 'Documento', 'documento', 'DNI']],
		['hc', ['NumeroHC', 'hc']],
		['idPaciente', ['IdPaciente', 'idPaciente']],
		['numeroVisita', ['NumeroVisita', 'numeroVisita', 'IdVisita']],
		['sector', ['ValorSector', 'sector', 'IdSector']],
		['sectorDescripcion', ['sectorDescripcion', 'DescripcionSector']],
		['cama', ['ValorHabitacionCama', 'numeroCama', 'cama', 'Numero']],
		['idCama', ['IdCama', 'idCama', 'bedId']],
		['ingreso', ['fechaIngresoSQL', 'FechaAdmision', 'ingreso']],
		['diagnostico', ['DiagnosticoDescripcion', 'diagnostico']],
		['matricula', ['Matricula', 'matricula']],
		['nombre', ['ApellidoNombre', 'ApellidoYNombre', 'nombre']],
		['estado', ['Estado', 'estado']],
	];
	for (const [dest, keys] of map) {
		for (const k of keys) {
			if (!vacio(item[k])) {
				f[dest] = item[k];
				break;
			}
		}
	}
	if (f.numeroVisita) f.numeroVisita = Number(f.numeroVisita) || f.numeroVisita;
	return f;
}

function idsDe(ficha) {
	if (!ficha) return {};
	const out = {};
	if (ficha.numeroVisita) {
		out.numeroVisita = ficha.numeroVisita;
		out.NumeroVisita = ficha.numeroVisita;
		out.IdVisita = ficha.numeroVisita;
		out.idVisita = ficha.numeroVisita;
	}
	if (ficha.idPaciente) {
		out.idPaciente = ficha.idPaciente;
		out.IdPaciente = ficha.idPaciente;
	}
	if (ficha.documento) {
		out.NumeroDocumento = ficha.documento;
		out.documento = ficha.documento;
	}
	if (ficha.sector) {
		out.ValorSector = ficha.sector;
		out.IdSector = ficha.sector;
		out.sector = ficha.sector;
	}
	if (ficha.cama) {
		out.ValorHabitacionCama = ficha.cama;
		out.bedId = ficha.cama;
		out.cama = ficha.cama;
	}
	if (ficha.idCama) {
		out.idCama = ficha.idCama;
		out.IdCama = ficha.idCama;
		out.bedId = ficha.idCama;
	}
	if (ficha.paciente || ficha.nombre) {
		out.ApellidoYNombre = ficha.paciente || ficha.nombre;
		out.ApellidoNombre = ficha.paciente || ficha.nombre;
	}
	if (ficha.diagnostico) {
		out.diagnostico = ficha.diagnostico;
		out.Diagnostico = ficha.diagnostico;
		out.diagnosticoEgreso = ficha.diagnostico;
	}
	return out;
}

function recortarFicha(ficha) {
	if (!ficha) return null;
	const out = {};
	for (const [k, v] of Object.entries(ficha)) {
		if (CLAVES_OCULTAS.has(k) || vacio(v) || typeof v === 'object') continue;
		out[k] = v;
	}
	return out;
}

module.exports = {
	textoDe,
	textoLista,
	deInternacion,
	deApi,
	idsDe,
	recortarFicha,
	tituloDe,
	lineaSector,
};
