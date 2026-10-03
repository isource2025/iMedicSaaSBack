/**
 * Textos de ayuda de cada campo de las tablas maestras. Se escriben para
 * quien usa el sistema: dicen qué es el dato y para qué sirve, sin nombres
 * de tablas ni de columnas. El front los muestra en un ícono de información
 * al lado del campo.
 *
 * Búsqueda: primero el texto propio del catálogo (por id y campo) y, si no
 * hay, uno genérico según el tipo de campo.
 */

const POR_CATALOGO = {
	'lugar-episodio': {
		Descripcion: 'Lugar donde se originó el episodio de atención, tal como se verá al registrarlo.',
	},
	'centro-asistencial': {
		Descripcion: 'Nombre del centro asistencial tal como debe aparecer en documentos y listados.',
		Domicilio: 'Dirección del centro asistencial.',
		Telefono1: 'Teléfono principal para contactar al centro.',
		email: 'Correo electrónico de contacto del centro.',
	},
	ocupacion: {
		Descripcion: 'Nombre de la ocupación o profesión que se podrá elegir en la ficha del paciente.',
	},
	'categorias-medico': {
		Descripcion: 'Nombre de la categoría profesional en la que se clasifica a los médicos.',
		Porcentaje: 'Porcentaje asociado a la categoría, que se usa para calcular los honorarios del profesional.',
	},
	'clases-medico': {
		Descripcion: 'Nombre de la clase en la que se agrupa a los médicos.',
	},
	'especialidad-medica': {
		Descripcion: 'Nombre de la especialidad médica que se podrá asignar a los profesionales.',
	},
	'funciones-medicas': {
		Descripcion: 'Función que cumple el profesional en una práctica, por ejemplo cirujano o ayudante.',
	},
	'letras-practicas': {
		Valor: 'Letra que identifica este grupo de prácticas. Una vez creada no se puede cambiar.',
		Descripcion: 'Nombre del grupo de prácticas que lleva esta letra.',
		CodigoIoscor: 'Código equivalente que se informa a IOSCOR para esta letra.',
	},
	'tipo-medicamento': {
		Descripcion: 'Nombre del tipo o rubro de medicamento.',
	},
	convenios: {
		Cliente: 'Financiador (obra social o prepaga) al que pertenece el convenio.',
		Codigo: 'Número del convenio dentro del financiador. Se asigna solo.',
		Descripcion: 'Nombre del convenio tal como se verá al facturar.',
		TipoValor: 'Forma en que se valorizan las prácticas de este convenio.',
		CatProfesional: 'Categoría profesional que se tiene en cuenta en este convenio.',
		MultiConvenio: 'Indica si es un convenio múltiple (1) o no (0).',
	},
	'nomenclador-nacional': {
		IDPractica: 'Número que identifica la práctica. Se asigna solo.',
		Descripcion: 'Nombre de la práctica tal como se verá al pedirla y al facturarla.',
		Tipo: 'Grupo al que pertenece la práctica: A generales, B bioquímicas, I internación, K kinesiológicas.',
		Letra: 'Letra que indica con qué valor se factura la práctica.',
		Valor:
			'Capítulo del nomenclador al que pertenece la práctica. Es el número que se elige como prefijo en la tabla de Servicios.',
		SubValor: 'Subcapítulo dentro del capítulo.',
		Practica: 'Número de la práctica dentro del subcapítulo.',
		Complejidad: 'Nivel de complejidad de la práctica.',
	},
	'nomenclador-modulos': {
		IDPractica: 'Número que identifica el módulo. Se asigna solo.',
		Descripcion: 'Nombre del módulo tal como se verá al pedirlo y al facturarlo.',
		Tipo: 'Grupo al que pertenece el módulo.',
		Letra: 'Letra que indica con qué valor se factura el módulo.',
		Valor:
			'Capítulo del nomenclador al que pertenece el módulo. Es el número que se elige como prefijo en la tabla de Servicios.',
		SubValor: 'Subcapítulo dentro del capítulo.',
		Practica: 'Número del módulo dentro del subcapítulo.',
	},
	vademecum: {
		Troquel: 'Número de troquel que identifica al medicamento.',
		Nombre: 'Nombre comercial del medicamento.',
		Descripcion: 'Detalle adicional del medicamento, por ejemplo la droga o la concentración.',
		Presentacion: 'Forma en que se presenta el medicamento, por ejemplo caja de 30 comprimidos.',
		Laboratorio: 'Laboratorio que fabrica el medicamento.',
		CodigoBarra: 'Código de barras del envase.',
		Precio: 'Precio de venta del medicamento.',
	},
	'estado-cama': {
		Valor: 'Letra que identifica el estado. Una vez creada no se puede cambiar.',
		Descripcion: 'Nombre del estado en que puede estar una cama, por ejemplo libre u ocupada.',
	},
	camas: {
		Sector: 'Sector de internación donde está la cama. Una vez creada la cama no se puede cambiar.',
		Cama: 'Número o código de la cama dentro del sector. Una vez creada no se puede cambiar.',
		Estado: 'Situación actual de la cama, por ejemplo libre u ocupada.',
		Tipo: 'Si es una cama, una camilla o un sillón.',
		Observaciones: 'Notas libres sobre la cama, por ejemplo su ubicación o su equipamiento.',
		NumeroVisita:
			'Internación del paciente que ocupa la cama en este momento. Buscala por paciente, documento o número de visita.',
	},
	'frecuencia-admin': {
		Valor: 'Nombre de la frecuencia tal como se verá al indicar una medicación, por ejemplo cada 8 horas.',
		Intervalo:
			'Tiempo entre una administración y la siguiente, en centésimas de segundo. Por ejemplo, 8 horas son 2880000.',
		Dias: 'Cantidad de días que abarca esta frecuencia.',
	},
	sectores: {
		Descripcion: 'Nombre del sector, tal como se verá al asignar camas y atenciones.',
		ValorServicio: 'Servicio al que pertenece el sector.',
		AmbInt: 'Indica si el sector es ambulatorio (A) o de internación (I).',
	},
	servicios: {
		Valor: 'Código corto del servicio. Una vez creado no se puede cambiar.',
		Descripcion: 'Nombre del servicio, que es el que realiza o recibe las atenciones.',
		PrefijosPractica:
			'Capítulos del nomenclador que realiza este servicio. Al pedir un estudio a este servicio solo se ofrecen las prácticas de los capítulos tildados.',
	},
	'tipo-dieta': {
		Descripcion: 'Nombre del tipo de dieta que se podrá indicar al paciente.',
	},
	'tipo-indicacion': {
		Descripcion: 'Nombre del tipo de indicación médica, por ejemplo medicación o dieta.',
		Tipo: 'Letra que agrupa este tipo de indicación, por ejemplo M para medicación.',
	},
	'tipo-control': {
		Descripcion: 'Nombre del control que se podrá registrar al paciente, por ejemplo presión arterial.',
	},
	'tipo-alergeno': {
		Valor: 'Código corto del tipo de alérgeno. Una vez creado no se puede cambiar.',
		Descripcion: 'Nombre de la categoría de alérgeno, por ejemplo medicamento o alimento.',
	},
	'severidad-alergia': {
		Valor: 'Código corto de la severidad. Una vez creado no se puede cambiar.',
		Descripcion: 'Grado de gravedad de la reacción alérgica.',
	},
	'estado-clinico-alergia': {
		Valor: 'Código corto del estado. Una vez creado no se puede cambiar.',
		Descripcion: 'Situación clínica de la alergia, por ejemplo activa o resuelta.',
	},
	'agente-causante': {
		Valor: 'Código corto del agente. Una vez creado no se puede cambiar.',
		Descripcion: 'Agente que provocó la reacción alérgica.',
	},
	'dispositivo-alerta': {
		Valor: 'Código corto del dispositivo. Una vez creado no se puede cambiar.',
		Descripcion: 'Dispositivo con el que se identifica al paciente en situación de alerta, por ejemplo una pulsera.',
	},
	'tipo-unidad-medida': {
		Valor: 'Abreviatura de la unidad de medida. Una vez creada no se puede cambiar.',
		Descripcion: 'Nombre completo de la unidad de medida.',
	},
};

/**
 * @param {{ id: string }} def catálogo
 * @param {{ as: string }} c columna
 * @param {{ isKey: boolean, auto: boolean }} ctx
 * @returns {string|undefined}
 */
function ayudaDeColumna(def, c, { isKey = false, auto = false } = {}) {
	const propio = POR_CATALOGO[def.id]?.[c.as];
	if (propio) return propio;
	if (c.as === 'Descripcion') return 'Nombre con el que se muestra este registro en pantallas y listados.';
	if (auto) return 'Número que identifica el registro. Se asigna solo.';
	if (isKey) return 'Código que identifica el registro. Una vez creado no se puede cambiar.';
	return undefined;
}

module.exports = { ayudaDeColumna, POR_CATALOGO };
