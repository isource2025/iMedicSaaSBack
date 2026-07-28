/**
 * Catálogo único de campos exportables / sincronizables FÍSICO → NUBE (imPersonal).
 * `column` = columna en imPersonal (null = dato de tabla relacionada).
 */
const PERSONAL_EXPORT_FIELDS = Object.freeze([
	{ id: 'valor', label: 'ID', column: 'Valor' },
	{ id: 'apellidoNombre', label: 'Apellido y nombre', column: 'ApellidoNombre' },
	{ id: 'tipoDocumento', label: 'Tipo documento', column: 'TipoDocumento' },
	{ id: 'dni', label: 'DNI', column: 'Numero' },
	{ id: 'matricula', label: 'Matrícula', column: 'Matricula' },
	{ id: 'matriculaNacional', label: 'Matrícula nacional', column: 'MatriculaNacional' },
	{ id: 'especialidad', label: 'Especialidad', column: 'ValorEspecialidad' },
	{ id: 'servicio', label: 'Servicio', column: 'ValorServicio' },
	{ id: 'servicioFacturar', label: 'Servicio facturación', column: 'ValorServicioParaFacturar' },
	{ id: 'sectores', label: 'Sectores', column: null },
	{ id: 'telefono', label: 'Teléfono', column: 'Telefono' },
	{ id: 'cuit', label: 'CUIT', column: 'CUIT' },
	{ id: 'categoria', label: 'Categoría', column: 'ValorCategoria' },
	{ id: 'domicilio', label: 'Domicilio', column: 'Domicilio' },
	{ id: 'estado', label: 'Estado', column: 'Estado' },
	{ id: 'rol', label: 'Rol', column: 'Rol' },
]);

/** Columnas escalares de imPersonal a copiar a MySQL (sin sectores). */
const PERSONAL_SYNC_COLUMNS = Object.freeze(
	PERSONAL_EXPORT_FIELDS.map((f) => f.column).filter(Boolean),
);

/** Definiciones ALTER para ensure en MySQL Railway. */
const MYSQL_IMPERSONAL_EXTRA_COLS = Object.freeze([
	{ name: 'ApellidoNombre', ddl: 'VARCHAR(120) NULL' },
	{ name: 'TipoDocumento', ddl: 'VARCHAR(20) NULL' },
	{ name: 'MatriculaNacional', ddl: 'INT NULL' },
	{ name: 'ValorEspecialidad', ddl: 'INT NULL' },
	{ name: 'ValorServicio', ddl: 'VARCHAR(30) NULL' },
	{ name: 'ValorServicioParaFacturar', ddl: 'VARCHAR(30) NULL' },
	{ name: 'ValorCategoria', ddl: 'INT NULL' },
	{ name: 'Telefono', ddl: 'VARCHAR(40) NULL' },
	{ name: 'CUIT', ddl: 'VARCHAR(20) NULL' },
	{ name: 'Domicilio', ddl: 'VARCHAR(200) NULL' },
	{ name: 'Estado', ddl: 'INT NULL' },
]);

function listExportFields() {
	return PERSONAL_EXPORT_FIELDS.map(({ id, label }) => ({ id, label }));
}

function resolveExportFieldIds(campos) {
	const allowed = new Set(PERSONAL_EXPORT_FIELDS.map((f) => f.id));
	const raw = Array.isArray(campos) ? campos : [];
	const ids = raw.map((c) => String(c || '').trim()).filter((id) => allowed.has(id));
	if (!ids.length) {
		return PERSONAL_EXPORT_FIELDS.map((f) => f.id);
	}
	return ids;
}

module.exports = {
	PERSONAL_EXPORT_FIELDS,
	PERSONAL_SYNC_COLUMNS,
	MYSQL_IMPERSONAL_EXTRA_COLS,
	listExportFields,
	resolveExportFieldIds,
};
