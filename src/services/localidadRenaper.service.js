const axios = require('axios');
const { executeQuery } = require('../models/db');
const localidadService = require('./localidad.service');

const GEOREF_URL = 'https://apis.datos.gob.ar/georef/api/localidades';

/** RENAPER pierde acentos/Ñ en origen y los manda como "¿", U+FFFD o "?". */
const ROTO = /ï¿½|\uFFFD|¿|\?/g;

/** Mayúsculas sin acentos (convención de imLocalidades/imProvincia), preservando la Ñ. */
function aCatalogo(texto) {
	return String(texto || '')
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase()
		.replace(/Ñ/g, '\u0000')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\u0000/g, 'Ñ');
}

const ALIAS_PROVINCIA = {
	'CIUDAD DE BUENOS AIRES': ['CAPITAL FEDERAL', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'CABA'],
	'CIUDAD AUTONOMA DE BUENOS AIRES': ['CAPITAL FEDERAL', 'CIUDAD DE BUENOS AIRES', 'CABA'],
	'CAPITAL FEDERAL': ['CIUDAD AUTONOMA DE BUENOS AIRES', 'CIUDAD DE BUENOS AIRES', 'CABA'],
	'TIERRA DEL FUEGO, ANTARTIDA E ISLAS DEL ATLANTICO SUR': ['TIERRA DEL FUEGO'],
	'TIERRA DEL FUEGO ANTARTIDA E ISLAS DEL ATLANTICO SUR': ['TIERRA DEL FUEGO'],
};

/** Código de provincia de Georef para desambiguar nombres repetidos entre provincias. */
const GEOREF_PROVINCIA = {
	'CIUDAD DE BUENOS AIRES': '02',
	'CIUDAD AUTONOMA DE BUENOS AIRES': '02',
	'CAPITAL FEDERAL': '02',
};

/** Nombre de catálogo y letra ISO 3166-2:AR para dar de alta provincias faltantes. */
const PROVINCIAS_AR = {
	'CAPITAL FEDERAL': 'C',
	'BUENOS AIRES': 'B',
	CATAMARCA: 'K',
	CHACO: 'H',
	CHUBUT: 'U',
	CORDOBA: 'X',
	CORRIENTES: 'W',
	'ENTRE RIOS': 'E',
	FORMOSA: 'P',
	JUJUY: 'Y',
	'LA PAMPA': 'L',
	'LA RIOJA': 'F',
	MENDOZA: 'M',
	MISIONES: 'N',
	NEUQUEN: 'Q',
	'RIO NEGRO': 'R',
	SALTA: 'A',
	'SAN JUAN': 'J',
	'SAN LUIS': 'D',
	'SANTA CRUZ': 'Z',
	'SANTA FE': 'S',
	'SANTIAGO DEL ESTERO': 'G',
	'TIERRA DEL FUEGO': 'V',
	TUCUMAN: 'T',
};

function nombreCanonicoProvincia(nombre) {
	if (PROVINCIAS_AR[nombre]) return nombre;
	return (ALIAS_PROVINCIA[nombre] || []).find((a) => PROVINCIAS_AR[a]) || null;
}

async function crearProvincia(canonico, rows) {
	const usadas = new Set((rows || []).map((r) => String(r.LetraProvincia || '').trim()));
	const iso = PROVINCIAS_AR[canonico];
	const letra = !usadas.has(iso)
		? iso
		: [canonico.slice(0, 2), canonico.slice(0, 3), `${iso}1`].find((l) => !usadas.has(l));
	if (!letra) return null;
	const params = [
		{ value: letra, type: 'VarChar', length: 3 },
		{ value: canonico.slice(0, 30), type: 'VarChar', length: 30 },
	];
	// Valor es IDENTITY en algunas bases de clínica y manual en otras
	const ident = await executeQuery(
		`SELECT COLUMNPROPERTY(OBJECT_ID('imProvincia'), 'Valor', 'IsIdentity') AS esIdentity`,
	);
	if (Number(ident?.[0]?.esIdentity) === 1) {
		await executeQuery(
			`INSERT INTO imProvincia (LetraProvincia, Descripcion, ValorNacionalidad) VALUES (@p0, @p1, 'AR')`,
			params,
		);
	} else {
		const next = await executeQuery('SELECT ISNULL(MAX(Valor), 0) + 1 AS NextValor FROM imProvincia');
		await executeQuery(
			`INSERT INTO imProvincia (LetraProvincia, Descripcion, ValorNacionalidad, Valor) VALUES (@p0, @p1, 'AR', @p2)`,
			[...params, { value: Number(next[0]?.NextValor) || 1, type: 'Int' }],
		);
	}
	return { letra, descripcion: canonico, creada: true };
}

