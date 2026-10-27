/**
 * Manual: almacén (productos + remitos) y facturación.
 */
const ALMACEN = '/dashboard/almacen';

module.exports = [
	{
		id: 'almacen-productos',
		titulo: 'Almacén: productos',
		path: `${ALMACEN}/productos`,
		seccion: 'productos',
		modulo: 'ALMACEN',
		comoLlegar: 'Almacén → «Productos».',
		permisos: ['ALMACEN.PRODUCTOS.VER', 'ALMACEN.PRODUCTOS.CREAR'],
		tags: ['almacen', 'producto', 'productos', 'catalogo', 'stock', 'precio'],
		texto:
			'Catálogo sobre la tabla Productos. Buscá por descripción, código, rubro o cód. secundario; alta/edición/borrado según permisos.',
		pasos: [
			'«Agregar» → descripción, unidad, rubro, precios → «Aceptar».',
			'Seleccionar fila → «Cambiar» / «Borrar».',
		],
	},
	{
		id: 'almacen-remitos',
		titulo: 'Almacén: remitos de mercadería',
		path: `${ALMACEN}/remitos`,
		seccion: 'remitos',
		modulo: 'ALMACEN',
		comoLlegar: 'Almacén → «Remitos».',
		permisos: ['ALMACEN.REMITOS.VER', 'ALMACEN.REMITOS.CREAR'],
		tags: [
			'almacen',
			'remito',
			'remitos',
			'mercaderia',
			'deposito',
			'entrada',
			'salida',
			'pedido a almacen',
			'solicitud',
			'provision',
		],
		texto:
			'Listado de Remitos con detalle RemitosItems. Alta: tipo (Tipos_Remitos), depósito (Depositos), número e ítems con producto/cantidad/precio/paciente.',
		pasos: [
			'«Nuevo remito» → tipo, depósito, fecha → «Agregar» ítems → «F2 — Aceptar».',
			'Click en un remito del listado para ver cabecera e ítems.',
		],
	},
	/** Alias de búsqueda legacy (antes: solicitudes de provisión). */
	{
		id: 'almacen-solicitudes',
		titulo: 'Almacén: pedidos / remitos',
		path: `${ALMACEN}/remitos`,
		seccion: 'remitos',
		modulo: 'ALMACEN',
		comoLlegar: 'Almacén → «Remitos».',
		permisos: ['ALMACEN.REMITOS.VER', 'ALMACEN.REMITOS.CREAR'],
		tags: ['pedido a almacen', 'solicitud', 'solicitudes', 'provision', 'transferencia'],
		texto: 'Los pedidos de mercadería se gestionan como remitos (entrada/salida entre depósitos o servicios).',
		pasos: ['Almacén → Remitos → «Nuevo remito».'],
	},
	{
		id: 'facturacion-convenios',
		titulo: 'Facturación: convenios',
		path: '/dashboard/billing/convenios',
		modulo: 'FACTURACION',
		comoLlegar: 'Facturación → «Convenios».',
		permisos: ['FACTURACION.CONVENIOS.VER'],
		tags: ['facturacion', 'convenio', 'obra social'],
		texto: 'Gestión de convenios / coberturas para facturación.',
	},
	{
		id: 'facturacion-rendiciones',
		titulo: 'Facturación: rendiciones',
		path: '/dashboard/billing/rendiciones',
		modulo: 'FACTURACION',
		comoLlegar: 'Facturación → «Rendiciones».',
		permisos: ['FACTURACION.RENDICIONES.VER'],
		tags: ['facturacion', 'rendicion', 'rendiciones'],
		texto: 'Rendiciones a obras sociales / coberturas.',
	},
	{
		id: 'facturacion-liquidaciones',
		titulo: 'Facturación: liquidaciones',
		path: '/dashboard/billing/liquidaciones',
		modulo: 'FACTURACION',
		comoLlegar: 'Facturación → «Liquidaciones».',
		permisos: ['FACTURACION.LIQUIDACIONES.VER', 'FACTURACION.LIQUIDACIONES.GESTIONAR'],
		tags: ['facturacion', 'liquidacion', 'excel'],
		texto: 'Importación y gestión de liquidaciones.',
	},
];
