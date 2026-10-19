/**
 * Tablas fuera de convenios que guardan el número de convenio
 * (imClientesConvenios.Codigo) con otro nombre de columna. No hay FKs
 * declaradas: este registro es la única fuente de "quién usa un convenio".
 *
 * Ninguna de estas columnas tiene índice; contar sobre todas tarda ~0,5 s,
 * por eso se consulta aparte del detalle del convenio.
 */
const { executeQuery } = require('../../models/db');
const { createTenantOnce } = require('../../context/tenantCache');

const REFERENCIAS_CONVENIO = [
	{ id: 'visitas', tabla: 'imVisita', columna: 'CONTRATO', etiqueta: 'Visitas' },
	{ id: 'facturas', tabla: 'imFacturas', columna: 'idConvenio', etiqueta: 'Facturas' },
	{ id: 'facturaDetalle', tabla: 'imFacDetalle', columna: 'IDCONVENIO', etiqueta: 'Renglones facturados' },
	{ id: 'rendiciones', tabla: 'imRendiciones', columna: 'idConvenio', etiqueta: 'Rendiciones' },
	{ id: 'facProfCabecera', tabla: 'FacturacionProfCabecera', columna: 'IdConvenio', etiqueta: 'Liquidaciones a profesionales' },
	{ id: 'facProfDetalle', tabla: 'FacturacionProfDetalle', columna: 'IdConvenio', etiqueta: 'Renglones liquidados a profesionales' },
	{ id: 'practicas', tabla: 'imFacPracticas', columna: 'IdConvenio', etiqueta: 'Prácticas facturadas' },
	{ id: 'cirugias', tabla: 'imCirugia', columna: 'CodigoConvenio', etiqueta: 'Cirugías' },
	{ id: 'personal', tabla: 'PersonalX', columna: 'IdConvenioFacturacion', etiqueta: 'Personal (convenio de facturación)' },
];

/** Algunas bases no tienen todas las tablas: se omiten las que no existen. */
const referenciasDisponibles = createTenantOnce(async () => {
	const filas = await executeQuery(
		`SELECT c.TABLE_NAME AS tabla, c.COLUMN_NAME AS columna
		 FROM INFORMATION_SCHEMA.COLUMNS c
		 JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
		 WHERE ${REFERENCIAS_CONVENIO.map((_, i) => `(c.TABLE_NAME = @p${i * 2} AND c.COLUMN_NAME = @p${i * 2 + 1})`).join(' OR ')}`,
		REFERENCIAS_CONVENIO.flatMap((r) => [{ value: r.tabla }, { value: r.columna }]),
	);
	const presentes = new Set(filas.map((f) => `${f.tabla}.${f.columna}`.toLowerCase()));
	return REFERENCIAS_CONVENIO.filter((r) => presentes.has(`${r.tabla}.${r.columna}`.toLowerCase()));
});

/** Cantidad de filas de cada tabla que usan el convenio. */
async function contarUsosConvenio(codigo) {
	const refs = await referenciasDisponibles();
	if (!refs.length) return [];
	const partes = refs.map(
		(r) => `SELECT '${r.id}' AS id, COUNT(*) AS n FROM dbo.[${r.tabla}] WITH (NOLOCK) WHERE [${r.columna}] = @p0`,
	);
	const filas = await executeQuery(partes.join('\nUNION ALL\n'), [{ value: Number(codigo), type: 'Int' }]);
	const porId = new Map(filas.map((f) => [f.id, Number(f.n) || 0]));
	return refs.map((r) => ({ id: r.id, etiqueta: r.etiqueta, tabla: r.tabla, columna: r.columna, cantidad: porId.get(r.id) || 0 }));
}

module.exports = { contarUsosConvenio };