async function resolverProvincia(provinciaRenaper) {
	const nombre = aCatalogo(provinciaRenaper);
	if (!nombre) return null;
	const candidatos = [nombre, ...(ALIAS_PROVINCIA[nombre] || [])];
	const rows = await executeQuery(
		`SELECT Valor, Descripcion, LetraProvincia FROM imProvincia WHERE ValorNacionalidad = 'AR'`,
	);
	for (const cand of candidatos) {
		const hit = (rows || []).find((r) => aCatalogo(r.Descripcion) === cand);
		if (hit) return { letra: String(hit.LetraProvincia || '').trim(), descripcion: hit.Descripcion };
	}
	const canonico = nombreCanonicoProvincia(nombre);
	return canonico ? crearProvincia(canonico, rows) : null;
}

async function buscarEnCatalogo(nombre, letraProvincia, esPatron) {
	const rows = await executeQuery(
		`
    SELECT TOP 5 Valor, NombreLocalidad, ValorProvincia
    FROM imLocalidades
    WHERE LTRIM(RTRIM(NombreLocalidad)) COLLATE Latin1_General_CI_AI ${esPatron ? 'LIKE' : '='} @p0 COLLATE Latin1_General_CI_AI
    ORDER BY Valor
  `,
		[{ value: nombre }],
	);
	if (!rows?.length) return null;
	const mismaProvincia = letraProvincia
		? rows.find((r) => String(r.ValorProvincia || '').trim() === letraProvincia)
		: null;
	// Sin provincia conocida solo sirve una coincidencia única: los nombres se repiten entre provincias
	if (mismaProvincia) return mismaProvincia;
	if (!letraProvincia && rows.length === 1) return rows[0];
	return null;
}

/**
 * Recupera la letra perdida consultando Georef (datos.gob.ar) con el prefijo sano del nombre.
 * @returns {Promise<string|null>} nombre en formato catálogo
 */
async function repararConGeoref(nombreRoto, provinciaRenaper) {
	const prefijo = nombreRoto.split(ROTO)[0].trim();
	if (prefijo.length < 3) return null;
	const patron = new RegExp(
		`^${nombreRoto
			.split(ROTO)
			.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('.')}$`,
	);
	const params = { nombre: prefijo, max: 100, campos: 'nombre,provincia.nombre' };
	const codProv = GEOREF_PROVINCIA[aCatalogo(provinciaRenaper)];
	if (codProv) params.provincia = codProv;
	else if (provinciaRenaper) params.provincia = aCatalogo(provinciaRenaper);

	try {
		const { data } = await axios.get(GEOREF_URL, { params, timeout: 5000 });
		const nombres = [...new Set((data?.localidades || []).map((l) => aCatalogo(l.nombre)))];
		const hits = nombres.filter((n) => patron.test(n));
		return hits.length === 1 ? hits[0] : null;
	} catch (e) {
		console.warn('[localidadRenaper] Georef no disponible:', e.message);
		return null;
	}
}

async function crearLocalidad(nombre, letraProvincia, codigoPostal) {
	for (let intento = 0; intento < 2; intento++) {
		try {
			await localidadService.createLocalidad({
				NombreLocalidad: nombre.slice(0, 85),
				ValorProvincia: letraProvincia,
				CodigoPostal: codigoPostal,
			});
			break;
		} catch (e) {
			// Carrera sobre MAX(Valor)+1: reintentar una vez
			if (intento === 1 || !/PRIMARY KEY|duplicate/i.test(e.message)) throw e;
		}
	}
	return buscarEnCatalogo(nombre, letraProvincia, false);
}

/**
 * Busca la localidad que informa RENAPER en imLocalidades y, si no existe, la da de alta.
 * @param {{ ciudad: string, provincia?: string, cpostal?: string|number }} input
 */
async function resolverLocalidadRenaper({ ciudad, provincia, cpostal }) {
	const nombreCrudo = aCatalogo(ciudad);
	if (!nombreCrudo) {
		const e = new Error('Ciudad requerida');
		e.statusCode = 400;
		throw e;
	}

	const prov = await resolverProvincia(provincia);
	const letra = prov?.letra || null;
	const roto = new RegExp(ROTO.source).test(nombreCrudo);

	let nombre = nombreCrudo;
	if (roto) {
		const patronSql = nombreCrudo.replace(/[[%_]/g, '[$&]').replace(ROTO, '_');
		const existente = await buscarEnCatalogo(patronSql, letra, true);
		if (existente) return { ...existente, creada: false };

		nombre = await repararConGeoref(nombreCrudo, provincia);
		if (!nombre) {
			const e = new Error(
				`RENAPER informó "${nombreCrudo}" con caracteres ilegibles y no se pudo determinar el nombre correcto`,
			);
			e.statusCode = 422;
			throw e;
		}
	}

	const existente = await buscarEnCatalogo(nombre, letra, false);
	if (existente) return { ...existente, creada: false };

	if (!letra) {
		const e = new Error(`La provincia "${aCatalogo(provincia)}" no está en el catálogo de provincias`);
		e.statusCode = 422;
		throw e;
	}

	const cp = Number(String(cpostal || '').replace(/\D/g, '')) || 0;
	const creada = await crearLocalidad(nombre, letra, cp);
	if (!creada) throw new Error('No se pudo recuperar la localidad recién creada');
	return { ...creada, creada: true };
}

module.exports = { resolverLocalidadRenaper, aCatalogo };
