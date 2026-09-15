/**
 * @fileoverview Qué requisitos documentales pide cada cobertura (imClientesRequisitos).
 * La tabla es una relación pura Cliente ↔ Requisito, sin columnas propias.
 * @module services/clientesRequisitos.service
 */
const { executeQuery } = require('../models/db');

/** Cliente 0 son los requisitos de base, los que pide cualquier admisión. */
const CLIENTE_BASE = 0;

function errorHttp(mensaje, statusCode) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	return err;
}

function entero(valor) {
	const n = Number(valor);
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Coberturas con la cantidad de requisitos que tienen configurados. */
async function listarCoberturas() {
	const baseCount = await executeQuery(
		`
		SELECT COUNT(*) AS Cantidad
		FROM dbo.imClientesRequisitos
		WHERE Cliente = @p0
		`,
		[{ value: CLIENTE_BASE, type: 'Int' }],
	);

	const rows = await executeQuery(`
		SELECT
			c.Valor,
			LTRIM(RTRIM(ISNULL(c.RazonSocial, ''))) AS Descripcion,
			ISNULL(cr.Cantidad, 0) AS Requisitos
		FROM dbo.imClientes c
		LEFT JOIN (
			SELECT Cliente, COUNT(*) AS Cantidad
			FROM dbo.imClientesRequisitos
			GROUP BY Cliente
		) cr ON cr.Cliente = c.Valor
		WHERE ISNULL(c.NoFacturable, 0) = 0
		ORDER BY c.RazonSocial
	`);

	return [
		{
			Valor: CLIENTE_BASE,
			Descripcion: 'Base (toda admisión sin cobertura propia)',
			Requisitos: Number(baseCount?.[0]?.Cantidad) || 0,
		},
		...(rows || []).map((r) => ({
			Valor: Number(r.Valor),
			Descripcion: r.Descripcion,
			Requisitos: Number(r.Requisitos) || 0,
		})),
	];
}

/**
 * Catálogo completo de requisitos, marcando cuáles pide la cobertura indicada.
 * Con cliente 0 devuelve el set de base.
 */
async function listarRequisitosDeCobertura(cliente) {
	const cli = entero(cliente);
	if (cli == null || cli < 0) throw errorHttp('Cobertura inválida', 400);

	const rows = await executeQuery(
		`
		SELECT
			r.Valor,
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) AS Aplicable,
			CASE WHEN cr.Requisito IS NULL THEN 0 ELSE 1 END AS Pedido,
			CASE WHEN base.Requisito IS NULL THEN 0 ELSE 1 END AS EsDeBase
		FROM dbo.imRequisitos r
		LEFT JOIN dbo.imClientesRequisitos cr
			ON cr.Requisito = r.Valor AND cr.Cliente = @p0
		LEFT JOIN dbo.imClientesRequisitos base
			ON base.Requisito = r.Valor AND base.Cliente = @p1
		ORDER BY r.Descripcion
		`,
		[
			{ value: cli, type: 'Int' },
			{ value: CLIENTE_BASE, type: 'Int' },
		],
	);

	return (rows || []).map((r) => ({
		Valor: Number(r.Valor),
		Descripcion: r.Descripcion,
		Aplicable: r.Aplicable,
		Pedido: Number(r.Pedido) === 1,
		// Los de base ya los pide toda admisión: se muestran para no configurarlos dos veces.
		EsDeBase: Number(r.EsDeBase) === 1,
	}));
}

/**
 * Reemplaza los requisitos de una cobertura por la lista recibida. Se hace en una
 * transacción porque la pantalla manda el set completo, no altas y bajas sueltas.
 */
async function guardarRequisitosDeCobertura(cliente, requisitos) {
	const cli = entero(cliente);
	if (cli == null || cli < 0) throw errorHttp('Cobertura inválida', 400);

	const valores = [
		...new Set(
			(Array.isArray(requisitos) ? requisitos : [])
				.map((v) => entero(v))
				.filter((v) => v != null && v > 0 && v <= 255),
		),
	];

	const params = [{ value: cli, type: 'Int' }];
	const placeholders = valores.map((v) => {
		params.push({ value: v, type: 'TinyInt' });
		return `@p${params.length - 1}`;
	});

	const insert = placeholders.length
		? `
		INSERT INTO dbo.imClientesRequisitos (Cliente, Requisito)
		SELECT @p0, r.Valor
		FROM dbo.imRequisitos r
		WHERE r.Valor IN (${placeholders.join(', ')});
		`
		: '';

	await executeQuery(
		`
		SET XACT_ABORT ON;
		BEGIN TRANSACTION;
		DELETE FROM dbo.imClientesRequisitos WHERE Cliente = @p0;
		${insert}
		COMMIT;
		`,
		params,
	);

	return listarRequisitosDeCobertura(cli);
}

module.exports = {
	listarCoberturas,
	listarRequisitosDeCobertura,
	guardarRequisitosDeCobertura,
};
